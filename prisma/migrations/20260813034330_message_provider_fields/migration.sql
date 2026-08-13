-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "provider" TEXT,
ADD COLUMN     "provider_message_id" TEXT;

-- CreateIndex
CREATE INDEX "messages_provider_message_id_idx" ON "messages"("provider_message_id");
