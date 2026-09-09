-- #17 No-show automation. Additive only.
ALTER TYPE "MessageType" ADD VALUE 'appointment_no_show';

ALTER TABLE "businesses" ADD COLUMN "no_show_follow_up_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "appointments" ADD COLUMN "no_show_follow_up_sent_at" TIMESTAMP(3);
