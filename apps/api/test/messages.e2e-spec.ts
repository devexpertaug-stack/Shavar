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
 * Chat inbox + outbound e2e (Task 5). Requires real Postgres + Redis.
 * Self-skips when unavailable. Asserts:
 *   - 24h window: text is blocked when the window is closed, template allowed
 *   - text is allowed when the window is open
 *   - an opted-out contact cannot be messaged
 */

const T = { slug: `m-${randomUUID().slice(0, 8)}`, id: randomUUID() };
const PASSWORD = 'password123';

let app: INestApplication;
let prisma: PrismaService;
let dbAvailable = true;
let ownerToken = '';

/** Create a lead whose contact lastInboundAt / optedIn we control. */
async function makeLead(opts: {
  phone: string;
  lastInboundAt: Date | null;
  optedIn?: boolean;
}): Promise<string> {
  return prisma.withTenant(T.id, async (tx) => {
    const contact = await tx.contact.create({
      data: {
        tenantId: T.id,
        phoneE164: opts.phone,
        optedIn: opts.optedIn ?? true,
        optedOutAt: opts.optedIn === false ? new Date() : null,
      },
    });
    const lead = await tx.lead.create({
      data: {
        tenantId: T.id,
        contactId: contact.id,
        source: 'WHATSAPP',
        stage: 'New',
        lastInboundAt: opts.lastInboundAt,
      },
    });
    return lead.id;
  });
}

async function seed(): Promise<void> {
  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${T.id}, true)`;
    await tx.tenant.create({ data: { id: T.id, name: T.slug, slug: T.slug, plan: 'GROWTH' } });
    await tx.user.create({
      data: { tenantId: T.id, email: `owner@${T.slug}.test`, name: 'Owner', role: 'OWNER', passwordHash },
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
      await tx.template.deleteMany({});
      await tx.user.deleteMany({});
      await tx.tenant.deleteMany({});
    })
    .catch(() => undefined);
}

function http() {
  return request(app.getHttpServer());
}
function send(leadId: string, body: Record<string, unknown>) {
  return http()
    .post(`/api/v1/leads/${leadId}/messages`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send(body);
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
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ tenantSlug: T.slug, email: `owner@${T.slug}.test`, password: PASSWORD });
    ownerToken = login.body.accessToken;
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

describe('Inbox + outbound (e2e)', () => {
  it('allows text inside the 24h window', async () => {
    if (!dbAvailable) return;
    const leadId = await makeLead({ phone: '+919812340001', lastInboundAt: new Date() });
    const res = await send(leadId, { kind: 'text', text: 'Hello!' });
    expect(res.status).toBe(201);
    expect(res.body.direction).toBe('OUTBOUND');
    expect(res.body.status).toBe('queued');
  });

  it('blocks free-form text outside the 24h window', async () => {
    if (!dbAvailable) return;
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const leadId = await makeLead({ phone: '+919812340002', lastInboundAt: old });
    const res = await send(leadId, { kind: 'text', text: 'ping' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/24-hour window/);
  });

  it('allows a template outside the window', async () => {
    if (!dbAvailable) return;
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const leadId = await makeLead({ phone: '+919812340003', lastInboundAt: old });
    const res = await send(leadId, { kind: 'template', templateName: 'welcome', templateParams: ['Rohit'] });
    expect(res.status).toBe(201);
    expect(res.body.type).toBe('template');
  });

  it('refuses to message an opted-out contact', async () => {
    if (!dbAvailable) return;
    const leadId = await makeLead({ phone: '+919812340004', lastInboundAt: new Date(), optedIn: false });
    const res = await send(leadId, { kind: 'text', text: 'hi' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/opted out/);
  });

  it('syncs and lists templates', async () => {
    if (!dbAvailable) return;
    const sync = await http()
      .post('/api/v1/templates/sync')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(sync.status).toBe(201);
    expect(sync.body.synced).toBeGreaterThanOrEqual(1);
    const list = await http().get('/api/v1/templates').set('Authorization', `Bearer ${ownerToken}`);
    expect((list.body as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  it('returns a conversation list and thread', async () => {
    if (!dbAvailable) return;
    const leadId = await makeLead({ phone: '+919812340005', lastInboundAt: new Date() });
    await send(leadId, { kind: 'text', text: 'first' });
    const convos = await http()
      .get('/api/v1/inbox/conversations')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(convos.status).toBe(200);
    const thread = await http()
      .get(`/api/v1/leads/${leadId}/messages`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(thread.status).toBe(200);
    expect(thread.body.messages.length).toBeGreaterThanOrEqual(1);
  });
});
