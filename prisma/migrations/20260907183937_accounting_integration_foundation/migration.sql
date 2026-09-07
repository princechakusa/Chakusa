-- CreateEnum
CREATE TYPE "AccountingProvider" AS ENUM ('quickbooks', 'xero');

-- CreateEnum
CREATE TYPE "AccountingConnectionStatus" AS ENUM ('pending', 'connected', 'error', 'disconnected');

-- CreateEnum
CREATE TYPE "AccountingSyncDirection" AS ENUM ('push', 'pull');

-- CreateEnum
CREATE TYPE "AccountingSyncEntity" AS ENUM ('customer', 'invoice', 'payment', 'expense');

-- CreateEnum
CREATE TYPE "AccountingSyncStatus" AS ENUM ('pending', 'success', 'failed', 'skipped');

-- CreateTable
CREATE TABLE "accounting_connections" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "provider" "AccountingProvider" NOT NULL,
    "status" "AccountingConnectionStatus" NOT NULL DEFAULT 'pending',
    "external_org_id" TEXT,
    "external_org_name" TEXT,
    "access_token_enc" TEXT,
    "refresh_token_enc" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "scopes" TEXT,
    "last_sync_at" TIMESTAMP(3),
    "last_error" TEXT,
    "connected_at" TIMESTAMP(3),
    "disconnected_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_sync_logs" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "provider" "AccountingProvider" NOT NULL,
    "direction" "AccountingSyncDirection" NOT NULL,
    "entity" "AccountingSyncEntity" NOT NULL,
    "local_id" TEXT,
    "external_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "status" "AccountingSyncStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "payload_digest" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "accounting_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accounting_connections_status_updated_at_idx" ON "accounting_connections"("status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_connections_business_id_provider_key" ON "accounting_connections"("business_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_sync_logs_idempotency_key_key" ON "accounting_sync_logs"("idempotency_key");

-- CreateIndex
CREATE INDEX "accounting_sync_logs_connection_id_created_at_idx" ON "accounting_sync_logs"("connection_id", "created_at");

-- CreateIndex
CREATE INDEX "accounting_sync_logs_business_id_entity_status_idx" ON "accounting_sync_logs"("business_id", "entity", "status");

-- AddForeignKey
ALTER TABLE "accounting_connections" ADD CONSTRAINT "accounting_connections_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_sync_logs" ADD CONSTRAINT "accounting_sync_logs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_sync_logs" ADD CONSTRAINT "accounting_sync_logs_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "accounting_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
