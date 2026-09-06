-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'VOID');

-- CreateEnum
CREATE TYPE "InvoiceEventType" AS ENUM ('CREATED', 'REVISED', 'SENT', 'VOIDED', 'CONVERTED_FROM_QUOTE');

-- CreateEnum
CREATE TYPE "InvoiceActorType" AS ENUM ('BUSINESS_MEMBER', 'CUSTOMER', 'SYSTEM');

-- CreateTable
CREATE TABLE "invoice_counters" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "invoice_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "created_by_member_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "customer_profile_id" TEXT,
    "appointment_id" TEXT,
    "source_quote_document_id" TEXT,
    "source_quote_revision_id" TEXT,
    "invoice_number" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "current_revision_id" TEXT,
    "currency" TEXT NOT NULL,
    "issue_date" TIMESTAMP(3),
    "due_date" TIMESTAMP(3),
    "next_revision_number" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_revisions" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "subtotal" DECIMAL(10,2) NOT NULL,
    "tax_total" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "discount_total" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(10,2) NOT NULL,
    "notes" TEXT,
    "terms" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_member_id" TEXT NOT NULL,

    CONSTRAINT "invoice_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_line_items" (
    "id" TEXT NOT NULL,
    "invoice_revision_id" TEXT NOT NULL,
    "service_offering_id" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "unit_price" DECIMAL(10,2) NOT NULL,
    "discount_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "taxable" BOOLEAN NOT NULL DEFAULT false,
    "line_total" DECIMAL(10,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_events" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "invoice_revision_id" TEXT,
    "event_type" "InvoiceEventType" NOT NULL,
    "actor_type" "InvoiceActorType" NOT NULL,
    "actor_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoice_counters_business_id_year_key" ON "invoice_counters"("business_id", "year");

-- CreateIndex
CREATE INDEX "invoices_business_id_status_idx" ON "invoices"("business_id", "status");

-- CreateIndex
CREATE INDEX "invoices_business_id_created_at_idx" ON "invoices"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "invoices_status_due_date_idx" ON "invoices"("status", "due_date");

-- CreateIndex
CREATE INDEX "invoices_customer_id_idx" ON "invoices"("customer_id");

-- CreateIndex
CREATE INDEX "invoices_customer_profile_id_idx" ON "invoices"("customer_profile_id");

-- CreateIndex
CREATE INDEX "invoices_appointment_id_idx" ON "invoices"("appointment_id");

-- CreateIndex
CREATE INDEX "invoices_source_quote_document_id_idx" ON "invoices"("source_quote_document_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_business_id_invoice_number_key" ON "invoices"("business_id", "invoice_number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_current_revision_id_id_key" ON "invoices"("current_revision_id", "id");

-- CreateIndex
CREATE INDEX "invoice_revisions_invoice_id_idx" ON "invoice_revisions"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_revisions_invoice_id_revision_number_key" ON "invoice_revisions"("invoice_id", "revision_number");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_revisions_id_invoice_id_key" ON "invoice_revisions"("id", "invoice_id");

-- CreateIndex
CREATE INDEX "invoice_line_items_invoice_revision_id_idx" ON "invoice_line_items"("invoice_revision_id");

-- CreateIndex
CREATE INDEX "invoice_line_items_service_offering_id_idx" ON "invoice_line_items"("service_offering_id");

-- CreateIndex
CREATE INDEX "invoice_events_invoice_id_created_at_idx" ON "invoice_events"("invoice_id", "created_at");

-- AddForeignKey
ALTER TABLE "invoice_counters" ADD CONSTRAINT "invoice_counters_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_member_id_fkey" FOREIGN KEY ("created_by_member_id") REFERENCES "business_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_profile_id_fkey" FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_source_quote_document_id_fkey" FOREIGN KEY ("source_quote_document_id") REFERENCES "quote_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_source_quote_revision_id_fkey" FOREIGN KEY ("source_quote_revision_id") REFERENCES "quote_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_current_revision_id_id_fkey" FOREIGN KEY ("current_revision_id", "id") REFERENCES "invoice_revisions"("id", "invoice_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_revisions" ADD CONSTRAINT "invoice_revisions_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_revisions" ADD CONSTRAINT "invoice_revisions_created_by_member_id_fkey" FOREIGN KEY ("created_by_member_id") REFERENCES "business_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_invoice_revision_id_fkey" FOREIGN KEY ("invoice_revision_id") REFERENCES "invoice_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_service_offering_id_fkey" FOREIGN KEY ("service_offering_id") REFERENCES "service_offerings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_events" ADD CONSTRAINT "invoice_events_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_events" ADD CONSTRAINT "invoice_events_invoice_revision_id_fkey" FOREIGN KEY ("invoice_revision_id") REFERENCES "invoice_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
