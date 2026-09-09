-- #20 Reputation & Review Growth. Additive only.
-- - Business: opt-in automatic post-completion review request + its window knobs.
-- - Appointment: the atomic send-claim column for that request.
-- - ReviewRequest: link to the triggering appointment (unique -> one per appointment).
-- - Feedback: the business's public reply to a review.
-- Constant defaults / nullable columns => PG11+ metadata-only, no table rewrite.
-- The unique index is on an all-NULL new column => builds instantly, NULLs never conflict.
-- Enum ADD VALUE (PG12+, value unused in this migration) matches the existing
-- MessageType ADD VALUE migrations in this repo.

ALTER TYPE "ActivityEventType" ADD VALUE 'FEEDBACK_RESPONDED';
ALTER TYPE "ActivityEventType" ADD VALUE 'FEEDBACK_RESPONSE_CLEARED';

ALTER TABLE "businesses" ADD COLUMN "review_request_auto_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "businesses" ADD COLUMN "review_request_delay_hours" INTEGER NOT NULL DEFAULT 24;
ALTER TABLE "businesses" ADD COLUMN "review_request_min_interval_days" INTEGER NOT NULL DEFAULT 45;

ALTER TABLE "appointments" ADD COLUMN "review_request_sent_at" TIMESTAMP(3);

ALTER TABLE "review_requests" ADD COLUMN "appointment_id" TEXT;
CREATE UNIQUE INDEX "review_requests_appointment_id_key" ON "review_requests"("appointment_id");
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_appointment_id_fkey"
  FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "feedback" ADD COLUMN "response" TEXT;
ALTER TABLE "feedback" ADD COLUMN "responded_at" TIMESTAMP(3);
ALTER TABLE "feedback" ADD COLUMN "responded_by_user_id" TEXT;
