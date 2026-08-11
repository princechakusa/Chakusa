-- CreateEnum
CREATE TYPE "BusinessRole" AS ENUM ('OWNER', 'STAFF');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('new', 'contacted', 'booked', 'won', 'lost');

-- CreateEnum
CREATE TYPE "LeadUrgency" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('missed_call', 'booking_confirmation', 'review_request', 'private_feedback', 'comeback_reminder', 'custom');

-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('sms', 'whatsapp', 'call', 'email', 'other');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('draft', 'copied', 'sent', 'failed');

-- CreateEnum
CREATE TYPE "ReviewRequestStatus" AS ENUM ('pending', 'sent', 'opened', 'reviewed', 'feedback_received');

-- CreateEnum
CREATE TYPE "FeedbackSentiment" AS ENUM ('positive', 'neutral', 'negative');

-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('new', 'acknowledged', 'resolved');

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('due', 'sent', 'completed', 'dismissed');

-- CreateEnum
CREATE TYPE "MessageTone" AS ENUM ('friendly', 'professional', 'casual');

-- CreateEnum
CREATE TYPE "ActivityEventType" AS ENUM ('LEAD_CREATED', 'LEAD_CONTACTED', 'LEAD_BOOKED', 'LEAD_WON', 'LEAD_LOST', 'MESSAGE_COPIED', 'MESSAGE_MARKED_SENT', 'REVIEW_REQUEST_CREATED', 'REVIEW_REQUEST_SENT', 'REVIEW_OPENED', 'REVIEW_RECEIVED', 'FEEDBACK_RECEIVED', 'REMINDER_CREATED', 'REMINDER_SENT', 'REMINDER_COMPLETED', 'REMINDER_DISMISSED', 'CUSTOMER_CREATED', 'CUSTOMER_UPDATED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "businesses" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "industry" TEXT,
    "phone" TEXT,
    "google_review_link" TEXT,
    "working_hours" JSONB,
    "default_services" JSONB,
    "reminder_days" INTEGER NOT NULL DEFAULT 42,
    "preferred_tone" "MessageTone" NOT NULL DEFAULT 'friendly',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_members" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "BusinessRole" NOT NULL DEFAULT 'OWNER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "source" TEXT,
    "missed_call_time" TIMESTAMP(3),
    "service_requested" TEXT,
    "urgency" "LeadUrgency" NOT NULL DEFAULT 'medium',
    "status" "LeadStatus" NOT NULL DEFAULT 'new',
    "estimated_value" DECIMAL(10,2),
    "notes" TEXT,
    "generated_reply" TEXT,
    "contacted_at" TIMESTAMP(3),
    "booked_at" TIMESTAMP(3),
    "won_at" TIMESTAMP(3),
    "lost_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "lead_id" TEXT,
    "message_type" "MessageType" NOT NULL,
    "channel" "MessageChannel" NOT NULL DEFAULT 'sms',
    "body" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'draft',
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_requests" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "service_name" TEXT,
    "message" TEXT,
    "status" "ReviewRequestStatus" NOT NULL DEFAULT 'pending',
    "google_review_link" TEXT,
    "private_feedback_url" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "review_request_id" TEXT,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "sentiment" "FeedbackSentiment",
    "status" "FeedbackStatus" NOT NULL DEFAULT 'new',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminders" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "service_name" TEXT,
    "last_visit_date" TIMESTAMP(3),
    "due_date" TIMESTAMP(3) NOT NULL,
    "message" TEXT,
    "status" "ReminderStatus" NOT NULL DEFAULT 'due',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_templates" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "template_type" "MessageType" NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "tone" "MessageTone" NOT NULL DEFAULT 'friendly',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_events" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "event_type" "ActivityEventType" NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "businesses_owner_id_idx" ON "businesses"("owner_id");

-- CreateIndex
CREATE INDEX "business_members_user_id_idx" ON "business_members"("user_id");

-- CreateIndex
CREATE INDEX "business_members_business_id_idx" ON "business_members"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "business_members_business_id_user_id_key" ON "business_members"("business_id", "user_id");

-- CreateIndex
CREATE INDEX "customers_business_id_idx" ON "customers"("business_id");

-- CreateIndex
CREATE INDEX "customers_business_id_created_at_idx" ON "customers"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "leads_business_id_idx" ON "leads"("business_id");

-- CreateIndex
CREATE INDEX "leads_business_id_status_idx" ON "leads"("business_id", "status");

-- CreateIndex
CREATE INDEX "leads_business_id_created_at_idx" ON "leads"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "leads_customer_id_idx" ON "leads"("customer_id");

-- CreateIndex
CREATE INDEX "messages_business_id_idx" ON "messages"("business_id");

-- CreateIndex
CREATE INDEX "messages_business_id_created_at_idx" ON "messages"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_customer_id_idx" ON "messages"("customer_id");

-- CreateIndex
CREATE INDEX "messages_lead_id_idx" ON "messages"("lead_id");

-- CreateIndex
CREATE INDEX "review_requests_business_id_idx" ON "review_requests"("business_id");

-- CreateIndex
CREATE INDEX "review_requests_business_id_status_idx" ON "review_requests"("business_id", "status");

-- CreateIndex
CREATE INDEX "review_requests_customer_id_idx" ON "review_requests"("customer_id");

-- CreateIndex
CREATE INDEX "feedback_business_id_idx" ON "feedback"("business_id");

-- CreateIndex
CREATE INDEX "feedback_business_id_status_idx" ON "feedback"("business_id", "status");

-- CreateIndex
CREATE INDEX "feedback_customer_id_idx" ON "feedback"("customer_id");

-- CreateIndex
CREATE INDEX "reminders_business_id_idx" ON "reminders"("business_id");

-- CreateIndex
CREATE INDEX "reminders_business_id_status_idx" ON "reminders"("business_id", "status");

-- CreateIndex
CREATE INDEX "reminders_business_id_due_date_idx" ON "reminders"("business_id", "due_date");

-- CreateIndex
CREATE INDEX "reminders_customer_id_idx" ON "reminders"("customer_id");

-- CreateIndex
CREATE INDEX "message_templates_business_id_idx" ON "message_templates"("business_id");

-- CreateIndex
CREATE INDEX "message_templates_business_id_template_type_idx" ON "message_templates"("business_id", "template_type");

-- CreateIndex
CREATE INDEX "activity_events_business_id_idx" ON "activity_events"("business_id");

-- CreateIndex
CREATE INDEX "activity_events_business_id_created_at_idx" ON "activity_events"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "activity_events_entity_type_entity_id_idx" ON "activity_events"("entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_members" ADD CONSTRAINT "business_members_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_members" ADD CONSTRAINT "business_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_review_request_id_fkey" FOREIGN KEY ("review_request_id") REFERENCES "review_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
