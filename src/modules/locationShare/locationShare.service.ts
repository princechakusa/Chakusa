import { Prisma, type AppointmentStatus, type AppointmentArrivalState } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { ownedAppointmentWhere } from "../../lib/booking/customerBooking.js";
import type { StartLocationShareInput, UpdateLocationShareInput } from "./locationShare.schemas.js";

// Hard ceilings — a share cannot outlive either.
const MAX_SHARE_MINUTES = 60;
const POST_APPOINTMENT_GRACE_MINUTES = 30;
// Server-side floor between accepted position updates for one appointment.
const MIN_UPDATE_INTERVAL_MS = 4_000;

const ACTIVE_STATUSES: AppointmentStatus[] = ["SCHEDULED", "CONFIRMED"];
const SHAREABLE_ARRIVAL: AppointmentArrivalState[] = ["ON_MY_WAY", "RUNNING_LATE"];

const round5 = (n: number) => new Prisma.Decimal(n).toDecimalPlaces(5, Prisma.Decimal.ROUND_HALF_UP);

type EligibilityAppointment = { status: AppointmentStatus; arrivalState: AppointmentArrivalState | null; endsAt: Date };

/** Why an appointment may not (or no longer) carry a live-location share. Null = eligible. */
function ineligibleReason(appt: EligibilityAppointment, now: Date): string | null {
  if (!ACTIVE_STATUSES.includes(appt.status)) return "appointment_closed";
  if (!appt.arrivalState || !SHAREABLE_ARRIVAL.includes(appt.arrivalState)) return "not_on_the_way";
  if (now.getTime() > appt.endsAt.getTime() + POST_APPOINTMENT_GRACE_MINUTES * 60_000) return "window_passed";
  return null;
}

function computeExpiry(endsAt: Date, now: Date): Date {
  const hardCap = new Date(now.getTime() + MAX_SHARE_MINUTES * 60_000);
  const appointmentCap = new Date(endsAt.getTime() + POST_APPOINTMENT_GRACE_MINUTES * 60_000);
  return hardCap < appointmentCap ? hardCap : appointmentCap;
}

