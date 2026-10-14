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

/** Tele-caller workspace e2e (Task 12). Real Postgres; self-skips otherwise. */
const T = { slug: `c-${randomUUID().slice(0, 8)}`, id: randomUUID() };
const PASSWORD = 'password123';
let app: INestApplication;
let prisma: PrismaService;
let dbAvailable = true;
let token = '';
let callerId = '';

async function seed(): Promise<void> {
  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${T.id}, true)`;
    await tx.tenant.create({ data: { id: T.id, name: T.slug, slug: T.slug, plan: 'GROWTH' } });
    const caller = await tx.user.create({ data: { tenantId: T.id, email: `caller@${T.slug}.test`, name: 'C', role: 'TELE_CALLER', passwordHash } });
    callerId = caller.id;
    // Three leads: an overdue follow-up (low score), a hot one, a cold one — all assigned to the caller.
    for (const [i, cfg] of [
      { score: 20, tier: 'COLD', followupPast: true },
      { score: 85, tier: 'HOT', followupPast: false },
      { score: 10, tier: 'COLD', followupPast: false },
    ].entries()) {
      const contact = await tx.contact.create({ data: { tenantId: T.id, phoneE164: `+91981100000${i}`, name: `Lead ${i}` } });
      await tx.lead.create({
        data: {
          tenantId: T.id,
          contactId: contact.id,
          source: 'WHATSAPP',
          stage: 'Contacted',
          score: cfg.score,
          tier: cfg.tier,
          assignedTo: callerId,
          qualification: { intent: 'buy', bhk: 2, locations: ['Wakad'], urgency_signals: [] },
          nextFollowupAt: cfg.followupPast ? new Date(Date.now() - 3600_000) : null,
        },
      });
    }
  });
}
async function cleanup(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${T.id}, true)`;
    await tx.call.deleteMany({});
    await tx.activity.deleteMany({});
    await tx.lead.deleteMany({});
    await tx.contact.deleteMany({});
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
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'webhooks/whatsapp/:provider/:tenantKey', 'webhooks/exotel/:tenantKey'] });
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
    token = (await http().post('/api/v1/auth/login').send({ tenantSlug: T.slug, email: `caller@${T.slug}.test`, password: PASSWORD })).body.accessToken;
  } catch {
    dbAvailable = false;
  }
}, 60_000);

afterAll(async () => { if (app) { if (dbAvailable) await cleanup(); await app.close(); } });

describe('Tele-caller workspace (e2e)', () => {
  it('ranks the overdue-follow-up lead to the top of the queue', async () => {
    if (!dbAvailable) return;
    const res = await http().get('/api/v1/queue/next-best-calls').set(auth());
    expect(res.status).toBe(200);
    const queue = res.body as { contact: { name: string }; brief: string }[];
    expect(queue[0].contact.name).toBe('Lead 0'); // the overdue one
    expect(typeof queue[0].brief).toBe('string');
    expect(queue[0].brief.split('\n').length).toBe(3); // 3-line brief
  });

  it('click-to-call creates a call log; outcome is validated and sets follow-up', async () => {
    if (!dbAvailable) return;
    const queue = (await http().get('/api/v1/queue/next-best-calls').set(auth())).body as { leadId: string }[];
    const leadId = queue[0].leadId;

    const call = await http().post('/api/v1/calls/click-to-call').set(auth()).send({ leadId, agentNumber: '+919800000000' });
    expect(call.status).toBe(201);
    const callId = call.body.id;

    const bad = await http().post(`/api/v1/calls/${callId}/outcome`).set(auth()).send({ outcome: 'maybe' });
    expect(bad.status).toBe(400);

    const ok = await http().post(`/api/v1/calls/${callId}/outcome`).set(auth()).send({ outcome: 'visit_booked', nextFollowupAt: new Date(Date.now() + 86400000).toISOString() });
    expect(ok.status).toBe(201);

    // visit_booked advances the stage.
    const lead = await prisma.withTenant(T.id, (tx) => tx.lead.findUnique({ where: { id: leadId } }));
    expect(lead!.stage).toBe('Visit Scheduled');
  });
});
