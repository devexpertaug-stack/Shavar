import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Leads + pipeline e2e (Task 3). Requires real Postgres (RLS). Self-skips when
 * no DB is reachable. Asserts:
 *   - dedup: creating a lead twice for the same phone yields ONE lead + merge
 *   - stage transition rule: moving to Lost without a reason is 400; with one 200
 *   - scope: a tele-caller sees only leads assigned to them
 */

const T = { slug: `t-${randomUUID().slice(0, 8)}`, id: randomUUID() };
const PASSWORD = 'password123';

let app: INestApplication;
let prisma: PrismaService;
let dbAvailable = true;

async function seed(): Promise<void> {
  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
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
    await tx.user.create({
      data: {
        tenantId: T.id,
        email: `caller@${T.slug}.test`,
        name: 'Caller',
        role: 'TELE_CALLER',
        passwordHash,
      },
    });
  });
}

async function cleanup(): Promise<void> {
  await prisma
    .$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${T.id}, true)`;
      await tx.activity.deleteMany({});
      await tx.lead.deleteMany({});
      await tx.contact.deleteMany({});
      await tx.pipelineStage.deleteMany({});
      await tx.user.deleteMany({});
      await tx.tenant.deleteMany({});
    })
    .catch(() => undefined);
}

function http() {
  return request(app.getHttpServer());
}
async function login(email: string): Promise<string> {
  const res = await http()
    .post('/api/v1/auth/login')
    .send({ tenantSlug: T.slug, email, password: PASSWORD });
  return res.body.accessToken as string;
}
async function userId(email: string): Promise<string> {
  const u = await prisma.authFindUserForLogin(T.id, email);
  return u!.id;
}

beforeAll(async () => {
  process.env.JWT_SECRET ??= 'e2e-access';
  process.env.JWT_REFRESH_SECRET ??= 'e2e-refresh';
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.use(cookieParser());
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

describe('Leads + pipeline (e2e)', () => {
  it('creates a lead and normalizes the phone to E.164', async () => {
    if (!dbAvailable) return;
    const token = await login(`owner@${T.slug}.test`);
    const res = await http()
      .post('/api/v1/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: '9811111111', name: 'Test Lead', source: 'MANUAL' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.contact.phoneE164).toBe('+919811111111');
    expect(res.body.stage).toBe('New');
  });

  it('dedups a repeat enquiry into one lead (FR-3)', async () => {
    if (!dbAvailable) return;
    const token = await login(`owner@${T.slug}.test`);
    const first = await http()
      .post('/api/v1/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: '98 222 22222', name: 'Dedup Guy' });
    const second = await http()
      .post('/api/v1/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: '+919822222222', name: 'Dedup Guy Again' });

    expect(first.body.id).toBe(second.body.id);
    // The repeat enquiry should have appended an ENQUIRY activity.
    const enquiries = (second.body.activities as { type: string }[]).filter(
      (a) => a.type === 'ENQUIRY',
    );
    expect(enquiries.length).toBeGreaterThanOrEqual(2);
  });

  it('requires a reason to move a lead to Lost (FR-20)', async () => {
    if (!dbAvailable) return;
    const token = await login(`owner@${T.slug}.test`);
    const created = await http()
      .post('/api/v1/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: '9833333333' });
    const id = created.body.id;

    const noReason = await http()
      .patch(`/api/v1/leads/${id}/stage`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stage: 'Lost' });
    expect(noReason.status).toBe(400);

    const withReason = await http()
      .patch(`/api/v1/leads/${id}/stage`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stage: 'Lost', lostReason: 'Out of budget' });
    expect(withReason.status).toBe(200);
    expect(withReason.body.stage).toBe('Lost');
    expect(withReason.body.lostReason).toBe('Out of budget');
  });

  it('scopes list results: a tele-caller sees only assigned leads', async () => {
    if (!dbAvailable) return;
    const ownerToken = await login(`owner@${T.slug}.test`);
    const callerId = await userId(`caller@${T.slug}.test`);

    // One lead assigned to the caller, one left unassigned.
    const assigned = await http()
      .post('/api/v1/leads')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ phone: '9844444444', name: 'Assigned' });
    await http()
      .patch(`/api/v1/leads/${assigned.body.id}/assign`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ assignedTo: callerId });
    await http()
      .post('/api/v1/leads')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ phone: '9855555555', name: 'Unassigned' });

    const callerToken = await login(`caller@${T.slug}.test`);
    const list = await http().get('/api/v1/leads').set('Authorization', `Bearer ${callerToken}`);
    expect(list.status).toBe(200);
    const names = (list.body.items as { contact: { name: string } }[]).map((l) => l.contact.name);
    expect(names).toContain('Assigned');
    expect(names).not.toContain('Unassigned');
  });

  it('forbids a tele-caller from creating leads (RBAC)', async () => {
    if (!dbAvailable) return;
    const callerToken = await login(`caller@${T.slug}.test`);
    const res = await http()
      .post('/api/v1/leads')
      .set('Authorization', `Bearer ${callerToken}`)
      .send({ phone: '9866666666' });
    expect(res.status).toBe(403);
  });

  it('returns the default pipeline stages', async () => {
    if (!dbAvailable) return;
    const token = await login(`owner@${T.slug}.test`);
    const res = await http().get('/api/v1/leads/stages').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const names = (res.body as { name: string }[]).map((s) => s.name);
    expect(names).toContain('New');
    expect(names).toContain('Lost');
    expect(names[0]).toBe('New');
  });
});
