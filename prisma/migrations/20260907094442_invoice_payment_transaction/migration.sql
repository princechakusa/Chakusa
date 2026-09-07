-- CreateEnum
CREATE TYPE "InvoicePaymentTransactionStatus" AS ENUM ('pending', 'paid', 'failed', 'partially_refunded', 'refunded');

-- CreateTable
CREATE TABLE "invoice_payment_transactions" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "invoice_revision_id" TEXT NOT NULL,
    "status" "InvoicePaymentTransactionStatus" NOT NULL DEFAULT 'pending',
    "amount" DECIMAL(10,2) NOT NULL,
    "refunded_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "stripe_checkout_session_id" TEXT,
    "stripe_payment_intent_id" TEXT,
    "checkout_url" TEXT,
    "failure_code" TEXT,
    "paid_at" TIMESTAMP(3),
    "refunded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_payment_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoice_payment_transactions_stripe_checkout_session_id_key" ON "invoice_payment_transactions"("stripe_checkout_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_payment_transactions_stripe_payment_intent_id_key" ON "invoice_payment_transactions"("stripe_payment_intent_id");

-- CreateIndex
CREATE INDEX "invoice_payment_transactions_business_id_status_created_at_idx" ON "invoice_payment_transactions"("business_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "invoice_payment_transactions_invoice_id_created_at_idx" ON "invoice_payment_transactions"("invoice_id", "created_at");

-- CreateIndex
CREATE INDEX "invoice_payment_transactions_status_created_at_idx" ON "invoice_payment_transactions"("status", "created_at");

-- AddForeignKey
ALTER TABLE "invoice_payment_transactions" ADD CONSTRAINT "invoice_payment_transactions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_payment_transactions" ADD CONSTRAINT "invoice_payment_transactions_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_payment_transactions" ADD CONSTRAINT "invoice_payment_transactions_invoice_revision_id_fkey" FOREIGN KEY ("invoice_revision_id") REFERENCES "invoice_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