function serialize(row: { latitude: Prisma.Decimal; longitude: Prisma.Decimal; accuracyMeters: number | null; startedAt: Date; updatedAt: Date; expiresAt: Date }) {
  return {
    sharing: true as const,
    latitude: row.latitude.toNumber(),
    longitude: row.longitude.toNumber(),
    accuracyMeters: row.accuracyMeters,
    startedAt: row.startedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

/** The caller must be an ACTIVE member of this business AND the appointment's assigned provider. */
async function assertAssignedProvider(tx: Prisma.TransactionClient, businessId: string, appointmentId: string, actorUserId: string) {
  const appointment = await tx.appointment.findFirst({ where: { id: appointmentId, businessId }, select: { assignedMemberId: true, status: true, arrivalState: true, endsAt: true } });
  if (!appointment) throw ApiError.notFound("Appointment not found");
  const member = await tx.businessMember.findFirst({ where: { businessId, userId: actorUserId, status: "ACTIVE" }, select: { id: true } });
  if (!member) throw ApiError.forbidden("You are not an active member of this business");
  if (!appointment.assignedMemberId || appointment.assignedMemberId !== member.id) {
    throw ApiError.forbidden("Only the appointment's assigned provider can share their location");
  }
  return { appointment, memberId: member.id };
}

export async function startLocationShare(businessId: string, actorUserId: string, appointmentId: string, input: StartLocationShareInput) {
  const now = new Date();
  return prisma.$transaction(async tx => {
    const { appointment, memberId } = await assertAssignedProvider(tx, businessId, appointmentId, actorUserId);
    const reason = ineligibleReason(appointment, now);
    if (reason) throw ApiError.conflict(`Location sharing is not available for this appointment (${reason})`);

    const expiresAt = computeExpiry(appointment.endsAt, now);
    const row = await tx.appointmentLocationShare.upsert({
      where: { appointmentId },
      create: { appointmentId, businessId, sharingMemberId: memberId, latitude: round5(input.latitude), longitude: round5(input.longitude), accuracyMeters: input.accuracyMeters ?? null, expiresAt },
      update: { sharingMemberId: memberId, latitude: round5(input.latitude), longitude: round5(input.longitude), accuracyMeters: input.accuracyMeters ?? null, expiresAt },
    });
    return serialize(row);
  });
}

export async function updateLocationShare(businessId: string, actorUserId: string, appointmentId: string, input: UpdateLocationShareInput) {
  const now = new Date();
  return prisma.$transaction(async tx => {
    const share = await tx.appointmentLocationShare.findFirst({ where: { appointmentId, businessId } });
    if (!share) throw ApiError.conflict("Location sharing is not active for this appointment");
    if (share.expiresAt.getTime() <= now.getTime()) {
      await tx.appointmentLocationShare.deleteMany({ where: { appointmentId } });
      throw ApiError.conflict("Location sharing has expired");
    }
    const member = await tx.businessMember.findFirst({ where: { businessId, userId: actorUserId, status: "ACTIVE" }, select: { id: true } });
    if (!member || member.id !== share.sharingMemberId) throw ApiError.forbidden("Only the provider who started sharing can update the location");

    const appointment = await tx.appointment.findFirst({ where: { id: appointmentId, businessId }, select: { status: true, arrivalState: true, endsAt: true } });
    if (!appointment || ineligibleReason(appointment, now)) {
      await tx.appointmentLocationShare.deleteMany({ where: { appointmentId } });
      throw ApiError.conflict("Location sharing has ended for this appointment");
    }
    if (now.getTime() - share.updatedAt.getTime() < MIN_UPDATE_INTERVAL_MS) {
      throw ApiError.tooManyRequests("Location updates are limited to once every few seconds");
    }

    const row = await tx.appointmentLocationShare.update({
      where: { appointmentId },
      data: { latitude: round5(input.latitude), longitude: round5(input.longitude), accuracyMeters: input.accuracyMeters ?? null },
    });
    return serialize(row);
  });
}

/** Provider (or any active member) explicitly stops sharing. Idempotent. */
export async function stopLocationShare(businessId: string, appointmentId: string) {
  await prisma.appointmentLocationShare.deleteMany({ where: { appointmentId, businessId } });
  return { sharing: false as const };
}

/**
 * Deletes any share for an appointment. Called from the arrival / status
 * transitions so that Arrived / Completed / Canceled / cleared-arrival all
 * terminate sharing server-side. Safe to pass a transaction client.
 */
export async function endLocationShare(appointmentId: string, client: Prisma.TransactionClient | typeof prisma = prisma) {
  await client.appointmentLocationShare.deleteMany({ where: { appointmentId } });
}

/** Customer-facing read. Authorization is derived from the customer profile's owned appointments — never from client-supplied ids. */
export async function getProviderLocationForCustomer(customerProfileId: string, appointmentId: string) {
  const owned = await ownedAppointmentWhere(customerProfileId);
  const appointment = await prisma.appointment.findFirst({ where: { id: appointmentId, ...owned }, select: { id: true, status: true, arrivalState: true, endsAt: true } });
  if (!appointment) throw ApiError.notFound("Appointment not found");

  const now = new Date();
  const share = await prisma.appointmentLocationShare.findUnique({ where: { appointmentId } });
  if (!share) return { sharing: false as const, reason: "not_shared" };

  if (share.expiresAt.getTime() <= now.getTime() || ineligibleReason(appointment, now)) {
    await prisma.appointmentLocationShare.deleteMany({ where: { appointmentId } });
    return { sharing: false as const, reason: "ended" };
  }
  return serialize(share);
}

/** Cron sweep — removes shares past their hard expiry or on a now-closed appointment. */
export async function expireStaleLocationShares(now = new Date()) {
  const stale = await prisma.appointmentLocationShare.findMany({
    where: {
      OR: [
        { expiresAt: { lte: now } },
        { appointment: { status: { notIn: ACTIVE_STATUSES } } },
        { appointment: { arrivalState: { notIn: SHAREABLE_ARRIVAL } } },
      ],
    },
    select: { appointmentId: true },
  });
  if (!stale.length) return 0;
  const { count } = await prisma.appointmentLocationShare.deleteMany({ where: { appointmentId: { in: stale.map(s => s.appointmentId) } } });
  return count;
}
