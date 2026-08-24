CREATE TABLE "weekly_owner_reports" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "week_key" TEXT NOT NULL,
  "period_start" TIMESTAMP(3) NOT NULL,
  "period_end" TIMESTAMP(3) NOT NULL,
  "summary" JSONB NOT NULL,
  "viewed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "weekly_owner_reports_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "weekly_owner_reports_business_id_week_key_key" ON "weekly_owner_reports"("business_id", "week_key");
CREATE INDEX "weekly_owner_reports_business_id_period_end_idx" ON "weekly_owner_reports"("business_id", "period_end");
ALTER TABLE "weekly_owner_reports" ADD CONSTRAINT "weekly_owner_reports_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
