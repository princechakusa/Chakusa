-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'PRO');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'TRIALING', 'GRACE_PERIOD', 'EXPIRED', 'CANCELED');

-- CreateEnum
CREATE TYPE "SubscriptionProvider" AS ENUM ('APPLE', 'GOOGLE');

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'FREE',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "provider" "SubscriptionProvider",
    "provider_product_id" TEXT,
    "original_transaction_id" TEXT,
    "latest_transaction_id" TEXT,
    "current_period_start" TIMESTAMP(3),
    "current_period_end" TIMESTAMP(3),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "trial_ends_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_business_id_key" ON "subscriptions"("business_id");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every business that existed before this migration gets a FREE
-- subscription. New businesses get one created at registration time
-- (src/modules/auth/auth.service.ts) or via POST /business
-- (src/modules/business/business.routes.ts), so this INSERT only ever
-- matters for rows that predate this migration — the WHERE NOT EXISTS guard
-- also makes it safe to run again without creating duplicates.
INSERT INTO "subscriptions" ("id", "business_id", "plan", "status", "cancel_at_period_end", "created_at", "updated_at")
SELECT gen_random_uuid(), b."id", 'FREE', 'ACTIVE', false, now(), now()
FROM "businesses" b
WHERE NOT EXISTS (SELECT 1 FROM "subscriptions" s WHERE s."business_id" = b."id");
