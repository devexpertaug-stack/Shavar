import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { json } from 'express';
import type { Request } from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Scoring engine e2e (Task 7). Requires real Postgres. Self-skips otherwise.
 * Asserts: weights get/set, and that the decay pass lowers a stale lead's
 * score and records a ScoreEvent.
 */
const T = { slug: `s-${randomUUID().slice(0, 8)}`, id: randomUUID() };
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
    await tx.user.create({
      data: { tenantId: T.id, email: `owner@${T.slug}.test`, name: 'O', role: 'OWNER', passwordHash },
    });
    const contact = await tx.contact.create({
      data: { tenantId: T.id, phoneE164: '+919870000001', name: 'Stale Lead' },
    });
    // High score but quiet for 10 days -> decay should drop it.
    await tx.lead.create({
      data: {
        tenantId: T.id,
        contactId: contact.id,
        source: 'WHATSAPP',
        stage: 'Contacted',
        score: 80,
        tier: 'HOT',
        qualification: { intent: 'buy', budget_max: 8000000, timeline: '0-3m', locations: [], urgency_signals: [] },
        lastInboundAt: new Date(Date.now() - 10 * 86_400_000),
      },
    });
  });
}

async function cleanup(): Promise<void> {
  await prisma
    .$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${T.id}, true)`;
      await tx.scoreEvent.deleteMany({});
      await tx.message.deleteMany({});
      await tx.activity.deleteMany({});
      await tx.lead.deleteMany({});
      await tx.contact.deleteMany({});
      await tx.user.deleteMany({});
      await tx.tenant.deleteMany({});
    })
    .catch(() => undefined);
}

function http() {
  return request(app.getHttpServer());
}

beforeAll(async () => {
  process.env.JWT_SECRET ??= 'e2e-access';
  process.env.JWT_REFRESH_SECRET ??= 'e2e-refresh';
  process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'webhooks/whatsapp/:provider/:tenantKey'] });
  app.use(cookieParser());
  app.use(json({ verify: (req: Request & { rawBody?: string }, _r, buf) => { req.rawBody = buf.toString('utf8'); } }));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  try {
    await prisma.ping();
    await cleanup();
    await seed();
    const login = await http().post('/api/v1/auth/login').send({ tenantSlug: T.slug, email: `owner@${T.slug}.test`, password: PASSWORD });
    token = login.body.accessToken;
  } catch {
    dbAvailable = false;
  }
}, 60_000);

afterAll(async () => {
  if (app) {
    if (dbAvailable) await cleanup();
    await app.close();
  }
});

describe('Scoring (e2e)', () => {
  it('returns default weights and accepts overrides', async () => {
    if (!dbAvailable) return;
    const get = await http().get('/api/v1/settings/scoring/weights').set('Authorization', `Bearer ${token}`);
    expect(get.status).toBe(200);
    expect(get.body.budgetFit).toBe(25);
    const put = await http()
      .put('/api/v1/settings/scoring/weights')
      .set('Authorization', `Bearer ${token}`)
      .send({ budgetFit: 30 });
    expect(put.status).toBe(200);
    expect(put.body.budgetFit).toBe(30);
  });

  it('decay lowers a stale lead score and records a ScoreEvent', async () => {
    if (!dbAvailable) return;
    const decay = await http().post('/api/v1/settings/scoring/decay').set('Authorization', `Bearer ${token}`);
    expect(decay.status).toBe(201);
    expect(decay.body.rescored).toBeGreaterThanOrEqual(1);
    expect(decay.body.changed).toBeGreaterThanOrEqual(1);

    const events = await prisma.withTenant(T.id, (tx) => tx.scoreEvent.findMany({}));
    expect(events.length).toBeGreaterThanOrEqual(1);
    const lead = await prisma.withTenant(T.id, (tx) => tx.lead.findFirst({}));
    expect(lead!.score).toBeLessThan(80); // decayed from the seeded 80
  });
});
