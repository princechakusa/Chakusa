CREATE TYPE "AppointmentPaymentKind" AS ENUM ('deposit', 'balance', 'full');
CREATE TYPE "AppointmentPaymentTransactionStatus" AS ENUM ('pending', 'paid', 'failed', 'partially_refunded', 'refunded');

ALTER TABLE "businesses" ADD COLUMN "stripe_account_id" TEXT;
CREATE UNIQUE INDEX "businesses_stripe_account_id_key" ON "businesses"("stripe_account_id");

CREATE TABLE "appointment_payment_transactions" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "appointment_id" TEXT NOT NULL,
  "kind" "AppointmentPaymentKind" NOT NULL,
  "status" "AppointmentPaymentTransactionStatus" NOT NULL DEFAULT 'pending',
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
  CONSTRAINT "appointment_payment_transactions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "appointment_payment_transactions_stripe_checkout_session_id_key" ON "appointment_payment_transactions"("stripe_checkout_session_id");
CREATE UNIQUE INDEX "appointment_payment_transactions_stripe_payment_intent_id_key" ON "appointment_payment_transactions"("stripe_payment_intent_id");
CREATE INDEX "appointment_payment_transactions_business_id_status_created_at_idx" ON "appointment_payment_transactions"("business_id", "status", "created_at");
CREATE INDEX "appointment_payment_transactions_appointment_id_created_at_idx" ON "appointment_payment_transactions"("appointment_id", "created_at");
ALTER TABLE "appointment_payment_transactions" ADD CONSTRAINT "appointment_payment_transactions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "appointment_payment_transactions" ADD CONSTRAINT "appointment_payment_transactions_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
