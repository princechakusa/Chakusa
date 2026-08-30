-- Automation foundation metadata only. No execution/runtime tables are added.
CREATE TYPE "FeatureFlagScope" AS ENUM ('PLATFORM','BUSINESS','USER','INTERNAL');
CREATE TABLE "feature_flags" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "scope" "FeatureFlagScope" NOT NULL,
  "business_id" TEXT,
  "user_id" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'DISABLED',
  "rollout_percent" INTEGER NOT NULL DEFAULT 100,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "feature_flags_key_scope_idx" ON "feature_flags"("key", "scope");
CREATE INDEX "feature_flags_business_id_key_idx" ON "feature_flags"("business_id", "key");
CREATE INDEX "feature_flags_user_id_key_idx" ON "feature_flags"("user_id", "key");
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_rollout_check" CHECK ("rollout_percent" BETWEEN 0 AND 100);
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_status_check" CHECK ("status" IN ('ENABLED','DISABLED','BETA','INTERNAL','PRODUCTION'));
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_scope_target_check" CHECK (("scope" IN ('PLATFORM','INTERNAL') AND "business_id" IS NULL AND "user_id" IS NULL) OR ("scope" = 'BUSINESS' AND "business_id" IS NOT NULL AND "user_id" IS NULL) OR ("scope" = 'USER' AND "user_id" IS NOT NULL AND "business_id" IS NULL));
CREATE UNIQUE INDEX "feature_flags_platform_key_scope_key" ON "feature_flags"("key","scope") WHERE "scope" IN ('PLATFORM','INTERNAL');
CREATE UNIQUE INDEX "feature_flags_business_key_scope_key" ON "feature_flags"("key","scope","business_id") WHERE "scope" = 'BUSINESS';
CREATE UNIQUE INDEX "feature_flags_user_key_scope_key" ON "feature_flags"("key","scope","user_id") WHERE "scope" = 'USER';
