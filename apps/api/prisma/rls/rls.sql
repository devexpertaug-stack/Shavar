-- Row-Level Security for EstateFlow multi-tenancy (PRD §5 Security).
--
-- Every request sets `app.tenant_id` on its DB connection/transaction (see
-- PrismaService.withTenant). Policies restrict visible rows to that tenant.
-- The table owner (the role Prisma connects as) bypasses RLS by default, so we
-- FORCE RLS to make the owner subject to policies too — defense in depth so a
-- missing tenant filter in app code cannot leak across tenants.
--
-- app.tenant_id is read via current_setting('app.tenant_id', true); the `true`
-- argument means "return NULL if unset" instead of erroring. When unset, the
-- tenant_id = NULL comparison yields no rows, i.e. fail-closed.

-- Helper: current tenant from the session GUC, as uuid (NULL when unset/blank).
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

-- The `tenants` table itself: a row is visible when it IS the current tenant.
-- (Login/tenant-resolution needs to read tenants before a tenant context is
-- established; that path uses a dedicated unscoped connection — see
-- PrismaService — so we still FORCE RLS here safely.)
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_self ON tenants;
CREATE POLICY tenant_self ON tenants
  USING (id = app_current_tenant())
  WITH CHECK (id = app_current_tenant());
