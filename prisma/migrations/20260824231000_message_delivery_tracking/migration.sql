ALTER TYPE "MessageStatus" ADD VALUE IF NOT EXISTS 'delivered';
ALTER TYPE "MessageStatus" ADD VALUE IF NOT EXISTS 'undelivered';

ALTER TABLE "messages"
  ADD COLUMN "provider_error_code" TEXT,
  ADD COLUMN "delivered_at" TIMESTAMP(3);

CREATE INDEX "messages_business_id_status_created_at_idx"
  ON "messages"("business_id", "status", "created_at");
