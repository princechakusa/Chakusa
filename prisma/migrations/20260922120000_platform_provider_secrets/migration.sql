-- Admin-editable, encrypted-at-rest provider API credentials (OpenAI,
-- Anthropic, Twilio). Lets a platform admin set/rotate these from the admin
-- console instead of a Render env var, without a new build or deploy.
-- New table only, no data migration -> additive, zero-risk.

CREATE TABLE "platform_provider_secrets" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "encrypted_value" TEXT NOT NULL,
    "updated_by_admin_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_provider_secrets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "platform_provider_secrets_key_key" ON "platform_provider_secrets"("key");
