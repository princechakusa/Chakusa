-- CreateTable
CREATE TABLE "ai_memory_records" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subject_type" TEXT,
    "subject_id" TEXT,
    "conversation_id" TEXT,
    "customer_id" TEXT,
    "run_id" TEXT,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "data" JSONB,
    "source" TEXT NOT NULL,
    "source_ref" TEXT,
    "confidence" DOUBLE PRECISION,
    "importance" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "superseded_by_id" TEXT,
    "expires_at" TIMESTAMP(3),
    "last_accessed_at" TIMESTAMP(3),
    "access_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_memory_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_memory_sessions" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "customer_id" TEXT,
    "context" JSONB NOT NULL DEFAULT '{}',
    "variables" JSONB NOT NULL DEFAULT '{}',
    "tool_outputs" JSONB NOT NULL DEFAULT '[]',
    "pending_questions" JSONB NOT NULL DEFAULT '[]',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_memory_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_retrieval_logs" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "run_id" TEXT,
    "conversation_id" TEXT,
    "customer_id" TEXT,
    "phase" TEXT NOT NULL,
    "query" TEXT,
    "candidate_count" INTEGER NOT NULL,
    "returned_count" INTEGER NOT NULL,
    "duplicates_suppressed" INTEGER NOT NULL DEFAULT 0,
    "hit" BOOLEAN NOT NULL,
    "latency_ms" INTEGER NOT NULL,
    "raw_tokens" INTEGER NOT NULL,
    "context_tokens" INTEGER NOT NULL,
    "compression_ratio" DOUBLE PRECISION NOT NULL,
    "freshness_score" DOUBLE PRECISION NOT NULL,
    "attribution_coverage" DOUBLE PRECISION NOT NULL,
    "sources" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_retrieval_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_memory_records_business_id_scope_kind_idx" ON "ai_memory_records"("business_id", "scope", "kind");

-- CreateIndex
CREATE INDEX "ai_memory_records_business_id_customer_id_scope_idx" ON "ai_memory_records"("business_id", "customer_id", "scope");

-- CreateIndex
CREATE INDEX "ai_memory_records_business_id_conversation_id_idx" ON "ai_memory_records"("business_id", "conversation_id");

-- CreateIndex
CREATE INDEX "ai_memory_records_business_id_expires_at_idx" ON "ai_memory_records"("business_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_memory_sessions_run_id_key" ON "ai_memory_sessions"("run_id");

-- CreateIndex
CREATE INDEX "ai_memory_sessions_business_id_expires_at_idx" ON "ai_memory_sessions"("business_id", "expires_at");

-- CreateIndex
CREATE INDEX "ai_retrieval_logs_business_id_created_at_idx" ON "ai_retrieval_logs"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_retrieval_logs_business_id_phase_created_at_idx" ON "ai_retrieval_logs"("business_id", "phase", "created_at");

-- CreateIndex
CREATE INDEX "ai_retrieval_logs_run_id_idx" ON "ai_retrieval_logs"("run_id");
