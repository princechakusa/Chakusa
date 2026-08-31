
-- CreateTable
CREATE TABLE "prompt_packages" (
    "id" TEXT NOT NULL,
    "business_id" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scope" TEXT NOT NULL DEFAULT 'PLATFORM',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompt_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_categories" (
    "id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_templates" (
    "id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "category_id" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "task" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "current_version_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompt_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_versions" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "body" TEXT NOT NULL,
    "system_prompt" TEXT,
    "model" TEXT,
    "required_capability" TEXT,
    "checksum" TEXT NOT NULL,
    "notes" TEXT,
    "created_by_user_id" TEXT,
    "published_at" TIMESTAMP(3),
    "retired_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_variables" (
    "id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'string',
    "required" BOOLEAN NOT NULL DEFAULT true,
    "default_value" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_variables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_localizations" (
    "id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "system_prompt" TEXT,
    "checksum" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_localizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_overrides" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "version_id" TEXT,
    "body" TEXT,
    "system_prompt" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "checksum" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompt_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_deployments" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "business_id" TEXT,
    "environment" TEXT NOT NULL DEFAULT 'production',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deployed_by_user_id" TEXT,
    "deployed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "superseded_at" TIMESTAMP(3),

    CONSTRAINT "prompt_deployments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_approvals" (
    "id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requested_by_user_id" TEXT,
    "reviewed_by_user_id" TEXT,
    "reason" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_test_cases" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "variables" JSONB NOT NULL DEFAULT '{}',
    "context" JSONB,
    "assertions" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompt_test_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_test_runs" (
    "id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "test_case_id" TEXT,
    "status" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "output" JSONB,
    "failures" JSONB,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_test_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prompt_packages_scope_status_idx" ON "prompt_packages"("scope", "status");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_packages_business_id_key_key" ON "prompt_packages"("business_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_categories_package_id_key_key" ON "prompt_categories"("package_id", "key");

-- CreateIndex
CREATE INDEX "prompt_templates_task_status_idx" ON "prompt_templates"("task", "status");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_templates_package_id_key_key" ON "prompt_templates"("package_id", "key");

-- CreateIndex
CREATE INDEX "prompt_versions_status_idx" ON "prompt_versions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_versions_template_id_version_key" ON "prompt_versions"("template_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_variables_version_id_name_key" ON "prompt_variables"("version_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_localizations_version_id_locale_key" ON "prompt_localizations"("version_id", "locale");

-- CreateIndex
CREATE INDEX "prompt_overrides_business_id_status_idx" ON "prompt_overrides"("business_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_overrides_business_id_template_id_key" ON "prompt_overrides"("business_id", "template_id");

-- CreateIndex
CREATE INDEX "prompt_deployments_template_id_environment_active_idx" ON "prompt_deployments"("template_id", "environment", "active");

-- CreateIndex
CREATE INDEX "prompt_deployments_business_id_active_idx" ON "prompt_deployments"("business_id", "active");

-- CreateIndex
CREATE INDEX "prompt_approvals_version_id_status_idx" ON "prompt_approvals"("version_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_test_cases_template_id_name_key" ON "prompt_test_cases"("template_id", "name");

-- CreateIndex
CREATE INDEX "prompt_test_runs_version_id_created_at_idx" ON "prompt_test_runs"("version_id", "created_at");

-- AddForeignKey
ALTER TABLE "prompt_categories" ADD CONSTRAINT "prompt_categories_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "prompt_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_templates" ADD CONSTRAINT "prompt_templates_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "prompt_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_templates" ADD CONSTRAINT "prompt_templates_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "prompt_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "prompt_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_variables" ADD CONSTRAINT "prompt_variables_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "prompt_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_localizations" ADD CONSTRAINT "prompt_localizations_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "prompt_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_overrides" ADD CONSTRAINT "prompt_overrides_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "prompt_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_overrides" ADD CONSTRAINT "prompt_overrides_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "prompt_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_deployments" ADD CONSTRAINT "prompt_deployments_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "prompt_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_deployments" ADD CONSTRAINT "prompt_deployments_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "prompt_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_approvals" ADD CONSTRAINT "prompt_approvals_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "prompt_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_test_cases" ADD CONSTRAINT "prompt_test_cases_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "prompt_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_test_runs" ADD CONSTRAINT "prompt_test_runs_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "prompt_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_test_runs" ADD CONSTRAINT "prompt_test_runs_test_case_id_fkey" FOREIGN KEY ("test_case_id") REFERENCES "prompt_test_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
