-- AlterTable
ALTER TABLE "leads" ADD COLUMN "referred_by_customer_id" TEXT;

-- CreateIndex
CREATE INDEX "leads_referred_by_customer_id_idx" ON "leads"("referred_by_customer_id");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_referred_by_customer_id_fkey" FOREIGN KEY ("referred_by_customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
