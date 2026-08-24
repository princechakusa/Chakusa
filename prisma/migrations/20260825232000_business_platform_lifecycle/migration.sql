CREATE TYPE "BusinessPlatformStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

ALTER TABLE "businesses"
  ADD COLUMN "platform_status" "BusinessPlatformStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "verified_at" TIMESTAMP(3),
  ADD COLUMN "suspended_at" TIMESTAMP(3),
  ADD COLUMN "suspension_reason" TEXT;

CREATE INDEX "businesses_platform_status_created_at_idx"
  ON "businesses"("platform_status", "created_at");
