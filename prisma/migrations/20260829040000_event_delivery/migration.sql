CREATE TABLE "event_subscriptions" ("id" TEXT NOT NULL,"name" TEXT NOT NULL,"event_type" TEXT NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"active" BOOLEAN NOT NULL DEFAULT true,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "event_subscriptions_pkey" PRIMARY KEY ("id"));
CREATE TABLE "event_deliveries" ("id" TEXT NOT NULL,"event_id" TEXT NOT NULL,"subscription_id" TEXT NOT NULL,"status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',"attempts" INTEGER NOT NULL DEFAULT 0,"lease_owner" TEXT,"lease_expires_at" TIMESTAMP(3),"last_error" TEXT,"delivered_at" TIMESTAMP(3),"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "event_deliveries_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "event_subscriptions_name_key" ON "event_subscriptions"("name");
CREATE UNIQUE INDEX "event_deliveries_event_id_subscription_id_key" ON "event_deliveries"("event_id","subscription_id");
CREATE INDEX "event_subscriptions_event_type_active_idx" ON "event_subscriptions"("event_type","active");
CREATE INDEX "event_deliveries_status_lease_expires_at_created_at_idx" ON "event_deliveries"("status","lease_expires_at","created_at");
ALTER TABLE "event_deliveries" ADD CONSTRAINT "event_deliveries_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "outbox_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_deliveries" ADD CONSTRAINT "event_deliveries_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "event_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
