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

/** Site-visit scheduling e2e (Task 13). Real Postgres; self-skips otherwise. */
const T = { slug: `v-${randomUUID().slice(0, 8)}`, id: randomUUID() };
const PASSWORD = 'password123';
let app: INestApplication;
let prisma: PrismaService;
let dbAvailable = true;
let ownerToken = '';
let agentId = '';
let leadId = '';

async function seed(): Promise<void> {
  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${T.id}, true)`;
    await tx.tenant.create({ data: { id: T.id, name: T.slug, slug: T.slug, plan: 'GROWTH' } });
    await tx.user.create({ data: { tenantId: T.id, email: `owner@${T.slug}.test`, name: 'O', role: 'OWNER', passwordHash } });
    const agent = await tx.user.create({ data: { tenantId: T.id, email: `agent@${T.slug}.test`, name: 'A', role: 'FIELD_AGENT', passwordHash } });
    agentId = agent.id;
    const contact = await tx.contact.create({ data: { tenantId: T.id, phoneE164: '+919812390001', name: 'Visitor' } });
    const lead = await tx.lead.create({ data: { tenantId: T.id, contactId: contact.id, source: 'WHATSAPP', stage: 'Qualified' } });
    leadId = lead.id;
  });
}
async function cleanup(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${T.id}, true)`;
    await tx.siteVisit.deleteMany({});
    await tx.message.deleteMany({});
    await tx.activity.deleteMany({});
    await tx.lead.deleteMany({});
    await tx.contact.deleteMany({});
    await tx.user.deleteMany({});
    await tx.tenant.deleteMany({});
  }).catch(() => undefined);
}
function http() { return request(app.getHttpServer()); }
function auth(t = ownerToken) { return { Authorization: `Bearer ${t}` }; }

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
    ownerToken = (await http().post('/api/v1/auth/login').send({ tenantSlug: T.slug, email: `owner@${T.slug}.test`, password: PASSWORD })).body.accessToken;
  } catch {
    dbAvailable = false;
  }
}, 60_000);

afterAll(async () => { if (app) { if (dbAvailable) await cleanup(); await app.close(); } });

describe('Site visits (e2e)', () => {
  let slot = '';
  let visitId = '';

  it('lists available slots', async () => {
    if (!dbAvailable) return;
    const res = await http().get(`/api/v1/site-visits/slots?agentId=${agentId}`).set(auth());
    expect(res.status).toBe(200);
    expect((res.body as string[]).length).toBeGreaterThan(0);
    slot = (res.body as string[])[0];
  });

  it('books a visit and moves the lead to Visit Scheduled', async () => {
    if (!dbAvailable) return;
    const res = await http().post('/api/v1/site-visits').set(auth()).send({ leadId, slotAt: slot, agentId });
    expect(res.status).toBe(201);
    visitId = res.body.id;
    const lead = await prisma.withTenant(T.id, (tx) => tx.lead.findUnique({ where: { id: leadId } }));
    expect(lead!.stage).toBe('Visit Scheduled');
  });

  it('prevents double-booking the same agent + slot', async () => {
    if (!dbAvailable) return;
    const res = await http().post('/api/v1/site-visits').set(auth()).send({ leadId, slotAt: slot, agentId });
    expect(res.status).toBe(409);
  });

  it('check-in then check-out moves the lead to Visited', async () => {
    if (!dbAvailable) return;
    const ci = await http().post(`/api/v1/site-visits/${visitId}/checkin`).set(auth()).send({ geo: '18.59,73.76' });
    expect(ci.status).toBe(201);
    const co = await http().post(`/api/v1/site-visits/${visitId}/checkout`).set(auth()).send({ geo: '18.59,73.76', feedback: 'Liked it' });
    expect(co.status).toBe(201);
    const lead = await prisma.withTenant(T.id, (tx) => tx.lead.findUnique({ where: { id: leadId } }));
    expect(lead!.stage).toBe('Visited');
  });
});
