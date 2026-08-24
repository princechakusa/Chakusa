CREATE TYPE "AppointmentStatus" AS ENUM ('SCHEDULED', 'CONFIRMED', 'COMPLETED', 'CANCELED', 'NO_SHOW');

ALTER TYPE "ActivityEventType" ADD VALUE 'APPOINTMENT_CREATED';
ALTER TYPE "ActivityEventType" ADD VALUE 'APPOINTMENT_UPDATED';
ALTER TYPE "ActivityEventType" ADD VALUE 'APPOINTMENT_COMPLETED';
ALTER TYPE "ActivityEventType" ADD VALUE 'APPOINTMENT_CANCELED';
ALTER TYPE "ActivityEventType" ADD VALUE 'APPOINTMENT_NO_SHOW';

CREATE TABLE "appointments" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "customer_id" TEXT,
  "assigned_member_id" TEXT,
  "service_name" TEXT NOT NULL,
  "starts_at" TIMESTAMPTZ NOT NULL,
  "ends_at" TIMESTAMPTZ NOT NULL,
  "status" "AppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
  "price" DECIMAL(10,2),
  "notes" TEXT,
  "reminder_minutes" INTEGER,
  "created_by_user_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "appointments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "appointments_valid_range" CHECK ("ends_at" > "starts_at"),
  CONSTRAINT "appointments_nonnegative_price" CHECK ("price" IS NULL OR "price" >= 0),
  CONSTRAINT "appointments_valid_reminder" CHECK ("reminder_minutes" IS NULL OR "reminder_minutes" BETWEEN 0 AND 10080)
);

CREATE INDEX "appointments_business_id_starts_at_idx" ON "appointments"("business_id", "starts_at");
CREATE INDEX "appointments_business_id_status_starts_at_idx" ON "appointments"("business_id", "status", "starts_at");
CREATE INDEX "appointments_customer_id_starts_at_idx" ON "appointments"("customer_id", "starts_at");
CREATE INDEX "appointments_assigned_member_id_starts_at_idx" ON "appointments"("assigned_member_id", "starts_at");

ALTER TABLE "appointments" ADD CONSTRAINT "appointments_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_assigned_member_id_fkey" FOREIGN KEY ("assigned_member_id") REFERENCES "business_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
