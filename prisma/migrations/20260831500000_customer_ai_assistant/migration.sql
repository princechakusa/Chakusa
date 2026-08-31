-- PROGRAM 2 LOOP 4: Customer AI Assistant thread storage. Two new tables
-- only — no existing column touched. Every AI turn is executed by the
-- existing AI Platform; these tables are the customer-visible chat threads.

-- CreateTable
CREATE TABLE "customer_ai_conversations" (
    "id" TEXT NOT NULL,
    "customer_profile_id" TEXT NOT NULL,
    "business_id" TEXT,
    "title" TEXT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "last_message_at" TIMESTAMP(3),
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_ai_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "run_id" TEXT,
    "tool_calls" JSONB,
    "policy_outcome" TEXT,
    "rating" INTEGER,
    "feedback_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_ai_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_ai_conversations_customer_profile_id_pinned_last_m_idx" ON "customer_ai_conversations"("customer_profile_id", "pinned", "last_message_at");

-- CreateIndex
CREATE INDEX "customer_ai_conversations_customer_profile_id_archived_at_d_idx" ON "customer_ai_conversations"("customer_profile_id", "archived_at", "deleted_at");

-- CreateIndex
CREATE INDEX "customer_ai_messages_conversation_id_created_at_idx" ON "customer_ai_messages"("conversation_id", "created_at");

-- AddForeignKey
ALTER TABLE "customer_ai_conversations" ADD CONSTRAINT "customer_ai_conversations_customer_profile_id_fkey" FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_ai_messages" ADD CONSTRAINT "customer_ai_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "customer_ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
