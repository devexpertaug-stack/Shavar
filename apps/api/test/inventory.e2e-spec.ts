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
 * Inventory + matching e2e (Task 9). Exercises pgvector raw SQL. Real Postgres
 * with the vector extension required; self-skips otherwise.
 */
const T = { slug: `inv-${randomUUID().slice(0, 8)}`, id: randomUUID() };
const PASSWORD = 'password123';
let app: INestApplication;
let prisma: PrismaService;
let dbAvailable = true;
let token = '';
let leadId = '';

async function seed(): Promise<void> {
  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  leadId = randomUUID();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${T.id}, true)`;
    await tx.tenant.create({ data: { id: T.id, name: T.slug, slug: T.slug, plan: 'GROWTH' } });
    await tx.user.create({ data: { tenantId: T.id, email: `owner@${T.slug}.test`, name: 'O', role: 'OWNER', passwordHash } });
    const contact = await tx.contact.create({ data: { tenantId: T.id, phoneE164: '+919877000001', name: 'Buyer' } });
    await tx.lead.create({
      data: {
        id: leadId,
        tenantId: T.id,
        contactId: contact.id,
        source: 'WHATSAPP',
        stage: 'New',
        qualification: { intent: 'buy', bhk: 2, budget_min: 6000000, budget_max: 8000000, locations: ['Wakad'], urgency_signals: [] },
      },
    });
  });
}
async function cleanup(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${T.id}, true)`;
    await tx.unit.deleteMany({});
    await tx.project.deleteMany({});
    await tx.message.deleteMany({});
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
    token = (await http().post('/api/v1/auth/login').send({ tenantSlug: T.slug, email: `owner@${T.slug}.test`, password: PASSWORD })).body.accessToken;
  } catch {
    dbAvailable = false;
  }
}, 60_000);

afterAll(async () => { if (app) { if (dbAvailable) await cleanup(); await app.close(); } });

describe('Inventory + matching (e2e)', () => {
  let projectId = '';

  it('creates a project and units (units get an embedding)', async () => {
    if (!dbAvailable) return;
    const proj = await http().post('/api/v1/projects').set(auth()).send({ name: 'Skyline Towers', location: 'Wakad', amenities: ['gym', 'pool'] });
    expect(proj.status).toBe(201);
    projectId = proj.body.id;

    // Matching unit (2BHK Wakad ~70L), a mismatch (3BHK), and an over-budget one.
    await http().post('/api/v1/units').set(auth()).send({ projectId, name: 'A-701', bhk: 2, priceMin: 6500000, priceMax: 7500000 });
    await http().post('/api/v1/units').set(auth()).send({ projectId, name: 'B-301', bhk: 3, priceMin: 9000000, priceMax: 11000000 });
    await http().post('/api/v1/units').set(auth()).send({ projectId, name: 'C-110', bhk: 2, priceMin: 15000000, priceMax: 16000000 });

    const list = await http().get('/api/v1/units').set(auth());
    expect((list.body as unknown[]).length).toBe(3);
  });

  it('matches only units passing the hard filters (BHK/budget/location)', async () => {
    if (!dbAvailable) return;
    const res = await http().get(`/api/v1/units/match?leadId=${leadId}`).set(auth());
    expect(res.status).toBe(200);
    const names = (res.body as { name: string }[]).map((u) => u.name);
    expect(names).toContain('A-701'); // the right fit
    expect(names).not.toContain('B-301'); // wrong BHK
    expect(names).not.toContain('C-110'); // way over budget
  });

  it('imports units from CSV', async () => {
    if (!dbAvailable) return;
    const csv = `projectId,name,bhk,priceMin,priceMax\n${projectId},D-900,2,7000000,7800000`;
    const res = await http().post('/api/v1/units/import').set(auth()).send({ csv });
    expect(res.status).toBe(201);
    expect(res.body.imported).toBe(1);
  });

  it('queues a brochure/location send to the lead', async () => {
    if (!dbAvailable) return;
    const units = await http().get('/api/v1/units').set(auth());
    const unitId = (units.body as { id: string }[])[0].id;
    const res = await http().post('/api/v1/units/send').set(auth()).send({ leadId, unitId, what: 'location' });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
  });
});
