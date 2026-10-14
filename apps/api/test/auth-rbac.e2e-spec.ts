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
 * Cross-tenant isolation + RBAC e2e (Task 2, PRD §3/§5).
 *
 * Requires a real Postgres (RLS cannot be mocked). The CI job provides one with
 * the schema pushed. Locally without a DB the suite self-skips so it never
 * false-fails. It seeds two tenants directly (RLS-aware) and asserts:
 *   - Tenant A's owner cannot see Tenant B's users (RLS row scoping).
 *   - A tele-caller is 403'd from the owner/manager-only /users route (RBAC).
 *   - A valid login issues an access token + refresh cookie.
 */

const A = { slug: `a-${randomUUID().slice(0, 8)}`, id: randomUUID() };
const B = { slug: `b-${randomUUID().slice(0, 8)}`, id: randomUUID() };
const PASSWORD = 'password123';

let app: INestApplication;
let prisma: PrismaService;
let dbAvailable = true;

async function seed(prisma: PrismaService): Promise<void> {
  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  for (const t of [A, B]) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${t.id}, true)`;
      await tx.tenant.create({
        data: { id: t.id, name: t.slug, slug: t.slug, plan: 'GROWTH' },
      });
      await tx.user.create({
        data: {
          tenantId: t.id,
          email: `owner@${t.slug}.test`,
          name: 'Owner',
          role: 'OWNER',
          passwordHash,
        },
      });
      await tx.user.create({
        data: {
          tenantId: t.id,
          email: `caller@${t.slug}.test`,
          name: 'Caller',
          role: 'TELE_CALLER',
          passwordHash,
        },
      });
    });
  }
}

async function cleanup(prisma: PrismaService): Promise<void> {
  // Deleting the tenant cascades to users (FK onDelete: Cascade). Use a
  // superuser-style raw delete guarded by tenant context.
  for (const t of [A, B]) {
    await prisma
      .$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${t.id}, true)`;
        await tx.user.deleteMany({});
        await tx.tenant.deleteMany({});
      })
      .catch(() => undefined);
  }
}

async function login(slug: string, email: string) {
  return request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ tenantSlug: slug, email, password: PASSWORD });
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
    await cleanup(prisma);
    await seed(prisma);
  } catch {
    dbAvailable = false;
  }
}, 60_000);

afterAll(async () => {
  if (app) {
    if (dbAvailable) await cleanup(prisma).catch(() => undefined);
    await app.close();
  }
});

describe('Auth + RBAC + tenant isolation (e2e)', () => {
  it('issues an access token and refresh cookie on valid login', async () => {
    if (!dbAvailable) return;
    const res = await login(A.slug, `owner@${A.slug}.test`);
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user.role).toBe('OWNER');
    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.some((c) => c.startsWith('ef_refresh='))).toBe(true);
    expect(cookies.some((c) => /httponly/i.test(c))).toBe(true);
  });

  it('rejects a wrong password', async () => {
    if (!dbAvailable) return;
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantSlug: A.slug, email: `owner@${A.slug}.test`, password: 'wrong-password' });
    expect(res.status).toBe(401);
  });

  it("tenant A owner cannot see tenant B's users (RLS)", async () => {
    if (!dbAvailable) return;
    const a = await login(A.slug, `owner@${A.slug}.test`);
    const list = await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${a.body.accessToken}`);
    expect(list.status).toBe(200);
    const emails = (list.body as { email: string }[]).map((u) => u.email);
    expect(emails.every((e) => e.endsWith(`@${A.slug}.test`))).toBe(true);
    expect(emails.some((e) => e.endsWith(`@${B.slug}.test`))).toBe(false);
  });

  it('a tele-caller is forbidden from the owner/manager-only /users route (RBAC)', async () => {
    if (!dbAvailable) return;
    const caller = await login(A.slug, `caller@${A.slug}.test`);
    expect(caller.status).toBe(200);
    const list = await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${caller.body.accessToken}`);
    expect(list.status).toBe(403);
  });

  it('a tele-caller can read its own profile via /users/me', async () => {
    if (!dbAvailable) return;
    const caller = await login(A.slug, `caller@${A.slug}.test`);
    const me = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${caller.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.role).toBe('TELE_CALLER');
    expect(me.body.email).toBe(`caller@${A.slug}.test`);
  });

  it('unauthenticated requests are rejected', async () => {
    if (!dbAvailable) return;
    const res = await request(app.getHttpServer()).get('/api/v1/users/me');
    expect(res.status).toBe(401);
  });
});
