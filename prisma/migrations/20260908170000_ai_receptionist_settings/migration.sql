-- AI Receptionist #15: business-facing control for the existing AI Customer
-- Agent engine. Additive only — no change to any existing table.
CREATE TABLE "ai_receptionist_settings" (
    "business_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "sms_enabled" BOOLEAN NOT NULL DEFAULT true,
    "whatsapp_enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_receptionist_settings_pkey" PRIMARY KEY ("business_id")
);

ALTER TABLE "ai_receptionist_settings" ADD CONSTRAINT "ai_receptionist_settings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
