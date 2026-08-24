ALTER TABLE "business_members"
ADD COLUMN "working_hours" JSONB;

ALTER TABLE "businesses"
ADD COLUMN "booking_min_notice_minutes" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN "booking_window_days" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN "slot_interval_minutes" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN "cancellation_notice_minutes" INTEGER NOT NULL DEFAULT 1440,
ADD COLUMN "default_appointment_reminder_minutes" INTEGER NOT NULL DEFAULT 1440;

CREATE TABLE "service_offerings" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "business_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "duration_minutes" INTEGER NOT NULL,
  "preparation_minutes" INTEGER NOT NULL DEFAULT 0,
  "cleanup_minutes" INTEGER NOT NULL DEFAULT 0,
  "price" DECIMAL(10,2),
  "deposit_amount" DECIMAL(10,2),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "publicly_bookable" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_offerings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "service_offerings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "service_offerings_business_id_name_key" ON "service_offerings"("business_id", "name");
CREATE INDEX "service_offerings_business_id_active_publicly_bookable_sort_order_idx" ON "service_offerings"("business_id", "active", "publicly_bookable", "sort_order");

INSERT INTO "service_offerings" ("business_id", "name", "duration_minutes", "sort_order")
SELECT "businesses"."id", services."name", 60, services."sort_order"
FROM "businesses"
CROSS JOIN LATERAL (
  SELECT trim(value) AS "name", MIN(ordinality)::INTEGER - 1 AS "sort_order"
  FROM jsonb_array_elements_text(COALESCE("businesses"."default_services"::jsonb, '[]'::jsonb)) WITH ORDINALITY AS values(value, ordinality)
  WHERE trim(value) <> ''
  GROUP BY trim(value)
) services
ON CONFLICT ("business_id", "name") DO NOTHING;

CREATE TABLE "service_member_assignments" (
  "service_offering_id" TEXT NOT NULL,
  "business_member_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_member_assignments_pkey" PRIMARY KEY ("service_offering_id", "business_member_id"),
  CONSTRAINT "service_member_assignments_service_offering_id_fkey" FOREIGN KEY ("service_offering_id") REFERENCES "service_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "service_member_assignments_business_member_id_fkey" FOREIGN KEY ("business_member_id") REFERENCES "business_members"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "service_member_assignments_business_member_id_idx" ON "service_member_assignments"("business_member_id");

CREATE TABLE "booking_blocks" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "business_id" TEXT NOT NULL,
  "assigned_member_id" TEXT,
  "starts_at" TIMESTAMP(3) NOT NULL,
  "ends_at" TIMESTAMP(3) NOT NULL,
  "reason" TEXT,
  "created_by_user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "booking_blocks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "booking_blocks_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "booking_blocks_assigned_member_id_fkey" FOREIGN KEY ("assigned_member_id") REFERENCES "business_members"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "booking_blocks_business_id_starts_at_idx" ON "booking_blocks"("business_id", "starts_at");
CREATE INDEX "booking_blocks_assigned_member_id_starts_at_idx" ON "booking_blocks"("assigned_member_id", "starts_at");

ALTER TABLE "appointments"
ADD COLUMN "service_offering_id" TEXT;

ALTER TABLE "appointments"
ADD CONSTRAINT "appointments_service_offering_id_fkey" FOREIGN KEY ("service_offering_id") REFERENCES "service_offerings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "appointments_service_offering_id_starts_at_idx" ON "appointments"("service_offering_id", "starts_at");

UPDATE "appointments"
SET "service_offering_id" = "service_offerings"."id"
FROM "service_offerings"
WHERE "appointments"."business_id" = "service_offerings"."business_id"
  AND lower(trim("appointments"."service_name")) = lower(trim("service_offerings"."name"));

CREATE TABLE "public_booking_access" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "business_id" TEXT NOT NULL,
  "appointment_id" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "public_booking_access_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "public_booking_access_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "public_booking_access_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "public_booking_access_appointment_id_key" ON "public_booking_access"("appointment_id");
CREATE INDEX "public_booking_access_business_id_idx" ON "public_booking_access"("business_id");
