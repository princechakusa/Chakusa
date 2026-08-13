-- AlterTable
ALTER TABLE "automation_runs" ADD COLUMN     "lease_expires_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "automation_run_id" TEXT;

-- CreateIndex
CREATE INDEX "automation_runs_status_lease_expires_at_idx" ON "automation_runs"("status", "lease_expires_at");

-- CreateIndex
CREATE INDEX "messages_automation_run_id_idx" ON "messages"("automation_run_id");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_automation_run_id_fkey" FOREIGN KEY ("automation_run_id") REFERENCES "automation_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
