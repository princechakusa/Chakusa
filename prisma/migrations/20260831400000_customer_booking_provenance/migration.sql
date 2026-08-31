-- PROGRAM 2 LOOP 3: customer booking provenance. Additive only — a nullable
-- column plus a defaulted column on `appointments`, one index, one FK.
-- No appointment logic or existing column is touched.

-- AlterTable
ALTER TABLE "appointments"
  ADD COLUMN "booked_by_customer_profile_id" TEXT,
  ADD COLUMN "booking_channel" TEXT NOT NULL DEFAULT 'business';

-- CreateIndex
CREATE INDEX "appointments_booked_by_customer_profile_id_starts_at_idx" ON "appointments"("booked_by_customer_profile_id", "starts_at");

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_booked_by_customer_profile_id_fkey" FOREIGN KEY ("booked_by_customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
