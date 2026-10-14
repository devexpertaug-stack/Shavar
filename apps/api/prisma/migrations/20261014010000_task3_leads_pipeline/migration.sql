-- CreateEnum
CREATE TYPE "Tier" AS ENUM ('HOT', 'WARM', 'COLD');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('WHATSAPP', 'META_LEAD_ADS', 'NINETY_NINE_ACRES', 'MAGICBRICKS', 'HOUSING', 'WEBSITE', 'REFERRAL', 'MANUAL');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('NOTE', 'STAGE_CHANGE', 'ASSIGNMENT', 'CALL', 'VISIT', 'ENQUIRY', 'MESSAGE', 'SCORE_CHANGE');

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "name" TEXT,
    "language" TEXT,
    "optedIn" BOOLEAN NOT NULL DEFAULT true,
    "optedOutAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_stages" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "isTerminal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipeline_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "source" "LeadSource" NOT NULL DEFAULT 'MANUAL',
    "stage" TEXT NOT NULL DEFAULT 'New',
    "tier" "Tier" NOT NULL DEFAULT 'COLD',
    "score" INTEGER NOT NULL DEFAULT 0,
    "assignedTo" UUID,
    "qualification" JSONB NOT NULL DEFAULT '{}',
    "lostReason" TEXT,
    "lastInboundAt" TIMESTAMP(3),
    "nextFollowupAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "type" "ActivityType" NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "userId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contacts_tenantId_idx" ON "contacts"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_tenantId_phoneE164_key" ON "contacts"("tenantId", "phoneE164");

-- CreateIndex
CREATE INDEX "pipeline_stages_tenantId_idx" ON "pipeline_stages"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_stages_tenantId_name_key" ON "pipeline_stages"("tenantId", "name");

-- CreateIndex
CREATE INDEX "leads_tenantId_idx" ON "leads"("tenantId");

-- CreateIndex
CREATE INDEX "leads_tenantId_stage_idx" ON "leads"("tenantId", "stage");

-- CreateIndex
CREATE INDEX "leads_tenantId_assignedTo_idx" ON "leads"("tenantId", "assignedTo");

-- CreateIndex
CREATE INDEX "leads_tenantId_tier_idx" ON "leads"("tenantId", "tier");

-- CreateIndex
CREATE INDEX "activities_tenantId_idx" ON "activities"("tenantId");

-- CreateIndex
CREATE INDEX "activities_tenantId_leadId_idx" ON "activities"("tenantId", "leadId");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- Row-Level Security for the Task 3 tables (PRD §5). Same pattern as Task 2:
-- FORCE RLS, isolate on app.tenant_id (set per-txn by PrismaService.withTenant).
-- app_current_tenant() was created in the Task 2 migration.
-- ============================================================================
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY['contacts', 'pipeline_stages', 'leads', 'activities'];
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

-- Ensure the application role can DML the new tables (ALTER DEFAULT PRIVILEGES
-- from Task 2 should cover these, but we grant explicitly for robustness).
GRANT SELECT, INSERT, UPDATE, DELETE ON contacts, pipeline_stages, leads, activities TO estateflow_app;
