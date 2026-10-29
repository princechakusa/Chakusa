-- Records when a person confirmed they are 18 or older at sign-up.
-- Additive and nullable: existing accounts are untouched.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "age_confirmed_at" TIMESTAMP(3);
