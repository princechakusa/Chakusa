CREATE TABLE "workflow_action_attempts" (
  "id" TEXT NOT NULL,
  "execution_id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "node_id" TEXT NOT NULL,
  "action_name" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "output" JSONB,
  "last_error" TEXT,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "workflow_action_attempts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "workflow_action_attempts_idempotency_key_key" ON "workflow_action_attempts"("idempotency_key");
CREATE UNIQUE INDEX "workflow_action_attempts_execution_id_node_id_key" ON "workflow_action_attempts"("execution_id", "node_id");
CREATE INDEX "workflow_action_attempts_business_id_status_updated_at_idx" ON "workflow_action_attempts"("business_id", "status", "updated_at");
ALTER TABLE "workflow_action_attempts" ADD CONSTRAINT "workflow_action_attempts_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "workflow_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
