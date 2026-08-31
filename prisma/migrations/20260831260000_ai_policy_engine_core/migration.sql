-- CreateTable
CREATE TABLE "ai_policies" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'BUSINESS',
    "workflow_id" TEXT,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "mode" TEXT NOT NULL DEFAULT 'DRAFT',
    "document" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "created_by_user_id" TEXT,
    "activated_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_policy_rules" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "policy_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "tool_name" TEXT,
    "workflow_id" TEXT,
    "effect" TEXT NOT NULL DEFAULT 'REQUIRE_APPROVAL',
    "strategy" TEXT NOT NULL DEFAULT 'ANY_OWNER',
    "approver_user_id" TEXT,
    "min_confidence" DOUBLE PRECISION,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_policy_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_policy_decisions" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "conversation_id" TEXT,
    "workflow_execution_id" TEXT,
    "run_id" TEXT,
    "policy_id" TEXT,
    "policy_version" INTEGER,
    "checkpoint" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "reasons" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION,
    "required_approval_strategy" TEXT,
    "channel" TEXT,
    "correlation_id" TEXT,
    "dry_run" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_policy_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_policy_changes" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "policy_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "change_type" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "diff" JSONB,
    "document" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_policy_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_policies_business_id_status_idx" ON "ai_policies"("business_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_policies_business_id_scope_workflow_id_version_key" ON "ai_policies"("business_id", "scope", "workflow_id", "version");

-- CreateIndex
CREATE INDEX "ai_policy_rules_business_id_category_action_idx" ON "ai_policy_rules"("business_id", "category", "action");

-- CreateIndex
CREATE UNIQUE INDEX "ai_policy_rules_policy_id_category_action_tool_name_workflo_key" ON "ai_policy_rules"("policy_id", "category", "action", "tool_name", "workflow_id");

-- CreateIndex
CREATE INDEX "ai_policy_decisions_business_id_created_at_idx" ON "ai_policy_decisions"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_policy_decisions_run_id_created_at_idx" ON "ai_policy_decisions"("run_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_policy_decisions_conversation_id_created_at_idx" ON "ai_policy_decisions"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_policy_changes_business_id_policy_id_created_at_idx" ON "ai_policy_changes"("business_id", "policy_id", "created_at");

-- AddForeignKey
ALTER TABLE "ai_policy_rules" ADD CONSTRAINT "ai_policy_rules_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "ai_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_policy_changes" ADD CONSTRAINT "ai_policy_changes_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "ai_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
