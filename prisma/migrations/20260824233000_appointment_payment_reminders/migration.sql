ALTER TYPE "MessageType" ADD VALUE 'payment_reminder';

ALTER TABLE "appointments"
  ADD COLUMN "payment_reminder_sent_at" TIMESTAMP(3);

CREATE INDEX "appointments_status_payment_status_ends_at_payment_reminder_sent_at_idx"
  ON "appointments"("status", "payment_status", "ends_at", "payment_reminder_sent_at");
