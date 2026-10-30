-- Voice number a business forwards unanswered calls to (iPhone missed-call path).
-- Additive and nullable: existing businesses are untouched.
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "call_line_e164" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "businesses_call_line_e164_key" ON "businesses"("call_line_e164");
