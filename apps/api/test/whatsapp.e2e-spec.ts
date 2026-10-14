import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { json } from 'express';
import type { Request } from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { randomUUID, randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { encryptJson, loadEncryptionKey } from '@estateflow/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * WhatsApp webhook + settings e2e (Task 4). Requires real Postgres + Redis.
 * Self-skips when unavailable. Asserts:
 *   - a well-formed mock webhook with the right secret is accepted (200)
 *   - a webhook with a bad secret is rejected (401)
 *   - the owner can store an (encrypted) provider credential and get a tenantKey
 */

const T = { slug: `w-${randomUUID().slice(0, 8)}`, id: randomUUID() };
const PASSWORD = 'password123';
const TENANT_KEY = randomBytes(16).toString('hex');
const WEBHOOK_SECRET = 'mock-secret-123';

let app: INestApplication;
let prisma: PrismaService;
let dbAvailable = true;

async function seed(): Promise<void> {
  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  const key = loadEncryptionKey(process.env.ENCRYPTION_KEY);
  const encryptedConfig = encryptJson(key, {
    type: 'MOCK',
    webhookSecret: WEBHOOK_SECRET,
  });
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${T.id}, true)`;
    await tx.tenant.create({ data: { id: T.id, name: T.slug, slug: T.slug, plan: 'GROWTH' } });
    await tx.user.create({
      data: {
        tenantId: T.id,
        email: `owner@${T.slug}.test`,
        name: 'Owner',
        role: 'OWNER',
        passwordHash,
      },
    });
    await tx.providerCredential.create({
      data: { tenantId: T.id, type: 'MOCK', tenantKey: TENANT_KEY, encryptedConfig },
    });
  });
}

async function cleanup(): Promise<void> {
  await prisma
    .$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${T.id}, true)`;
      await tx.message.deleteMany({});
      await tx.activity.deleteMany({});
      await tx.lead.deleteMany({});
      await tx.contact.deleteMany({});
      await tx.providerCredential.deleteMany({});
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
  app.setGlobalPrefix('api/v1', {
    exclude: ['health', 'webhooks/whatsapp/:provider/:tenantKey'],
  });
  app.use(cookieParser());
  app.use(
    json({
      verify: (req: Request & { rawBody?: string }, _res, buf) => {
        req.rawBody = buf.toString('utf8');
      },
    }),
  );
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  try {
    await prisma.ping();
    await cleanup();
    await seed();
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

describe('WhatsApp webhook + settings (e2e)', () => {
  it('rejects a webhook with a bad secret (401)', async () => {
    if (!dbAvailable) return;
    const res = await http()
      .post(`/webhooks/whatsapp/mock/${TENANT_KEY}`)
      .set('x-mock-secret', 'WRONG')
      .send({ from: '919812345678', text: 'hi', providerMessageId: `m_${randomUUID()}` });
    expect(res.status).toBe(401);
  });

  it('accepts a well-formed webhook with the right secret (200) and enqueues', async () => {
    if (!dbAvailable) return;
    const res = await http()
      .post(`/webhooks/whatsapp/mock/${TENANT_KEY}`)
      .set('x-mock-secret', WEBHOOK_SECRET)
      .send({ from: '919812345678', text: 'need a 2bhk', providerMessageId: `m_${randomUUID()}` });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.accepted).toBe(1);
  });

  it('returns 404 for an unknown tenantKey', async () => {
    if (!dbAvailable) return;
    const res = await http()
      .post(`/webhooks/whatsapp/mock/deadbeef`)
      .set('x-mock-secret', WEBHOOK_SECRET)
      .send({ from: '919812345678', text: 'hi', providerMessageId: 'x' });
    expect(res.status).toBe(404);
  });

  it('lets the owner store a provider credential and exposes a webhook URL', async () => {
    if (!dbAvailable) return;
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ tenantSlug: T.slug, email: `owner@${T.slug}.test`, password: PASSWORD });
    const token = login.body.accessToken as string;

    const put = await http()
      .put('/api/v1/settings/providers')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'WATI', apiKey: 'wati-key', baseUrl: 'https://live.wati.io', webhookSecret: 's' });
    expect(put.status).toBe(200);
    expect(put.body.type).toBe('WATI');
    expect(put.body.hasApiKey).toBe(true);
    expect(put.body.webhookUrl).toContain('/webhooks/whatsapp/wati/');
    // Secret/key values are never returned in the clear.
    expect(JSON.stringify(put.body)).not.toContain('wati-key');

    const list = await http()
      .get('/api/v1/settings/providers')
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect((list.body as unknown[]).length).toBeGreaterThanOrEqual(2);
  });
});
