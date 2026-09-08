-- #16 After-hours AI: an operating mode of the AI Receptionist. Additive only.
ALTER TABLE "ai_receptionist_settings" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'ALWAYS';
ALTER TABLE "ai_conversation_runs" ADD COLUMN "after_hours" BOOLEAN;
