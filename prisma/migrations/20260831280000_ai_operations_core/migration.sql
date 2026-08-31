-- CreateTable
CREATE TABLE "ai_evaluation_suites" (
    "id" TEXT NOT NULL,
    "business_id" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_evaluation_suites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_evaluation_cases" (
    "id" TEXT NOT NULL,
    "suite_id" TEXT NOT NULL,
    "business_id" TEXT,
    "name" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "expected" JSONB NOT NULL,
    "locale" TEXT,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "prompt_template_key" TEXT,
    "tags" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_evaluation_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_evaluation_runs" (
    "id" TEXT NOT NULL,
    "business_id" TEXT,
    "suite_id" TEXT NOT NULL,
    "run_number" INTEGER NOT NULL,
    "label" TEXT,
    "prompt_version_id" TEXT,
    "compare_to_run_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "provider" TEXT,
    "model" TEXT,
    "total_cases" INTEGER NOT NULL DEFAULT 0,
    "passed_cases" INTEGER NOT NULL DEFAULT 0,
    "failed_cases" INTEGER NOT NULL DEFAULT 0,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "metrics" JSONB,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_by_user_id" TEXT,

    CONSTRAINT "ai_evaluation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_evaluation_results" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "case_id" TEXT,
    "business_id" TEXT,
    "name" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "expected" JSONB,
    "actual" JSONB,
    "failure_reason" TEXT,
    "latency_ms" INTEGER,
    "checks" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_evaluation_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_operational_metrics" (
    "id" TEXT NOT NULL,
    "business_id" TEXT,
    "scope" TEXT NOT NULL DEFAULT 'BUSINESS',
    "metric" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "window_start" TIMESTAMP(3) NOT NULL,
    "window_end" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "sum" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "min" DOUBLE PRECISION,
    "max" DOUBLE PRECISION,
    "dimensions" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_operational_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_provider_health_checks" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "status" TEXT NOT NULL,
    "circuit_state" TEXT NOT NULL DEFAULT 'CLOSED',
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "success_rate" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "p95_latency_ms" INTEGER,
    "sample_size" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "opened_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_provider_health_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_attributed_outcomes" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "run_id" TEXT,
    "conversation_id" TEXT,
    "customer_id" TEXT,
    "outcome_type" TEXT NOT NULL,
    "outcome_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2),
    "currency" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMP(3),
    "ledger_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_attributed_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_evaluation_suites_business_id_category_idx" ON "ai_evaluation_suites"("business_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "ai_evaluation_suites_business_id_key_key" ON "ai_evaluation_suites"("business_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ai_evaluation_cases_suite_id_name_key" ON "ai_evaluation_cases"("suite_id", "name");

-- CreateIndex
CREATE INDEX "ai_evaluation_runs_business_id_suite_id_started_at_idx" ON "ai_evaluation_runs"("business_id", "suite_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_evaluation_runs_suite_id_run_number_key" ON "ai_evaluation_runs"("suite_id", "run_number");

-- CreateIndex
CREATE INDEX "ai_evaluation_results_run_id_idx" ON "ai_evaluation_results"("run_id");

-- CreateIndex
CREATE INDEX "ai_operational_metrics_business_id_metric_window_start_idx" ON "ai_operational_metrics"("business_id", "metric", "window_start");

-- CreateIndex
CREATE INDEX "ai_operational_metrics_scope_metric_window_start_idx" ON "ai_operational_metrics"("scope", "metric", "window_start");

-- CreateIndex
CREATE UNIQUE INDEX "ai_operational_metrics_business_id_scope_metric_provider_mo_key" ON "ai_operational_metrics"("business_id", "scope", "metric", "provider", "model", "window_start");

-- CreateIndex
CREATE INDEX "ai_provider_health_checks_provider_model_created_at_idx" ON "ai_provider_health_checks"("provider", "model", "created_at");

-- CreateIndex
CREATE INDEX "ai_attributed_outcomes_business_id_verified_created_at_idx" ON "ai_attributed_outcomes"("business_id", "verified", "created_at");

-- CreateIndex
CREATE INDEX "ai_attributed_outcomes_run_id_idx" ON "ai_attributed_outcomes"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_attributed_outcomes_business_id_outcome_type_outcome_id_key" ON "ai_attributed_outcomes"("business_id", "outcome_type", "outcome_id");

-- AddForeignKey
ALTER TABLE "ai_evaluation_cases" ADD CONSTRAINT "ai_evaluation_cases_suite_id_fkey" FOREIGN KEY ("suite_id") REFERENCES "ai_evaluation_suites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_evaluation_runs" ADD CONSTRAINT "ai_evaluation_runs_suite_id_fkey" FOREIGN KEY ("suite_id") REFERENCES "ai_evaluation_suites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_evaluation_results" ADD CONSTRAINT "ai_evaluation_results_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_evaluation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_evaluation_results" ADD CONSTRAINT "ai_evaluation_results_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "ai_evaluation_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
