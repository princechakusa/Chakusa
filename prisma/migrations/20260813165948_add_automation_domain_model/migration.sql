-- CreateEnum
CREATE TYPE "AutomationTriggerType" AS ENUM ('LEAD_CREATED', 'LEAD_FOLLOW_UP', 'REVIEW_REQUEST_FOLLOW_UP', 'CUSTOMER_RETENTION');

-- CreateEnum
CREATE TYPE "AutomationChannel" AS ENUM ('SMS', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "AutomationRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "automation_rules" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "trigger_type" "AutomationTriggerType" NOT NULL,
    "channel" "AutomationChannel" NOT NULL DEFAULT 'SMS',
    "delay_seconds" INTEGER NOT NULL DEFAULT 0,
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_runs" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "automation_rule_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "lead_id" TEXT,
    "status" "AutomationRunStatus" NOT NULL DEFAULT 'PENDING',
    "dedupe_key" TEXT NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "automation_rules_business_id_idx" ON "automation_rules"("business_id");

-- CreateIndex
CREATE INDEX "automation_rules_business_id_enabled_idx" ON "automation_rules"("business_id", "enabled");

-- CreateIndex
CREATE INDEX "automation_rules_business_id_trigger_type_idx" ON "automation_rules"("business_id", "trigger_type");

-- CreateIndex
CREATE INDEX "automation_runs_business_id_idx" ON "automation_runs"("business_id");

-- CreateIndex
CREATE INDEX "automation_runs_business_id_status_idx" ON "automation_runs"("business_id", "status");

-- CreateIndex
CREATE INDEX "automation_runs_automation_rule_id_idx" ON "automation_runs"("automation_rule_id");

-- CreateIndex
CREATE INDEX "automation_runs_customer_id_idx" ON "automation_runs"("customer_id");

-- CreateIndex
CREATE INDEX "automation_runs_lead_id_idx" ON "automation_runs"("lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "automation_runs_business_id_dedupe_key_key" ON "automation_runs"("business_id", "dedupe_key");

-- AddForeignKey
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automation_rule_id_fkey" FOREIGN KEY ("automation_rule_id") REFERENCES "automation_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
