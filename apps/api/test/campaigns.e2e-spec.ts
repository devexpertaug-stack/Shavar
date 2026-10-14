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

/** Campaigns e2e (Task 15). Real Postgres; self-skips otherwise. */
const T = { slug: `cmp-${randomUUID().slice(0, 8)}`, id: randomUUID() };
const PASSWORD = 'password123';
let app: INestApplication;
let prisma: PrismaService;
let dbAvailable = true;
let token = '';

async function seed(): Promise<void> {
  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${T.id}, true)`;
    await tx.tenant.create({ data: { id: T.id, name: T.slug, slug: T.slug, plan: 'GROWTH' } });
    await tx.user.create({ data: { tenantId: T.id, email: `mkt@${T.slug}.test`, name: 'M', role: 'MARKETING', passwordHash } });
    // 2 WARM opted-in + 1 WARM opted-out (excluded) + 1 HOT (wrong tier).
    for (const [i, cfg] of [
      { tier: 'WARM', optedIn: true },
      { tier: 'WARM', optedIn: true },
      { tier: 'WARM', optedIn: false },
      { tier: 'HOT', optedIn: true },
    ].entries()) {
      const c = await tx.contact.create({ data: { tenantId: T.id, phoneE164: `+91982200000${i}`, name: `L${i}`, optedIn: cfg.optedIn } });
      await tx.lead.create({ data: { tenantId: T.id, contactId: c.id, source: 'WHATSAPP', stage: 'Contacted', tier: cfg.tier } });
    }
    await tx.template.create({ data: { tenantId: T.id, name: 'promo', body: 'Hi {{1}}, new launch!', paramCount: 1 } });
  });
}
async function cleanup(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${T.id}, true)`;
    await tx.campaignRecipient.deleteMany({});
    await tx.campaign.deleteMany({});
    await tx.message.deleteMany({});
    await tx.lead.deleteMany({});
    await tx.contact.deleteMany({});
    await tx.template.deleteMany({});
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
    token = (await http().post('/api/v1/auth/login').send({ tenantSlug: T.slug, email: `mkt@${T.slug}.test`, password: PASSWORD })).body.accessToken;
  } catch {
    dbAvailable = false;
  }
}, 60_000);

afterAll(async () => { if (app) { if (dbAvailable) await cleanup(); await app.close(); } });

describe('Campaigns (e2e)', () => {
  let campaignId = '';

  it('previews a segment excluding opted-out leads', async () => {
    if (!dbAvailable) return;
    const res = await http().post('/api/v1/campaigns/preview').set(auth()).send({ segment: { tier: 'WARM' } });
    expect(res.status).toBe(201);
    expect(res.body.count).toBe(2); // 2 opted-in WARM (opt-out + HOT excluded)
  });

  it('creates a campaign and materializes recipients on send', async () => {
    if (!dbAvailable) return;
    const create = await http().post('/api/v1/campaigns').set(auth()).send({ name: 'Warm promo', templateName: 'promo', segment: { tier: 'WARM' } });
    expect(create.status).toBe(201);
    campaignId = create.body.id;
    const send = await http().post(`/api/v1/campaigns/${campaignId}/send`).set(auth());
    expect(send.status).toBe(201);
    expect(send.body.recipients).toBe(2); // opt-out excluded
  });

  it('reports recipient stats', async () => {
    if (!dbAvailable) return;
    const stats = await http().get(`/api/v1/campaigns/${campaignId}/stats`).set(auth());
    expect(stats.status).toBe(200);
    const total = Object.values(stats.body as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(total).toBe(2);
  });

  it('creates a drip sequence', async () => {
    if (!dbAvailable) return;
    const res = await http().post('/api/v1/sequences').set(auth()).send({ name: 'Cold nurture', steps: [{ dayOffset: 1, templateName: 'promo' }], segment: { tier: 'COLD' } });
    expect(res.status).toBe(201);
  });
});
