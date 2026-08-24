CREATE TYPE "BetaFeedbackStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'CLOSED');
CREATE TYPE "BetaFeedbackCategory" AS ENUM ('BUG', 'PERFORMANCE', 'BOOKING', 'PAYMENTS', 'AUTOMATION', 'REPORTING', 'UX', 'OTHER');
CREATE TYPE "SubscriptionEventType" AS ENUM ('TRIAL_STARTED', 'TRIAL_EXPIRED', 'TRIAL_CONVERTED', 'SUBSCRIPTION_STARTED', 'UPGRADE', 'DOWNGRADE', 'CANCELLATION', 'GRACE_PERIOD', 'REACTIVATION', 'EXPIRATION');

ALTER TABLE "businesses" ADD COLUMN "beta_cohort" TEXT;
CREATE INDEX "businesses_beta_cohort_idx" ON "businesses"("beta_cohort");

CREATE TABLE "beta_feedback" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "created_by_user_id" TEXT NOT NULL,
  "rating" INTEGER NOT NULL,
  "category" "BetaFeedbackCategory" NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "app_version" TEXT,
  "platform" TEXT,
  "device_model" TEXT,
  "build_number" TEXT,
  "screenshot_url" TEXT,
  "status" "BetaFeedbackStatus" NOT NULL DEFAULT 'OPEN',
  "internal_notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "beta_feedback_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "beta_feedback_business_id_created_at_idx" ON "beta_feedback"("business_id", "created_at");
CREATE INDEX "beta_feedback_status_created_at_idx" ON "beta_feedback"("status", "created_at");
CREATE INDEX "beta_feedback_category_created_at_idx" ON "beta_feedback"("category", "created_at");
ALTER TABLE "beta_feedback" ADD CONSTRAINT "beta_feedback_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "beta_feedback" ADD CONSTRAINT "beta_feedback_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "subscription_events" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "type" "SubscriptionEventType" NOT NULL,
  "provider" "SubscriptionProvider",
  "from_plan" "Plan",
  "to_plan" "Plan",
  "from_status" "SubscriptionStatus",
  "to_status" "SubscriptionStatus",
  "effective_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "subscription_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "subscription_events_business_id_effective_at_idx" ON "subscription_events"("business_id", "effective_at");
CREATE INDEX "subscription_events_type_effective_at_idx" ON "subscription_events"("type", "effective_at");
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
