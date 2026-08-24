ALTER TABLE "businesses"
  ADD COLUMN "messaging_consent_confirmed_at" TIMESTAMP(3),
  ADD COLUMN "payment_reminders_enabled" BOOLEAN NOT NULL DEFAULT false;
