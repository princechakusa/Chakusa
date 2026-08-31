-- AlterTable
ALTER TABLE "conversation_participants" ADD COLUMN     "ended_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "message_attachments" ADD COLUMN     "last_error" TEXT,
ADD COLUMN     "retry_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "upload_status" TEXT NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "provider_credentials" ADD COLUMN     "expires_at" TIMESTAMP(3),
ADD COLUMN     "last_validated_at" TIMESTAMP(3),
ADD COLUMN     "validation_status" TEXT NOT NULL DEFAULT 'UNKNOWN';

-- CreateTable
CREATE TABLE "attachment_processing_events" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "attachment_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "detail" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachment_processing_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_credential_audits" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "credential_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "key_version" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_credential_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_health_samples" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "channel_account_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "latency_ms" INTEGER,
    "error_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "throughput" INTEGER NOT NULL DEFAULT 0,
    "rate_limit_remaining" INTEGER,
    "credential_valid" BOOLEAN,
    "detail" TEXT,
    "sampled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_health_samples_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attachment_processing_events_business_id_status_created_at_idx" ON "attachment_processing_events"("business_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "attachment_processing_events_attachment_id_created_at_idx" ON "attachment_processing_events"("attachment_id", "created_at");

-- CreateIndex
CREATE INDEX "provider_credential_audits_business_id_created_at_idx" ON "provider_credential_audits"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "provider_credential_audits_credential_id_created_at_idx" ON "provider_credential_audits"("credential_id", "created_at");

-- CreateIndex
CREATE INDEX "provider_health_samples_business_id_sampled_at_idx" ON "provider_health_samples"("business_id", "sampled_at");

-- CreateIndex
CREATE INDEX "provider_health_samples_channel_account_id_sampled_at_idx" ON "provider_health_samples"("channel_account_id", "sampled_at");

-- AddForeignKey
ALTER TABLE "attachment_processing_events" ADD CONSTRAINT "attachment_processing_events_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "message_attachments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_credential_audits" ADD CONSTRAINT "provider_credential_audits_credential_id_fkey" FOREIGN KEY ("credential_id") REFERENCES "provider_credentials"("id") ON DELETE CASCADE ON UPDATE CASCADE;
