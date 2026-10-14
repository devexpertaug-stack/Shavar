import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  Prisma,
  PrismaClient,
  type Tenant,
  type User,
  type Invite,
  type ProviderCredential,
} from '@prisma/client';

/**
 * PrismaService exposes two access modes to support Postgres RLS multi-tenancy
 * (PRD §5):
 *
 *  - `withTenant(tenantId, fn)` runs `fn` inside a transaction that first does
 *    `SET LOCAL app.tenant_id = '<uuid>'`. RLS policies then scope every row to
 *    that tenant. SET LOCAL is transaction-scoped, so it resets automatically
 *    and is safe with connection pooling (no cross-tenant leakage).
 *
 *  - the service itself (`this.user`, …) is the *unscoped* client used only for
 *    narrow auth bootstrap reads that must happen before a tenant context
 *    exists (resolve tenant by slug, find a user for login, accept an invite).
 *    When DATABASE_ADMIN_URL is set it should point at a BYPASSRLS role; absent
 *    that, it reuses the primary connection (fine for dev/CI where the app role
 *    owns the tables).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
    } catch (err) {
      // Don't crash boot if the DB is briefly unavailable; /health reports it.
      this.logger.warn(`Prisma failed to connect on init: ${(err as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Lightweight connectivity probe used by the health check (Task 1). */
  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }

  /**
   * Run a callback with RLS scoped to `tenantId`. All queries issued on the
   * provided transactional client are filtered by the tenant_isolation policy.
   */
  async withTenant<T>(
    tenantId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      // Parameterized to avoid any injection via tenantId. set_config(…, true)
      // => local (transaction) scope, mirroring SET LOCAL.
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    });
  }

  // --- Auth bootstrap lookups via SECURITY DEFINER functions (RLS-safe) ------

  async authFindTenantBySlug(slug: string): Promise<Tenant | null> {
    const rows = await this.$queryRaw<Tenant[]>`SELECT * FROM auth_find_tenant_by_slug(${slug})`;
    return rows[0] ?? null;
  }

  async authFindUserForLogin(tenantId: string, email: string): Promise<User | null> {
    const rows = await this.$queryRaw<User[]>`
      SELECT * FROM auth_find_user_for_login(${tenantId}::uuid, ${email})`;
    return rows[0] ?? null;
  }

  async authFindUserById(id: string): Promise<User | null> {
    const rows = await this.$queryRaw<User[]>`SELECT * FROM auth_find_user_by_id(${id}::uuid)`;
    return rows[0] ?? null;
  }

  async authFindInviteByHash(hash: string): Promise<Invite | null> {
    const rows = await this.$queryRaw<Invite[]>`SELECT * FROM auth_find_invite_by_hash(${hash})`;
    return rows[0] ?? null;
  }

  /**
   * Resolve an active provider credential by its opaque tenantKey. Used by the
   * public WhatsApp webhook before a tenant context exists (RLS-safe via the
   * SECURITY DEFINER function).
   */
  async findCredentialByKey(tenantKey: string): Promise<ProviderCredential | null> {
    const rows = await this.$queryRaw<ProviderCredential[]>`
      SELECT * FROM wa_find_credential_by_key(${tenantKey})`;
    return rows[0] ?? null;
  }
}
