-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "actor_type" TEXT NOT NULL DEFAULT 'HUMAN',
ADD COLUMN     "causation_id" TEXT,
ADD COLUMN     "conversation_id" TEXT,
ADD COLUMN     "correlation_id" TEXT,
ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "direction" TEXT NOT NULL DEFAULT 'OUTBOUND',
ADD COLUMN     "expires_at" TIMESTAMP(3),
ADD COLUMN     "idempotency_key" TEXT,
ADD COLUMN     "purpose" TEXT NOT NULL DEFAULT 'SERVICE',
ADD COLUMN     "read_at" TIMESTAMP(3),
ADD COLUMN     "replied_at" TIMESTAMP(3),
ADD COLUMN     "scheduled_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "subject" TEXT,
    "context_type" TEXT,
    "context_id" TEXT,
    "assigned_member_id" TEXT,
    "automation_mode" TEXT NOT NULL DEFAULT 'AUTOMATED',
    "last_inbound_at" TIMESTAMP(3),
    "last_outbound_at" TIMESTAMP(3),
    "waiting_since" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_participants" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "member_id" TEXT,
    "external_address" TEXT,
    "role" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_assignments" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "member_id" TEXT,
    "assigned_by_id" TEXT,
    "reason" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "conversation_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_lifecycle_events" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actor_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_lifecycle_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_slas" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "due_at" TIMESTAMP(3) NOT NULL,
    "breached_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_slas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "internal_conversation_notes" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "internal_conversation_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_contents" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "content_type" TEXT NOT NULL DEFAULT 'TEXT',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "structured" JSONB,
    "template_version_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_contents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_attachments" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "message_id" TEXT,
    "storage_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "declared_mime" TEXT NOT NULL,
    "detected_mime" TEXT,
    "size_bytes" INTEGER NOT NULL,
    "checksum_sha256" TEXT NOT NULL,
    "encryption_key_version" TEXT,
    "malware_scan_status" TEXT NOT NULL DEFAULT 'PENDING',
    "provider_media_id" TEXT,
    "retention_until" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_dispatches" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "sender_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "idempotency_key" TEXT NOT NULL,
    "scheduled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 8,
    "lease_owner" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "last_error" TEXT,
    "provider_message_id" TEXT,
    "accepted_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_dispatches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_dispatch_attempts" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "dispatch_id" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error_code" TEXT,
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "message_dispatch_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_receipts" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "provider_message_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error_code" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messaging_channel_accounts" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "external_account_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "capabilities" JSONB,
    "health_status" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "last_health_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messaging_channel_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messaging_senders" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "channel_account_id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "country_code" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messaging_senders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_credentials" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "channel_account_id" TEXT NOT NULL,
    "key_version" TEXT NOT NULL,
    "encrypted_payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "rotated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_communication_preferences" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "preferred_channels" JSONB NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "quiet_hours" JSONB,
    "marketing_consent" BOOLEAN NOT NULL DEFAULT false,
    "transactional_consent" BOOLEAN NOT NULL DEFAULT true,
    "service_consent" BOOLEAN NOT NULL DEFAULT true,
    "frequency_caps" JSONB,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_communication_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_consent_events" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "channel" TEXT,
    "purpose" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "source" TEXT NOT NULL,
    "legal_basis" TEXT,
    "evidence" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_consent_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messaging_suppressions" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "address" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "purpose" TEXT,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lifted_at" TIMESTAMP(3),

    CONSTRAINT "messaging_suppressions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messaging_templates_v2" (
    "id" TEXT NOT NULL,
    "business_id" TEXT,
    "scope" TEXT NOT NULL,
    "industry" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messaging_templates_v2_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messaging_template_versions" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "variables" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "approved_at" TIMESTAMP(3),
    "retired_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messaging_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_templates" (
    "id" TEXT NOT NULL,
    "business_id" TEXT,
    "channel_account_id" TEXT NOT NULL,
    "template_version_id" TEXT NOT NULL,
    "provider_template_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "category" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_approval_events" (
    "id" TEXT NOT NULL,
    "provider_template_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "template_approval_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messaging_cost_events" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "amount" DECIMAL(12,6) NOT NULL,
    "currency" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messaging_cost_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_attributions" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "outcome_type" TEXT NOT NULL,
    "outcome_id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "value" DECIMAL(12,2),
    "currency" TEXT,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_attributions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversations_business_id_status_priority_updated_at_idx" ON "conversations"("business_id", "status", "priority", "updated_at");

-- CreateIndex
CREATE INDEX "conversations_business_id_customer_id_updated_at_idx" ON "conversations"("business_id", "customer_id", "updated_at");

-- CreateIndex
CREATE INDEX "conversations_business_id_assigned_member_id_status_idx" ON "conversations"("business_id", "assigned_member_id", "status");

-- CreateIndex
CREATE INDEX "conversation_participants_business_id_conversation_id_idx" ON "conversation_participants"("business_id", "conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_participants_conversation_id_role_external_add_key" ON "conversation_participants"("conversation_id", "role", "external_address");

-- CreateIndex
CREATE INDEX "conversation_assignments_business_id_member_id_ended_at_idx" ON "conversation_assignments"("business_id", "member_id", "ended_at");

-- CreateIndex
CREATE INDEX "conversation_assignments_conversation_id_started_at_idx" ON "conversation_assignments"("conversation_id", "started_at");

-- CreateIndex
CREATE INDEX "conversation_lifecycle_events_business_id_created_at_idx" ON "conversation_lifecycle_events"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "conversation_lifecycle_events_conversation_id_created_at_idx" ON "conversation_lifecycle_events"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "conversation_slas_business_id_status_due_at_idx" ON "conversation_slas"("business_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "conversation_slas_conversation_id_created_at_idx" ON "conversation_slas"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "internal_conversation_notes_business_id_conversation_id_cre_idx" ON "internal_conversation_notes"("business_id", "conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "message_contents_business_id_message_id_idx" ON "message_contents"("business_id", "message_id");

-- CreateIndex
CREATE INDEX "message_attachments_business_id_malware_scan_status_idx" ON "message_attachments"("business_id", "malware_scan_status");

-- CreateIndex
CREATE UNIQUE INDEX "message_attachments_business_id_storage_key_key" ON "message_attachments"("business_id", "storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "message_dispatches_idempotency_key_key" ON "message_dispatches"("idempotency_key");

-- CreateIndex
CREATE INDEX "message_dispatches_status_next_attempt_at_lease_expires_at_idx" ON "message_dispatches"("status", "next_attempt_at", "lease_expires_at");

-- CreateIndex
CREATE INDEX "message_dispatches_business_id_status_created_at_idx" ON "message_dispatches"("business_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "message_dispatches_provider_channel_status_idx" ON "message_dispatches"("provider", "channel", "status");

-- CreateIndex
CREATE INDEX "message_dispatch_attempts_business_id_status_started_at_idx" ON "message_dispatch_attempts"("business_id", "status", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "message_dispatch_attempts_dispatch_id_attempt_key" ON "message_dispatch_attempts"("dispatch_id", "attempt");

-- CreateIndex
CREATE INDEX "message_receipts_business_id_message_id_occurred_at_idx" ON "message_receipts"("business_id", "message_id", "occurred_at");

-- CreateIndex
CREATE INDEX "message_receipts_provider_message_id_idx" ON "message_receipts"("provider_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_receipts_provider_provider_event_id_key" ON "message_receipts"("provider", "provider_event_id");

-- CreateIndex
CREATE INDEX "messaging_channel_accounts_business_id_status_idx" ON "messaging_channel_accounts"("business_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "messaging_channel_accounts_business_id_provider_channel_ext_key" ON "messaging_channel_accounts"("business_id", "provider", "channel", "external_account_id");

-- CreateIndex
CREATE INDEX "messaging_senders_business_id_status_country_code_idx" ON "messaging_senders"("business_id", "status", "country_code");

-- CreateIndex
CREATE UNIQUE INDEX "messaging_senders_channel_account_id_address_key" ON "messaging_senders"("channel_account_id", "address");

-- CreateIndex
CREATE INDEX "provider_credentials_business_id_status_idx" ON "provider_credentials"("business_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "customer_communication_preferences_business_id_customer_id_key" ON "customer_communication_preferences"("business_id", "customer_id");

-- CreateIndex
CREATE INDEX "customer_consent_events_business_id_customer_id_occurred_at_idx" ON "customer_consent_events"("business_id", "customer_id", "occurred_at");

-- CreateIndex
CREATE INDEX "messaging_suppressions_business_id_address_channel_active_idx" ON "messaging_suppressions"("business_id", "address", "channel", "active");

-- CreateIndex
CREATE UNIQUE INDEX "messaging_suppressions_business_id_channel_address_key" ON "messaging_suppressions"("business_id", "channel", "address");

-- CreateIndex
CREATE INDEX "messaging_templates_v2_scope_industry_key_idx" ON "messaging_templates_v2"("scope", "industry", "key");

-- CreateIndex
CREATE UNIQUE INDEX "messaging_templates_v2_business_id_key_key" ON "messaging_templates_v2"("business_id", "key");

-- CreateIndex
CREATE INDEX "messaging_template_versions_status_channel_locale_idx" ON "messaging_template_versions"("status", "channel", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "messaging_template_versions_template_id_version_channel_loc_key" ON "messaging_template_versions"("template_id", "version", "channel", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "provider_templates_channel_account_id_template_version_id_key" ON "provider_templates"("channel_account_id", "template_version_id");

-- CreateIndex
CREATE INDEX "template_approval_events_provider_template_id_occurred_at_idx" ON "template_approval_events"("provider_template_id", "occurred_at");

-- CreateIndex
CREATE INDEX "messaging_cost_events_business_id_occurred_at_verified_idx" ON "messaging_cost_events"("business_id", "occurred_at", "verified");

-- CreateIndex
CREATE INDEX "message_attributions_business_id_verified_at_idx" ON "message_attributions"("business_id", "verified_at");

-- CreateIndex
CREATE UNIQUE INDEX "message_attributions_message_id_outcome_type_outcome_id_mod_key" ON "message_attributions"("message_id", "outcome_type", "outcome_id", "model");

-- CreateIndex
CREATE UNIQUE INDEX "messages_idempotency_key_key" ON "messages"("idempotency_key");

-- CreateIndex
CREATE INDEX "messages_business_id_conversation_id_created_at_idx" ON "messages"("business_id", "conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_business_id_scheduled_at_status_idx" ON "messages"("business_id", "scheduled_at", "status");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_assignments" ADD CONSTRAINT "conversation_assignments_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_lifecycle_events" ADD CONSTRAINT "conversation_lifecycle_events_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_slas" ADD CONSTRAINT "conversation_slas_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_conversation_notes" ADD CONSTRAINT "internal_conversation_notes_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_contents" ADD CONSTRAINT "message_contents_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_dispatches" ADD CONSTRAINT "message_dispatches_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_dispatch_attempts" ADD CONSTRAINT "message_dispatch_attempts_dispatch_id_fkey" FOREIGN KEY ("dispatch_id") REFERENCES "message_dispatches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_receipts" ADD CONSTRAINT "message_receipts_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messaging_senders" ADD CONSTRAINT "messaging_senders_channel_account_id_fkey" FOREIGN KEY ("channel_account_id") REFERENCES "messaging_channel_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_channel_account_id_fkey" FOREIGN KEY ("channel_account_id") REFERENCES "messaging_channel_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messaging_template_versions" ADD CONSTRAINT "messaging_template_versions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "messaging_templates_v2"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_templates" ADD CONSTRAINT "provider_templates_channel_account_id_fkey" FOREIGN KEY ("channel_account_id") REFERENCES "messaging_channel_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_templates" ADD CONSTRAINT "provider_templates_template_version_id_fkey" FOREIGN KEY ("template_version_id") REFERENCES "messaging_template_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_approval_events" ADD CONSTRAINT "template_approval_events_provider_template_id_fkey" FOREIGN KEY ("provider_template_id") REFERENCES "provider_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messaging_cost_events" ADD CONSTRAINT "messaging_cost_events_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_attributions" ADD CONSTRAINT "message_attributions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
