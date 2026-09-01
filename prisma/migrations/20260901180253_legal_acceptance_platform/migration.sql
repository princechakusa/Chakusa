-- CreateEnum
CREATE TYPE "LegalDocumentType" AS ENUM ('PRIVACY_POLICY', 'TERMS_OF_SERVICE', 'COOKIE_POLICY', 'AI_DISCLOSURE');

-- CreateEnum
CREATE TYPE "LegalAcceptanceScope" AS ENUM ('CUSTOMER', 'BUSINESS', 'ADMIN');

-- DropIndex
DROP INDEX "service_offerings_business_id_category_sort_order_idx";

-- DropIndex
DROP INDEX "users_account_status_created_at_idx";

-- AlterTable
ALTER TABLE "appointments" ALTER COLUMN "starts_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "ends_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "reminder_sent_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "booking_blocks" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "businesses" ALTER COLUMN "onboarding_completed_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "message_attachments" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "public_booking_access" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "service_offerings" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateTable
CREATE TABLE "legal_document_versions" (
    "id" TEXT NOT NULL,
    "type" "LegalDocumentType" NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "summary" TEXT,
    "requires_reacceptance" BOOLEAN NOT NULL DEFAULT true,
    "effective_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_admin_membership_id" TEXT,

    CONSTRAINT "legal_document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_acceptance_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "document_version_id" TEXT NOT NULL,
    "scope" "LegalAcceptanceScope" NOT NULL,
    "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "platform" TEXT,
    "language" TEXT,
    "country" TEXT,
    "device" TEXT,
    "ip_address" TEXT,
    "session_id" TEXT,
    "source" TEXT NOT NULL,

    CONSTRAINT "legal_acceptance_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "legal_document_versions_type_status_idx" ON "legal_document_versions"("type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "legal_document_versions_type_version_key" ON "legal_document_versions"("type", "version");

-- CreateIndex
CREATE INDEX "legal_acceptance_events_user_id_document_version_id_idx" ON "legal_acceptance_events"("user_id", "document_version_id");

-- CreateIndex
CREATE INDEX "legal_acceptance_events_document_version_id_idx" ON "legal_acceptance_events"("document_version_id");

-- AddForeignKey
ALTER TABLE "legal_acceptance_events" ADD CONSTRAINT "legal_acceptance_events_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "legal_document_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "appointment_payment_transactions_business_id_status_created_at_" RENAME TO "appointment_payment_transactions_business_id_status_created_idx";

-- RenameIndex
ALTER INDEX "appointments_status_payment_status_ends_at_payment_reminder_sen" RENAME TO "appointments_status_payment_status_ends_at_payment_reminder_idx";

-- RenameIndex
ALTER INDEX "event_deliveries_status_next_attempt_at_lease_expires_at_create" RENAME TO "event_deliveries_status_next_attempt_at_lease_expires_at_cr_idx";

-- RenameIndex
ALTER INDEX "outbox_events_business_id_aggregate_type_aggregate_id_created_a" RENAME TO "outbox_events_business_id_aggregate_type_aggregate_id_creat_idx";

-- RenameIndex
ALTER INDEX "service_offerings_business_id_active_publicly_bookable_sort_ord" RENAME TO "service_offerings_business_id_active_publicly_bookable_sort_idx";

-- RenameIndex
ALTER INDEX "workflows_status_schedule_enabled_next_trigger_at_schedule_leas" RENAME TO "workflows_status_schedule_enabled_next_trigger_at_schedule__idx";
