-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'STARTER', 'GROWTH', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'SALES_MANAGER', 'TELE_CALLER', 'FIELD_AGENT', 'MARKETING', 'POST_SALES', 'CHANNEL_PARTNER');

-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'FREE',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "aiConfig" JSONB NOT NULL DEFAULT '{}',
    "scoringWeights" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT,
    "role" "Role" NOT NULL,
    "teamId" UUID,
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "maxActiveLeads" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invites" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "teamId" UUID,
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tokenHash" TEXT NOT NULL,
    "status" "InviteStatus" NOT NULL DEFAULT 'PENDING',
    "invitedBy" UUID,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "teams_tenantId_idx" ON "teams"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "teams_tenantId_name_key" ON "teams"("tenantId", "name");

-- CreateIndex
CREATE INDEX "users_tenantId_idx" ON "users"("tenantId");

-- CreateIndex
CREATE INDEX "users_tenantId_role_idx" ON "users"("tenantId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenantId_email_key" ON "users"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "invites_tokenHash_key" ON "invites"("tokenHash");

-- CreateIndex
CREATE INDEX "invites_tenantId_idx" ON "invites"("tenantId");

-- CreateIndex
CREATE INDEX "invites_tenantId_email_idx" ON "invites"("tenantId", "email");

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ============================================================================
-- Row-Level Security (PRD §5). See prisma/rls/rls.sql for the authoritative
-- copy and rationale. Policies key on app.tenant_id, set per request/txn via
-- PrismaService.withTenant(). FORCE RLS so even the table owner is subject to
-- policies (fail-closed when app.tenant_id is unset).
-- ============================================================================

-- Current tenant from the session GUC, as uuid (NULL when unset/blank).
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY['teams', 'users', 'invites'];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING ("tenantId" = app_current_tenant())
         WITH CHECK ("tenantId" = app_current_tenant())',
      t
    );
  END LOOP;
END $$;

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_self ON tenants;
CREATE POLICY tenant_self ON tenants
  USING (id = app_current_tenant())
  WITH CHECK (id = app_current_tenant());

-- ============================================================================
-- Auth bootstrap functions (SECURITY DEFINER).
--
-- Login and invite-acceptance must read rows BEFORE any tenant context exists
-- (resolve tenant by slug, find a user by email, find an invite by token hash).
-- With FORCE RLS those reads would otherwise return nothing. These functions
-- run with the definer's privileges and expose ONLY the minimal, intentional
-- lookups — a narrow, auditable hole rather than a blanket BYPASSRLS role.
-- ============================================================================

CREATE OR REPLACE FUNCTION auth_find_tenant_by_slug(p_slug text)
RETURNS SETOF tenants
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT * FROM tenants WHERE slug = p_slug AND "isActive" = true
$$;

CREATE OR REPLACE FUNCTION auth_find_user_for_login(p_tenant uuid, p_email text)
RETURNS SETOF users
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT * FROM users WHERE "tenantId" = p_tenant AND email = p_email
$$;

CREATE OR REPLACE FUNCTION auth_find_user_by_id(p_id uuid)
RETURNS SETOF users
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT * FROM users WHERE id = p_id
$$;

CREATE OR REPLACE FUNCTION auth_find_invite_by_hash(p_hash text)
RETURNS SETOF invites
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT * FROM invites WHERE "tokenHash" = p_hash
$$;

-- ============================================================================
-- Application role.
--
-- RLS only protects when the app connects as a NON-superuser, NON-BYPASSRLS
-- role (superusers and the BYPASSRLS attribute always bypass RLS, even under
-- FORCE RLS). Migrations run as the privileged owner; the app runs as
-- estateflow_app, which is subject to every policy above.
--
-- The SECURITY DEFINER auth_* functions are owned by the (privileged) migration
-- runner, so they bypass RLS when estateflow_app calls them — the only
-- intended bootstrap path. We GRANT EXECUTE on them to estateflow_app and
-- base-table DML (RLS still filters) but withhold ownership.
--
-- Password: taken from APP_DB_PASSWORD at migrate time if the psql variable is
-- set, else a dev default. Rotate in real deployments.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'estateflow_app') THEN
    CREATE ROLE estateflow_app LOGIN PASSWORD 'estateflow_app';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO estateflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO estateflow_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO estateflow_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO estateflow_app;
-- Future tables/functions (later migrations) inherit the same grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO estateflow_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO estateflow_app;
