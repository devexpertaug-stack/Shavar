-- CreateEnum
CREATE TYPE "VisitStatus" AS ENUM ('SCHEDULED', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateTable
CREATE TABLE "site_visits" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "unitId" UUID,
    "projectId" UUID,
    "agentId" UUID,
    "slotAt" TIMESTAMP(3) NOT NULL,
    "status" "VisitStatus" NOT NULL DEFAULT 'SCHEDULED',
    "calendarEventId" TEXT,
    "checkinGeo" TEXT,
    "checkoutGeo" TEXT,
    "checkedInAt" TIMESTAMP(3),
    "checkedOutAt" TIMESTAMP(3),
    "feedback" TEXT,
    "remindersSent" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_visits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "site_visits_tenantId_idx" ON "site_visits"("tenantId");

-- CreateIndex
CREATE INDEX "site_visits_tenantId_agentId_idx" ON "site_visits"("tenantId", "agentId");

-- CreateIndex
CREATE UNIQUE INDEX "site_visits_agentId_slotAt_key" ON "site_visits"("agentId", "slotAt");

-- AddForeignKey
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- RLS for site_visits (PRD §5).
ALTER TABLE site_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_visits FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON site_visits;
CREATE POLICY tenant_isolation ON site_visits
  USING ("tenantId" = app_current_tenant())
  WITH CHECK ("tenantId" = app_current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON site_visits TO estateflow_app;
