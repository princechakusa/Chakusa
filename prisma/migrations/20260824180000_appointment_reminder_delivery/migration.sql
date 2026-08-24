ALTER TABLE "appointments" ADD COLUMN "reminder_sent_at" TIMESTAMPTZ;
CREATE INDEX "appointments_reminder_due_idx" ON "appointments"("reminder_sent_at", "starts_at") WHERE "reminder_minutes" IS NOT NULL AND "status" IN ('SCHEDULED', 'CONFIRMED');
