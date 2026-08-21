-- AlterTable
ALTER TABLE "leads" ADD COLUMN "client_event_id" TEXT;

-- CreateIndex
-- Postgres unique indexes permit unlimited NULLs, so existing/manual leads
-- (client_event_id always null) are never constrained by each other here —
-- this only enforces uniqueness once an automated connector actually
-- supplies a clientEventId, which is exactly the retry-safety guarantee
-- createLeadFromMissedCall (src/modules/leads/leads.service.ts) relies on.
CREATE UNIQUE INDEX "leads_business_id_client_event_id_key" ON "leads"("business_id", "client_event_id");
