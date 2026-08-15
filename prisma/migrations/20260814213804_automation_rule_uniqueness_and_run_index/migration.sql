-- Enforces at most one AutomationRule per (businessId, triggerType, channel).
-- Confirmed safe before writing this migration: `automation_rules` has zero
-- existing rows in the local database, so there is no duplicate data to
-- reconcile.
CREATE UNIQUE INDEX "automation_rules_business_id_trigger_type_channel_key" ON "automation_rules"("business_id", "trigger_type", "channel");

-- Supports GET /automation/runs (paginated history, ordered by createdAt DESC).
CREATE INDEX "automation_runs_business_id_created_at_idx" ON "automation_runs"("business_id", "created_at");
