-- Operations #10: On My Way / Arrival. Additive only.
CREATE TYPE "AppointmentArrivalState" AS ENUM ('ON_MY_WAY', 'RUNNING_LATE', 'ARRIVED');

ALTER TYPE "MessageType" ADD VALUE 'appointment_on_the_way';

ALTER TABLE "appointments" ADD COLUMN     "arrival_state" "AppointmentArrivalState";
ALTER TABLE "appointments" ADD COLUMN     "arrival_state_at" TIMESTAMP(3);
ALTER TABLE "appointments" ADD COLUMN     "arrival_state_by_member_id" TEXT;
ALTER TABLE "appointments" ADD COLUMN     "arrival_customer_notified_at" TIMESTAMP(3);
