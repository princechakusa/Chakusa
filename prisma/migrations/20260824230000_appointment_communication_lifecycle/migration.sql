ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'appointment_reminder';
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'appointment_same_day_reminder';
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'appointment_rescheduled';
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'appointment_canceled';
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'appointment_follow_up';

ALTER TABLE "appointments"
  ADD COLUMN "same_day_reminder_sent_at" TIMESTAMP(3),
  ADD COLUMN "reschedule_confirmation_sent_at" TIMESTAMP(3),
  ADD COLUMN "cancellation_confirmation_sent_at" TIMESTAMP(3),
  ADD COLUMN "follow_up_sent_at" TIMESTAMP(3);

CREATE INDEX "appointments_status_starts_at_same_day_reminder_sent_at_idx"
  ON "appointments"("status", "starts_at", "same_day_reminder_sent_at");
CREATE INDEX "appointments_status_ends_at_follow_up_sent_at_idx"
  ON "appointments"("status", "ends_at", "follow_up_sent_at");
