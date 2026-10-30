-- A customer can block a business from messaging them in the app.
-- Additive with a default: existing links are unaffected.
ALTER TABLE "customer_business_links" ADD COLUMN IF NOT EXISTS "blocked_by_customer" BOOLEAN NOT NULL DEFAULT false;
