-- CreateTable
CREATE TABLE "score_events" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "oldScore" INTEGER NOT NULL,
    "newScore" INTEGER NOT NULL,
    "reasons" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "score_events_tenantId_idx" ON "score_events"("tenantId");

-- CreateIndex
CREATE INDEX "score_events_tenantId_leadId_idx" ON "score_events"("tenantId", "leadId");

-- AddForeignKey
ALTER TABLE "score_events" ADD CONSTRAINT "score_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_events" ADD CONSTRAINT "score_events_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- RLS for score_events (PRD §5).
ALTER TABLE score_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE score_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON score_events;
CREATE POLICY tenant_isolation ON score_events
  USING ("tenantId" = app_current_tenant())
  WITH CHECK ("tenantId" = app_current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON score_events TO estateflow_app;

-- SECURITY DEFINER helper so the worker's nightly cron can enumerate tenants
-- to rescore (it runs with no tenant context). Returns only ids of active
-- tenants — a narrow, intentional read past RLS.
CREATE OR REPLACE FUNCTION list_active_tenant_ids()
RETURNS SETOF uuid
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT id FROM tenants WHERE "isActive" = true
$$;
