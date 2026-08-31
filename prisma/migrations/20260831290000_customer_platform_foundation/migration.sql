-- AlterEnum
ALTER TYPE "AuthSessionScope" ADD VALUE 'CUSTOMER';

-- CreateTable
CREATE TABLE "customer_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "display_name" TEXT,
    "avatar_url" TEXT,
    "phone" TEXT,
    "phone_e164" TEXT,
    "preferred_language" TEXT NOT NULL DEFAULT 'en',
    "preferred_timezone" TEXT NOT NULL DEFAULT 'UTC',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "marketing_consent" BOOLEAN NOT NULL DEFAULT false,
    "notification_preferences" JSONB NOT NULL DEFAULT '{}',
    "privacy_settings" JSONB NOT NULL DEFAULT '{}',
    "communication_preferences" JSONB NOT NULL DEFAULT '{}',
    "verified_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_business_links" (
    "id" TEXT NOT NULL,
    "customer_profile_id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "business_customer_id" TEXT,
    "relationship" TEXT NOT NULL DEFAULT 'CUSTOMER',
    "favourite" BOOLEAN NOT NULL DEFAULT false,
    "blocked_by_business" BOOLEAN NOT NULL DEFAULT false,
    "first_interaction_at" TIMESTAMP(3),
    "last_interaction_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_business_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_notifications" (
    "id" TEXT NOT NULL,
    "customer_profile_id" TEXT NOT NULL,
    "business_id" TEXT,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "channels" JSONB,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_activity_events" (
    "id" TEXT NOT NULL,
    "customer_profile_id" TEXT NOT NULL,
    "business_id" TEXT,
    "type" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_activity_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_verification_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_profiles_user_id_key" ON "customer_profiles"("user_id");

-- CreateIndex
CREATE INDEX "customer_profiles_status_idx" ON "customer_profiles"("status");

-- CreateIndex
CREATE INDEX "customer_profiles_phone_e164_idx" ON "customer_profiles"("phone_e164");

-- CreateIndex
CREATE INDEX "customer_business_links_business_id_idx" ON "customer_business_links"("business_id");

-- CreateIndex
CREATE INDEX "customer_business_links_business_customer_id_idx" ON "customer_business_links"("business_customer_id");

-- CreateIndex
CREATE INDEX "customer_business_links_customer_profile_id_favourite_idx" ON "customer_business_links"("customer_profile_id", "favourite");

-- CreateIndex
CREATE UNIQUE INDEX "customer_business_links_customer_profile_id_business_id_key" ON "customer_business_links"("customer_profile_id", "business_id");

-- CreateIndex
CREATE INDEX "customer_notifications_customer_profile_id_created_at_idx" ON "customer_notifications"("customer_profile_id", "created_at");

-- CreateIndex
CREATE INDEX "customer_notifications_customer_profile_id_read_at_idx" ON "customer_notifications"("customer_profile_id", "read_at");

-- CreateIndex
CREATE INDEX "customer_activity_events_customer_profile_id_created_at_idx" ON "customer_activity_events"("customer_profile_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_tokens_token_hash_key" ON "email_verification_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "email_verification_tokens_user_id_idx" ON "email_verification_tokens"("user_id");

-- CreateIndex
CREATE INDEX "email_verification_tokens_expires_at_idx" ON "email_verification_tokens"("expires_at");

-- AddForeignKey
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_business_links" ADD CONSTRAINT "customer_business_links_customer_profile_id_fkey" FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_notifications" ADD CONSTRAINT "customer_notifications_customer_profile_id_fkey" FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_activity_events" ADD CONSTRAINT "customer_activity_events_customer_profile_id_fkey" FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
