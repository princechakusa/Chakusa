-- LOOP 2D: durable attachment scan leasing and provider template synchronization history.
ALTER TABLE "message_attachments" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "provider_templates"
  ADD COLUMN "source_checksum" TEXT,
  ADD COLUMN "last_sync_at" TIMESTAMP(3),
  ADD COLUMN "last_error" TEXT;

CREATE TABLE "template_sync_attempts" (
  "id" TEXT NOT NULL,
  "business_id" TEXT,
  "provider_template_id" TEXT NOT NULL,
  "source_checksum" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "detail" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "template_sync_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "template_sync_attempts_provider_template_id_created_at_idx" ON "template_sync_attempts"("provider_template_id", "created_at");
CREATE INDEX "template_sync_attempts_business_id_status_created_at_idx" ON "template_sync_attempts"("business_id", "status", "created_at");
ALTER TABLE "template_sync_attempts" ADD CONSTRAINT "template_sync_attempts_provider_template_id_fkey" FOREIGN KEY ("provider_template_id") REFERENCES "provider_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
