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

/** Routing-rule CRUD + validation e2e (Task 8). Real Postgres; self-skips otherwise. */
const T = { slug: `rt-${randomUUID().slice(0, 8)}`, id: randomUUID() };
const PASSWORD = 'password123';
let app: INestApplication;
let prisma: PrismaService;
let dbAvailable = true;
let ownerToken = '';
let callerToken = '';

async function seed(): Promise<void> {
  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${T.id}, true)`;
    await tx.tenant.create({ data: { id: T.id, name: T.slug, slug: T.slug, plan: 'GROWTH' } });
    await tx.user.create({ data: { tenantId: T.id, email: `owner@${T.slug}.test`, name: 'O', role: 'OWNER', passwordHash } });
    await tx.user.create({ data: { tenantId: T.id, email: `caller@${T.slug}.test`, name: 'C', role: 'TELE_CALLER', passwordHash } });
  });
}
async function cleanup(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${T.id}, true)`;
    await tx.routingRule.deleteMany({});
    await tx.user.deleteMany({});
    await tx.tenant.deleteMany({});
  }).catch(() => undefined);
}
function http() { return request(app.getHttpServer()); }

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
    ownerToken = (await http().post('/api/v1/auth/login').send({ tenantSlug: T.slug, email: `owner@${T.slug}.test`, password: PASSWORD })).body.accessToken;
    callerToken = (await http().post('/api/v1/auth/login').send({ tenantSlug: T.slug, email: `caller@${T.slug}.test`, password: PASSWORD })).body.accessToken;
  } catch {
    dbAvailable = false;
  }
}, 60_000);

afterAll(async () => { if (app) { if (dbAvailable) await cleanup(); await app.close(); } });

describe('Routing rules (e2e)', () => {
  it('creates and lists a rule (Owner)', async () => {
    if (!dbAvailable) return;
    const create = await http()
      .post('/api/v1/routing-rules')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Hot Hindi', priority: 1, conditions: { tier: 'HOT' }, action: { strategy: 'round_robin', requireLanguage: 'hi' } });
    expect(create.status).toBe(201);
    const list = await http().get('/api/v1/routing-rules').set('Authorization', `Bearer ${ownerToken}`);
    expect((list.body as unknown[]).length).toBe(1);
  });

  it('rejects an invalid action strategy', async () => {
    if (!dbAvailable) return;
    const res = await http()
      .post('/api/v1/routing-rules')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'bad', conditions: {}, action: { strategy: 'nonsense' } });
    expect(res.status).toBe(400);
  });

  it('forbids a tele-caller from managing routing rules (RBAC)', async () => {
    if (!dbAvailable) return;
    const res = await http().get('/api/v1/routing-rules').set('Authorization', `Bearer ${callerToken}`);
    expect(res.status).toBe(403);
  });
});
