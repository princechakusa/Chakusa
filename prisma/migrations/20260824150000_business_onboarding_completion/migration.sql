ALTER TABLE "businesses"
ADD COLUMN "onboarding_completed_at" TIMESTAMPTZ;

-- Preserve access for existing businesses that completed the former
-- name/phone/services setup contract before completion became explicit.
UPDATE "businesses"
SET "onboarding_completed_at" = "updated_at"
WHERE "phone" IS NOT NULL
  AND BTRIM("phone") <> ''
  AND JSONB_TYPEOF("default_services") = 'array'
  AND JSONB_ARRAY_LENGTH("default_services") > 0;
