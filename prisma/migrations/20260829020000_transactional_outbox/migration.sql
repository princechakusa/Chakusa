CREATE TYPE "OutboxStatus" AS ENUM ('PENDING','PUBLISHED','FAILED');
CREATE TABLE "outbox_events" (
  "id" TEXT NOT NULL,
  "dedupe_key" TEXT NOT NULL,
  "aggregate_type" TEXT NOT NULL,
  "aggregate_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "event_version" INTEGER NOT NULL DEFAULT 1,
  "tenant_id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "metadata" JSONB,
  "correlation_id" TEXT,
  "causation_id" TEXT,
  "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
  "retry_count" INTEGER NOT NULL DEFAULT 0,
  "published_at" TIMESTAMP(3),
  "last_attempt_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "outbox_events_dedupe_key_key" ON "outbox_events"("dedupe_key");
CREATE INDEX "outbox_events_status_created_at_idx" ON "outbox_events"("status", "created_at");
CREATE INDEX "outbox_events_business_id_status_created_at_idx" ON "outbox_events"("business_id", "status", "created_at");
CREATE INDEX "outbox_events_aggregate_type_aggregate_id_created_at_idx" ON "outbox_events"("aggregate_type", "aggregate_id", "created_at");
CREATE INDEX "outbox_events_event_type_created_at_idx" ON "outbox_events"("event_type", "created_at");
