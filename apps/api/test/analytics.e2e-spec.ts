import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { json, urlencoded } from 'express';
import type { Request } from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/** Owner analytics e2e (Task 16). Real Postgres; self-skips otherwise. */
const T = { slug: `an-${randomUUID().slice(0, 8)}`, id: randomUUID() };
const PASSWORD = 'password123';
let app: INestApplication;
let prisma: PrismaService;
let dbAvailable = true;
let token = '';

async function seed(): Promise<void> {
  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${T.id}, true)`;
    await tx.tenant.create({ data: { id: T.id, name: T.slug, slug: T.slug, plan: 'GROWTH', settings: { adSpend: { WHATSAPP: 1000 } } } });
    await tx.user.create({ data: { tenantId: T.id, email: `owner@${T.slug}.test`, name: 'O', role: 'OWNER', passwordHash } });
    const caller = await tx.user.create({ data: { tenantId: T.id, email: `caller@${T.slug}.test`, name: 'Caller', role: 'TELE_CALLER', passwordHash } });
    await tx.pipelineStage.createMany({ data: ['New', 'Contacted', 'Booked', 'Lost'].map((name, order) => ({ tenantId: T.id, name, order })) });
    // 4 leads: 2 WHATSAPP (1 booked), 2 WEBSITE.
    for (const [i, cfg] of [
      { source: 'WHATSAPP', stage: 'Booked', tier: 'HOT' },
      { source: 'WHATSAPP', stage: 'New', tier: 'WARM' },
      { source: 'WEBSITE', stage: 'Contacted', tier: 'WARM' },
      { source: 'WEBSITE', stage: 'New', tier: 'COLD' },
    ].entries()) {
      const c = await tx.contact.create({ data: { tenantId: T.id, phoneE164: `+91982300000${i}`, name: `L${i}` } });
      const lead = await tx.lead.create({ data: { tenantId: T.id, contactId: c.id, source: cfg.source, stage: cfg.stage, tier: cfg.tier, assignedTo: caller.id } });
      if (cfg.stage === 'Booked') {
        await tx.call.create({ data: { tenantId: T.id, leadId: lead.id, userId: caller.id, outcome: 'visit_booked' } });
      }
      await tx.call.create({ data: { tenantId: T.id, leadId: lead.id, userId: caller.id, outcome: 'connected' } });
    }
    await tx.message.create({ data: { tenantId: T.id, leadId: (await tx.lead.findFirst({}))!.id, direction: 'OUTBOUND', sentBy: 'ai', type: 'text', body: 'hi' } });
  });
}
async function cleanup(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${T.id}, true)`;
    await tx.auditLog.deleteMany({});
    await tx.call.deleteMany({});
    await tx.message.deleteMany({});
    await tx.activity.deleteMany({});
    await tx.lead.deleteMany({});
    await tx.contact.deleteMany({});
    await tx.pipelineStage.deleteMany({});
    await tx.user.deleteMany({});
    await tx.tenant.deleteMany({});
  }).catch(() => undefined);
}
function http() { return request(app.getHttpServer()); }
function auth() { return { Authorization: `Bearer ${token}` }; }

beforeAll(async () => {
  process.env.JWT_SECRET ??= 'e2e-access';
  process.env.JWT_REFRESH_SECRET ??= 'e2e-refresh';
  process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'webhooks/whatsapp/:provider/:tenantKey', 'webhooks/exotel/:tenantKey', 'webhooks/leads/:source/:tenantKey'] });
  app.use(cookieParser());
  app.use(json({ verify: (req: Request & { rawBody?: string }, _r, buf) => { req.rawBody = buf.toString('utf8'); } }));
  app.use(urlencoded({ extended: true }));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  try {
    await prisma.ping();
    await cleanup();
    await seed();
    token = (await http().post('/api/v1/auth/login').send({ tenantSlug: T.slug, email: `owner@${T.slug}.test`, password: PASSWORD })).body.accessToken;
  } catch {
    dbAvailable = false;
  }
}, 60_000);

afterAll(async () => { if (app) { if (dbAvailable) await cleanup(); await app.close(); } });

describe('Analytics (e2e)', () => {
  it('overview reports totals, tiers, and AI vs human', async () => {
    if (!dbAvailable) return;
    const res = await http().get('/api/v1/analytics/overview').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.totalLeads).toBe(4);
    expect(res.body.byTier.WARM).toBe(2);
    expect(res.body.aiVsHuman.ai).toBeGreaterThanOrEqual(1);
  });

  it('funnel returns per-stage counts in order', async () => {
    if (!dbAvailable) return;
    const res = await http().get('/api/v1/analytics/funnel').set(auth());
    const map = Object.fromEntries((res.body as { stage: string; count: number }[]).map((f) => [f.stage, f.count]));
    expect(map['Booked']).toBe(1);
    expect(map['New']).toBe(2);
  });

  it('source ROI computes cost per lead from ad spend', async () => {
    if (!dbAvailable) return;
    const res = await http().get('/api/v1/analytics/sources').set(auth());
    const wa = (res.body as { source: string; leads: number; costPerLead: number; bookings: number }[]).find((s) => s.source === 'WHATSAPP');
    expect(wa!.leads).toBe(2);
    expect(wa!.bookings).toBe(1);
    expect(wa!.costPerLead).toBe(500); // 1000 spend / 2 leads
  });

  it('agent leaderboard counts calls/connects/bookings', async () => {
    if (!dbAvailable) return;
    const res = await http().get('/api/v1/analytics/agents').set(auth());
    const caller = (res.body as { name: string; bookings: number; connects: number }[]).find((a) => a.name === 'Caller');
    expect(caller!.bookings).toBe(1);
    expect(caller!.connects).toBeGreaterThanOrEqual(1);
  });

  it('CSV export returns rows and writes an audit log', async () => {
    if (!dbAvailable) return;
    const res = await http().get('/api/v1/analytics/export/leads').set(auth());
    expect(res.status).toBe(200);
    expect(res.text.split('\n').length).toBe(5); // header + 4 leads
    const audits = await prisma.withTenant(T.id, (tx) => tx.auditLog.findMany({ where: { action: 'export' } }));
    expect(audits.length).toBe(1);
  });
});
