-- CreateEnum
CREATE TYPE "LeadPaymentStatus" AS ENUM ('unpaid', 'partially_paid', 'paid');

-- AlterTable
ALTER TABLE "leads" ADD COLUMN "payment_status" "LeadPaymentStatus" NOT NULL DEFAULT 'unpaid';
ALTER TABLE "leads" ADD COLUMN "paid_amount" DECIMAL(10,2);
