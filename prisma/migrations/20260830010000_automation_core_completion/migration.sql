ALTER TYPE "OutboxStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE "OutboxStatus" ADD VALUE IF NOT EXISTS 'DEAD';
CREATE TYPE "EventDeliveryStatus" AS ENUM ('PENDING','PROCESSING','DELIVERED','RETRY','DEAD');

ALTER TABLE "outbox_events" ADD COLUMN "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "lease_owner" TEXT,
ADD COLUMN "lease_expires_at" TIMESTAMP(3),
ADD COLUMN "last_error" TEXT;
DROP INDEX IF EXISTS "outbox_events_status_created_at_idx";
CREATE INDEX "outbox_events_status_next_attempt_at_created_at_idx" ON "outbox_events"("status","next_attempt_at","created_at");
CREATE INDEX "outbox_events_business_id_aggregate_type_aggregate_id_created_at_status_idx" ON "outbox_events"("business_id","aggregate_type","aggregate_id","created_at","status");

ALTER TABLE "event_subscriptions" ADD COLUMN "max_attempts" INTEGER NOT NULL DEFAULT 8;
ALTER TABLE "event_deliveries" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "event_deliveries" ALTER COLUMN "status" TYPE "EventDeliveryStatus" USING (CASE WHEN "status"::text = 'PUBLISHED' THEN 'DELIVERED' WHEN "status"::text = 'FAILED' THEN 'RETRY' WHEN "status"::text IN ('PROCESSING','DEAD') THEN "status"::text ELSE 'PENDING' END)::"EventDeliveryStatus";
ALTER TABLE "event_deliveries" ALTER COLUMN "status" SET DEFAULT 'PENDING';
ALTER TABLE "event_deliveries" ADD COLUMN "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
DROP INDEX IF EXISTS "event_deliveries_status_lease_expires_at_created_at_idx";
CREATE INDEX "event_deliveries_status_next_attempt_at_lease_expires_at_created_at_idx" ON "event_deliveries"("status","next_attempt_at","lease_expires_at","created_at");
CREATE INDEX "event_deliveries_subscription_id_status_event_id_idx" ON "event_deliveries"("subscription_id","status","event_id");

ALTER TABLE "workflow_executions" ADD COLUMN "current_node_id" TEXT,
ADD COLUMN "retry_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lease_owner" TEXT,
ADD COLUMN "lease_expires_at" TIMESTAMP(3),
ADD COLUMN "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "timeout_at" TIMESTAMP(3),
ADD COLUMN "cancelled_at" TIMESTAMP(3),
ADD COLUMN "cancellation_reason" TEXT;
DROP INDEX IF EXISTS "workflow_executions_business_id_status_scheduled_for_idx";
CREATE INDEX "workflow_executions_business_id_status_next_attempt_at_idx" ON "workflow_executions"("business_id","status","next_attempt_at");
CREATE INDEX "workflow_executions_status_next_attempt_at_lease_expires_at_idx" ON "workflow_executions"("status","next_attempt_at","lease_expires_at");
CREATE INDEX "workflow_executions_business_id_created_at_status_idx" ON "workflow_executions"("business_id","created_at","status");
CREATE UNIQUE INDEX "workflow_versions_single_published_idx" ON "workflow_versions"("workflow_id") WHERE "published_at" IS NOT NULL;

ALTER TABLE "workflows" ADD COLUMN "schedule_enabled" BOOLEAN,
ADD COLUMN "next_trigger_at" TIMESTAMP(3),
ADD COLUMN "schedule_lease_owner" TEXT,
ADD COLUMN "schedule_lease_expires_at" TIMESTAMP(3);
CREATE INDEX "workflows_status_schedule_enabled_next_trigger_at_schedule_lease_expires_at_idx" ON "workflows"("status","schedule_enabled","next_trigger_at","schedule_lease_expires_at");

CREATE TABLE "workflow_execution_events" ("id" TEXT NOT NULL,"execution_id" TEXT NOT NULL,"business_id" TEXT NOT NULL,"type" TEXT NOT NULL,"node_id" TEXT,"duration_ms" INTEGER,"retry_count" INTEGER NOT NULL DEFAULT 0,"metadata" JSONB,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "workflow_execution_events_pkey" PRIMARY KEY ("id"));
CREATE INDEX "workflow_execution_events_business_id_type_created_at_idx" ON "workflow_execution_events"("business_id","type","created_at");
CREATE INDEX "workflow_execution_events_execution_id_created_at_idx" ON "workflow_execution_events"("execution_id","created_at");
ALTER TABLE "workflow_execution_events" ADD CONSTRAINT "workflow_execution_events_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "workflow_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "workflow_templates" ("id" TEXT NOT NULL,"key" TEXT NOT NULL,"version" INTEGER NOT NULL,"name" TEXT NOT NULL,"description" TEXT,"definition" JSONB NOT NULL,"checksum" TEXT NOT NULL,"active" BOOLEAN NOT NULL DEFAULT true,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "workflow_templates_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "workflow_templates_key_version_key" ON "workflow_templates"("key","version");
CREATE INDEX "workflow_templates_active_key_idx" ON "workflow_templates"("active","key");

CREATE TABLE "automation_tasks" ("id" TEXT NOT NULL,"idempotency_key" TEXT NOT NULL,"business_id" TEXT NOT NULL,"execution_id" TEXT,"title" TEXT NOT NULL,"description" TEXT,"assigned_member_id" TEXT,"status" TEXT NOT NULL DEFAULT 'OPEN',"due_at" TIMESTAMP(3),"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_at" TIMESTAMP(3) NOT NULL,CONSTRAINT "automation_tasks_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "automation_tasks_idempotency_key_key" ON "automation_tasks"("idempotency_key");
CREATE INDEX "automation_tasks_business_id_status_due_at_idx" ON "automation_tasks"("business_id","status","due_at");

ALTER TABLE "customers" ADD COLUMN "birthday" DATE, ADD COLUMN "anniversary" DATE, ADD COLUMN "custom_fields" JSONB;
CREATE INDEX "customers_business_id_birthday_idx" ON "customers"("business_id","birthday");
CREATE INDEX "customers_business_id_anniversary_idx" ON "customers"("business_id","anniversary");
CREATE INDEX "customers_business_id_birthday_month_day_idx" ON "customers"("business_id", (EXTRACT(MONTH FROM "birthday")), (EXTRACT(DAY FROM "birthday"))) WHERE "birthday" IS NOT NULL;
CREATE INDEX "customers_business_id_anniversary_month_day_idx" ON "customers"("business_id", (EXTRACT(MONTH FROM "anniversary")), (EXTRACT(DAY FROM "anniversary"))) WHERE "anniversary" IS NOT NULL;
