CREATE TYPE "SupportTicketCategory" AS ENUM ('account', 'billing', 'booking', 'messaging', 'technical', 'other');
CREATE TYPE "SupportTicketStatus" AS ENUM ('open', 'in_progress', 'resolved', 'closed');

CREATE TABLE "support_tickets" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "created_by_user_id" TEXT NOT NULL,
  "category" "SupportTicketCategory" NOT NULL,
  "subject" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "status" "SupportTicketStatus" NOT NULL DEFAULT 'open',
  "expected_response_at" TIMESTAMP(3) NOT NULL,
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "support_tickets_business_id_created_at_idx" ON "support_tickets"("business_id", "created_at");
CREATE INDEX "support_tickets_status_expected_response_at_idx" ON "support_tickets"("status", "expected_response_at");
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
