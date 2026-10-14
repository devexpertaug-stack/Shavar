-- CreateEnum
CREATE TYPE "WhatsAppProviderType" AS ENUM ('AISENSY', 'WATI', 'META_CLOUD', 'MOCK');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('text', 'image', 'audio', 'video', 'document', 'interactive', 'template');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('received', 'queued', 'sent', 'delivered', 'read', 'failed');

-- CreateEnum
CREATE TYPE "MessageSentBy" AS ENUM ('ai', 'user', 'system');

-- CreateTable
CREATE TABLE "provider_credentials" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "type" "WhatsAppProviderType" NOT NULL,
    "tenantKey" TEXT NOT NULL,
    "encryptedConfig" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "type" "MessageType" NOT NULL DEFAULT 'text',
    "body" TEXT,
    "mediaUrl" TEXT,
    "transcript" TEXT,
    "providerMessageId" TEXT,
    "status" "MessageStatus" NOT NULL DEFAULT 'received',
    "sentBy" "MessageSentBy" NOT NULL DEFAULT 'system',
    "userId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "provider_credentials_tenantKey_key" ON "provider_credentials"("tenantKey");

-- CreateIndex
CREATE INDEX "provider_credentials_tenantId_idx" ON "provider_credentials"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "provider_credentials_tenantId_type_key" ON "provider_credentials"("tenantId", "type");

-- CreateIndex
CREATE INDEX "messages_tenantId_idx" ON "messages"("tenantId");

-- CreateIndex
CREATE INDEX "messages_tenantId_leadId_idx" ON "messages"("tenantId", "leadId");

-- CreateIndex
CREATE UNIQUE INDEX "messages_tenantId_providerMessageId_key" ON "messages"("tenantId", "providerMessageId");

-- AddForeignKey
ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "messages" ADD CONSTRAINT "messages_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- Row-Level Security for the Task 4 tables (PRD §5). Same pattern as before.
-- ============================================================================
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY['provider_credentials', 'messages'];
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

GRANT SELECT, INSERT, UPDATE, DELETE ON provider_credentials, messages TO estateflow_app;

-- ============================================================================
-- Webhook bootstrap (SECURITY DEFINER). The public webhook endpoint resolves a
-- tenant from the opaque tenantKey BEFORE any tenant context exists, so it must
-- read provider_credentials past RLS. This function exposes only that single
-- lookup (owned by the privileged migration role => bypasses RLS).
-- ============================================================================
CREATE OR REPLACE FUNCTION wa_find_credential_by_key(p_key text)
RETURNS SETOF provider_credentials
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT * FROM provider_credentials WHERE "tenantKey" = p_key AND "isActive" = true
$$;
