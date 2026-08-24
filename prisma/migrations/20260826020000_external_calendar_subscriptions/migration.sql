CREATE TABLE "external_calendar_subscriptions" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "token_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'Chakusa calendar',
    "revoked_at" TIMESTAMP(3),
    "last_accessed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "external_calendar_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "external_calendar_subscriptions_token_id_key" ON "external_calendar_subscriptions"("token_id");
CREATE INDEX "external_calendar_subscriptions_business_id_revoked_at_idx" ON "external_calendar_subscriptions"("business_id", "revoked_at");
ALTER TABLE "external_calendar_subscriptions" ADD CONSTRAINT "external_calendar_subscriptions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
