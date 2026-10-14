-- CreateEnum
CREATE TYPE "CallOutcome" AS ENUM ('connected', 'no_answer', 'callback', 'not_interested', 'visit_booked');

-- CreateTable
CREATE TABLE "calls" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "userId" UUID,
    "providerCallId" TEXT,
    "durationSec" INTEGER,
    "recordingUrl" TEXT,
    "transcript" TEXT,
    "summary" TEXT,
    "outcome" "CallOutcome",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calls_tenantId_idx" ON "calls"("tenantId");

-- CreateIndex
CREATE INDEX "calls_tenantId_leadId_idx" ON "calls"("tenantId", "leadId");

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- RLS for calls (PRD §5).
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE calls FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON calls;
CREATE POLICY tenant_isolation ON calls
  USING ("tenantId" = app_current_tenant())
  WITH CHECK ("tenantId" = app_current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON calls TO estateflow_app;
