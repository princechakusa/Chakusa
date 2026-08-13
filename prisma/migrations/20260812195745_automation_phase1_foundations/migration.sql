-- CreateEnum
CREATE TYPE "OptOutChannel" AS ENUM ('SMS', 'WHATSAPP', 'ALL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityEventType" ADD VALUE 'AUTOMATION_MESSAGE_SCHEDULED';
ALTER TYPE "ActivityEventType" ADD VALUE 'AUTOMATION_MESSAGE_SENT';
ALTER TYPE "ActivityEventType" ADD VALUE 'AUTOMATION_MESSAGE_FAILED';

-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "country" TEXT,
ADD COLUMN     "currency" TEXT,
ADD COLUMN     "phone_e164" TEXT,
ADD COLUMN     "timezone" TEXT;

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "phone_e164" TEXT;

-- CreateTable
CREATE TABLE "customer_opt_outs" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "phone" TEXT NOT NULL,
    "channel" "OptOutChannel" NOT NULL,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_opt_outs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_opt_outs_business_id_idx" ON "customer_opt_outs"("business_id");

-- CreateIndex
CREATE INDEX "customer_opt_outs_customer_id_idx" ON "customer_opt_outs"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_opt_outs_business_id_phone_channel_key" ON "customer_opt_outs"("business_id", "phone", "channel");

-- AddForeignKey
ALTER TABLE "customer_opt_outs" ADD CONSTRAINT "customer_opt_outs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_opt_outs" ADD CONSTRAINT "customer_opt_outs_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
