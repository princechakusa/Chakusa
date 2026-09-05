-- CreateEnum
CREATE TYPE "QuoteDocumentType" AS ENUM ('ESTIMATE', 'QUOTE');

-- CreateEnum
CREATE TYPE "QuoteDocumentStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'CANCELED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "QuoteEventType" AS ENUM ('CREATED', 'SENT', 'VIEWED', 'REVISED', 'ACCEPTED', 'DECLINED', 'CANCELED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "QuoteActorType" AS ENUM ('BUSINESS_MEMBER', 'CUSTOMER', 'SYSTEM');

-- CreateTable
CREATE TABLE "commercial_document_counters" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "document_type" "QuoteDocumentType" NOT NULL,
    "year" INTEGER NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "commercial_document_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_documents" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "created_by_member_id" TEXT NOT NULL,
    "lead_id" TEXT,
    "customer_id" TEXT,
    "customer_profile_id" TEXT,
    "appointment_id" TEXT,
    "document_type" "QuoteDocumentType" NOT NULL,
    "document_number" TEXT NOT NULL,
    "next_revision_number" INTEGER NOT NULL DEFAULT 1,
    "status" "QuoteDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "current_revision_id" TEXT,
    "accepted_revision_id" TEXT,
    "currency" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quote_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_revisions" (
    "id" TEXT NOT NULL,
    "quote_document_id" TEXT NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "subtotal" DECIMAL(10,2) NOT NULL,
    "tax_total" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "discount_total" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(10,2) NOT NULL,
    "notes" TEXT,
    "terms" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_member_id" TEXT NOT NULL,

    CONSTRAINT "quote_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_line_items" (
    "id" TEXT NOT NULL,
    "quote_revision_id" TEXT NOT NULL,
    "service_offering_id" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "unit_price" DECIMAL(10,2) NOT NULL,
    "discount_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "taxable" BOOLEAN NOT NULL DEFAULT false,
    "line_total" DECIMAL(10,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_acceptance_tokens" (
    "id" TEXT NOT NULL,
    "quote_revision_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_acceptance_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_events" (
    "id" TEXT NOT NULL,
    "quote_document_id" TEXT NOT NULL,
    "quote_revision_id" TEXT,
    "event_type" "QuoteEventType" NOT NULL,
    "actor_type" "QuoteActorType" NOT NULL,
    "actor_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "commercial_document_counters_business_id_document_type_year_key" ON "commercial_document_counters"("business_id", "document_type", "year");

-- CreateIndex
CREATE INDEX "quote_documents_business_id_status_idx" ON "quote_documents"("business_id", "status");

-- CreateIndex
CREATE INDEX "quote_documents_business_id_created_at_idx" ON "quote_documents"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "quote_documents_customer_profile_id_idx" ON "quote_documents"("customer_profile_id");

-- CreateIndex
CREATE INDEX "quote_documents_customer_id_idx" ON "quote_documents"("customer_id");

-- CreateIndex
CREATE INDEX "quote_documents_lead_id_idx" ON "quote_documents"("lead_id");

-- CreateIndex
CREATE INDEX "quote_documents_appointment_id_idx" ON "quote_documents"("appointment_id");

-- CreateIndex
CREATE UNIQUE INDEX "quote_documents_business_id_document_type_document_number_key" ON "quote_documents"("business_id", "document_type", "document_number");

-- CreateIndex
CREATE UNIQUE INDEX "quote_documents_current_revision_id_id_key" ON "quote_documents"("current_revision_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "quote_documents_accepted_revision_id_id_key" ON "quote_documents"("accepted_revision_id", "id");

-- CreateIndex
CREATE INDEX "quote_revisions_quote_document_id_idx" ON "quote_revisions"("quote_document_id");

-- CreateIndex
CREATE UNIQUE INDEX "quote_revisions_quote_document_id_revision_number_key" ON "quote_revisions"("quote_document_id", "revision_number");

-- CreateIndex
CREATE UNIQUE INDEX "quote_revisions_id_quote_document_id_key" ON "quote_revisions"("id", "quote_document_id");

-- CreateIndex
CREATE INDEX "quote_line_items_quote_revision_id_idx" ON "quote_line_items"("quote_revision_id");

-- CreateIndex
CREATE INDEX "quote_line_items_service_offering_id_idx" ON "quote_line_items"("service_offering_id");

-- CreateIndex
CREATE UNIQUE INDEX "quote_acceptance_tokens_token_hash_key" ON "quote_acceptance_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "quote_acceptance_tokens_quote_revision_id_idx" ON "quote_acceptance_tokens"("quote_revision_id");

-- CreateIndex
CREATE INDEX "quote_events_quote_document_id_created_at_idx" ON "quote_events"("quote_document_id", "created_at");

-- AddForeignKey
ALTER TABLE "commercial_document_counters" ADD CONSTRAINT "commercial_document_counters_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_documents" ADD CONSTRAINT "quote_documents_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_documents" ADD CONSTRAINT "quote_documents_created_by_member_id_fkey" FOREIGN KEY ("created_by_member_id") REFERENCES "business_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_documents" ADD CONSTRAINT "quote_documents_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_documents" ADD CONSTRAINT "quote_documents_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_documents" ADD CONSTRAINT "quote_documents_customer_profile_id_fkey" FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_documents" ADD CONSTRAINT "quote_documents_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_documents" ADD CONSTRAINT "quote_documents_current_revision_id_id_fkey" FOREIGN KEY ("current_revision_id", "id") REFERENCES "quote_revisions"("id", "quote_document_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_documents" ADD CONSTRAINT "quote_documents_accepted_revision_id_id_fkey" FOREIGN KEY ("accepted_revision_id", "id") REFERENCES "quote_revisions"("id", "quote_document_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_revisions" ADD CONSTRAINT "quote_revisions_quote_document_id_fkey" FOREIGN KEY ("quote_document_id") REFERENCES "quote_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_revisions" ADD CONSTRAINT "quote_revisions_created_by_member_id_fkey" FOREIGN KEY ("created_by_member_id") REFERENCES "business_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_quote_revision_id_fkey" FOREIGN KEY ("quote_revision_id") REFERENCES "quote_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_service_offering_id_fkey" FOREIGN KEY ("service_offering_id") REFERENCES "service_offerings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_acceptance_tokens" ADD CONSTRAINT "quote_acceptance_tokens_quote_revision_id_fkey" FOREIGN KEY ("quote_revision_id") REFERENCES "quote_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_events" ADD CONSTRAINT "quote_events_quote_document_id_fkey" FOREIGN KEY ("quote_document_id") REFERENCES "quote_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_events" ADD CONSTRAINT "quote_events_quote_revision_id_fkey" FOREIGN KEY ("quote_revision_id") REFERENCES "quote_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CheckConstraint
-- PROGRAM 3 LOOP 3A: acceptedRevisionId must be set if and only if status
-- is ACCEPTED — the accepted-revision invariant from the Loop 3
-- architecture resolution. Not expressible as a Prisma-native relation
-- (it spans two columns on the same table), so it is hand-added here,
-- matching this repository's existing precedent for cross-column CHECK
-- constraints (see 20260829010000_automation_foundation_metadata's
-- feature_flags_scope_target_check).
ALTER TABLE "quote_documents" ADD CONSTRAINT "quote_documents_accepted_revision_status_check" CHECK (("status" = 'ACCEPTED' AND "accepted_revision_id" IS NOT NULL) OR ("status" != 'ACCEPTED' AND "accepted_revision_id" IS NULL));
