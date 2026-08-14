-- CreateIndex
CREATE INDEX "automation_runs_status_scheduled_for_idx" ON "automation_runs"("status", "scheduled_for");
