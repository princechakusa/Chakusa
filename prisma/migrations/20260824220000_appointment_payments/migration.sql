ALTER TABLE "appointments"
ADD COLUMN "deposit_amount" DECIMAL(10,2),
ADD COLUMN "paid_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN "payment_status" "LeadPaymentStatus" NOT NULL DEFAULT 'unpaid';

CREATE INDEX "appointments_business_id_payment_status_starts_at_idx"
ON "appointments"("business_id", "payment_status", "starts_at");
