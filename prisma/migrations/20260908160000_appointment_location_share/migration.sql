-- Live Location #14: appointment-arrival location sharing. Additive only.
-- One latest-fix row per appointment, server-side expiry, no history table.
CREATE TABLE "appointment_location_shares" (
    "appointment_id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "sharing_member_id" TEXT NOT NULL,
    "latitude" DECIMAL(8,5) NOT NULL,
    "longitude" DECIMAL(8,5) NOT NULL,
    "accuracy_meters" INTEGER,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointment_location_shares_pkey" PRIMARY KEY ("appointment_id")
);

CREATE INDEX "appointment_location_shares_business_id_idx" ON "appointment_location_shares"("business_id");
CREATE INDEX "appointment_location_shares_expires_at_idx" ON "appointment_location_shares"("expires_at");

ALTER TABLE "appointment_location_shares" ADD CONSTRAINT "appointment_location_shares_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "appointment_location_shares" ADD CONSTRAINT "appointment_location_shares_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
