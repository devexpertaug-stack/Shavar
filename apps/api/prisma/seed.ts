/**
 * Prisma seed. Creates two demo tenants, each with one user per RBAC role and a
 * team. The second tenant exists so the cross-tenant isolation e2e test has
 * data on "the other side". Run with: pnpm db:seed
 *
 * RLS note: tables FORCE row-level security, so every write must run with
 * app.tenant_id set to the target tenant. We pre-generate each tenant's UUID,
 * set the GUC, then create the tenant row and its children in one transaction.
 *
 * Default password for every seeded user: "password123".
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient, type Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { DEFAULT_STAGES, LOST_STAGE, BOOKED_STAGE, normalizePhoneE164 } from '@estateflow/shared';

const prisma = new PrismaClient();

const ROLES: Role[] = ['OWNER', 'SALES_MANAGER', 'TELE_CALLER', 'FIELD_AGENT', 'MARKETING'];

async function seedTenant(opts: {
  slug: string;
  name: string;
  languages: string[];
}): Promise<string> {
  const passwordHash = await argon2.hash('password123', { type: argon2.argon2id });
  const tenantId = randomUUID();

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    // Idempotency: a prior run may already have this slug. If so, reuse it.
    const existing = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM auth_find_tenant_by_slug(${opts.slug})`;
    const id = existing[0]?.id ?? tenantId;
    if (existing[0]) {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${id}, true)`;
    } else {
      await tx.tenant.create({
        data: {
          id: tenantId,
          name: opts.name,
          slug: opts.slug,
          plan: 'GROWTH',
          settings: { country: 'IN', currency: 'INR', timezone: 'Asia/Kolkata' },
        },
      });
    }

    const team = await tx.team.upsert({
      where: { tenantId_name: { tenantId: id, name: 'Sales A' } },
      update: {},
      create: { tenantId: id, name: 'Sales A' },
    });

    for (const role of ROLES) {
      const email = `${role.toLowerCase()}@${opts.slug}.test`;
      await tx.user.upsert({
        where: { tenantId_email: { tenantId: id, email } },
        update: {},
        create: {
          tenantId: id,
          email,
          name: `${role} User`,
          role,
          passwordHash,
          languages: opts.languages,
          teamId: role === 'TELE_CALLER' || role === 'SALES_MANAGER' ? team.id : null,
        },
      });
    }
  });

  const tid = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM auth_find_tenant_by_slug(${opts.slug})`;
    return rows[0]!.id;
  });

  // eslint-disable-next-line no-console
  console.log(`Seeded tenant "${opts.name}" (${opts.slug}) with ${ROLES.length} users`);
  return tid;
}

/** Seed default pipeline stages + a few demo leads for the kanban demo. */
async function seedLeadsAndPipeline(tenantId: string, slug: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    if ((await tx.pipelineStage.count()) === 0) {
      await tx.pipelineStage.createMany({
        data: DEFAULT_STAGES.map((name, order) => ({
          tenantId,
          name,
          order,
          isTerminal: name === LOST_STAGE || name === BOOKED_STAGE,
        })),
      });
    }

    if ((await tx.lead.count()) > 0) return;

    const caller = await tx.user.findFirst({ where: { role: 'TELE_CALLER' } });

    const demoLeads = [
      { name: 'Rohit Sharma', phone: '9810000001', stage: 'New', tier: 'HOT', score: 78 },
      { name: 'Anjali Verma', phone: '9810000002', stage: 'Contacted', tier: 'WARM', score: 55 },
      { name: 'Imran Khan', phone: '9810000003', stage: 'Qualified', tier: 'HOT', score: 82 },
      { name: 'Sneha Patil', phone: '9810000004', stage: 'Visit Scheduled', tier: 'WARM', score: 61 },
      { name: 'Vikram Rao', phone: '9810000005', stage: 'New', tier: 'COLD', score: 20 },
    ] as const;

    for (const l of demoLeads) {
      const phoneE164 = normalizePhoneE164(l.phone)!;
      const contact = await tx.contact.create({
        data: { tenantId, phoneE164, name: l.name, language: 'en' },
      });
      const lead = await tx.lead.create({
        data: {
          tenantId,
          contactId: contact.id,
          source: 'WHATSAPP',
          stage: l.stage,
          tier: l.tier,
          score: l.score,
          // Assign a couple to the tele-caller so scoping is visible in the demo.
          assignedTo: l.tier === 'HOT' ? (caller?.id ?? null) : null,
        },
      });
      await tx.activity.create({
        data: {
          tenantId,
          leadId: lead.id,
          type: 'ENQUIRY',
          payload: { note: 'Seeded lead' },
        },
      });
    }
  });

  // eslint-disable-next-line no-console
  console.log(`Seeded pipeline + demo leads for "${slug}"`);
}

async function main(): Promise<void> {
  const demoId = await seedTenant({ slug: 'demo', name: 'Demo Realty', languages: ['en', 'hi'] });
  await seedTenant({ slug: 'acme', name: 'Acme Estates', languages: ['en', 'mr'] });
  await seedLeadsAndPipeline(demoId, 'demo');
  // eslint-disable-next-line no-console
  console.log('Login with e.g. tenantSlug=demo email=owner@demo.test password=password123');
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
