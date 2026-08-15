-- CreateEnum
CREATE TYPE "SubscriptionEnvironment" AS ENUM ('SANDBOX', 'PRODUCTION');

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "environment" "SubscriptionEnvironment",
ADD COLUMN     "google_purchase_token" TEXT;

-- CreateTable
CREATE TABLE "billing_events" (
    "id" TEXT NOT NULL,
    "business_id" TEXT,
    "provider" "SubscriptionProvider" NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "transaction_id" TEXT,
    "purchase_token" TEXT,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "billing_events_business_id_idx" ON "billing_events"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "billing_events_provider_provider_event_id_key" ON "billing_events"("provider", "provider_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_original_transaction_id_key" ON "subscriptions"("original_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_google_purchase_token_key" ON "subscriptions"("google_purchase_token");

-- AddForeignKey
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
