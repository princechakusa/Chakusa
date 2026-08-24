ALTER TABLE "appointments"
ADD COLUMN "confirmation_sent_at" TIMESTAMP(3),
ADD COLUMN "customer_reminder_sent_at" TIMESTAMP(3);

CREATE INDEX "appointments_status_starts_at_customer_reminder_sent_at_idx"
ON "appointments"("status", "starts_at", "customer_reminder_sent_at");
