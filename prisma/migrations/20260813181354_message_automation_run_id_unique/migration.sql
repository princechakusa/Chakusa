-- DropIndex
DROP INDEX "messages_automation_run_id_idx";

-- CreateIndex
CREATE UNIQUE INDEX "messages_automation_run_id_key" ON "messages"("automation_run_id");
