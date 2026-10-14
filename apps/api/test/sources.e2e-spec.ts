import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { json, urlencoded } from 'express';
import type { Request } from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { randomUUID, randomBytes } from 'node:crypto';
import { encryptJson, loadEncryptionKey } from '@estateflow/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/** Lead-source intake e2e (Task 14). Real Postgres; self-skips otherwise. */
const T = { slug: `src-${randomUUID().slice(0, 8)}`, id: randomUUID() };
const KEY = randomBytes(16).toString('hex');
let app: INestApplication;
let prisma: PrismaService;
let dbAvailable = true;

async function seed(): Promise<void> {
  const key = loadEncryptionKey(process.env.ENCRYPTION_KEY);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${T.id}, true)`;
    await tx.tenant.create({ data: { id: T.id, name: T.slug, slug: T.slug, plan: 'GROWTH' } });
    await tx.providerCredential.create({
      data: { tenantId: T.id, type: 'MOCK', tenantKey: KEY, encryptedConfig: encryptJson(key, { type: 'MOCK' }) },
    });
  });
}
async function cleanup(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${T.id}, true)`;
    await tx.message.deleteMany({});
    await tx.activity.deleteMany({});
    await tx.lead.deleteMany({});
    await tx.contact.deleteMany({});
    await tx.providerCredential.deleteMany({});
    await tx.tenant.deleteMany({});
  }).catch(() => undefined);
}
function http() { return request(app.getHttpServer()); }
async function countLeads() {
  return prisma.withTenant(T.id, (tx) => tx.lead.count());
}

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
  } catch {
    dbAvailable = false;
  }
}, 60_000);

afterAll(async () => { if (app) { if (dbAvailable) await cleanup(); await app.close(); } });

describe('Lead sources (e2e)', () => {
  it('creates a lead from a Meta Lead Ads webhook', async () => {
    if (!dbAvailable) return;
    const body = {
      entry: [
        {
          changes: [
            {
              value: {
                ad_id: 'ad1',
                field_data: [
                  { name: 'full_name', values: ['Meta Lead'] },
                  { name: 'phone_number', values: ['9812345678'] },
                ],
              },
            },
          ],
        },
      ],
    };
    const res = await http().post(`/webhooks/leads/meta/${KEY}`).send(body);
    expect(res.status).toBe(201);
    expect(res.body.ingested).toBe(1);
    expect(await countLeads()).toBe(1);
  });

  it('dedups the same phone arriving from a different source (website)', async () => {
    if (!dbAvailable) return;
    const before = await countLeads();
    const res = await http().post(`/webhooks/leads/website/${KEY}`).send({ name: 'Same Person', phone: '+919812345678' });
    expect(res.status).toBe(201);
    expect(res.body.results[0].merged).toBe(true);
    expect(await countLeads()).toBe(before); // no new lead
  });

  it('creates a distinct lead for a new phone (99acres)', async () => {
    if (!dbAvailable) return;
    const before = await countLeads();
    const res = await http().post(`/webhooks/leads/99acres/${KEY}`).send({ customerName: 'Portal Lead', contactNumber: '9800011122' });
    expect(res.status).toBe(201);
    expect(await countLeads()).toBe(before + 1);
  });

  it('returns ok:false for an unknown tenantKey', async () => {
    if (!dbAvailable) return;
    const res = await http().post('/webhooks/leads/website/nope').send({ phone: '9811111111' });
    expect(res.body.ok).toBe(false);
  });
});
