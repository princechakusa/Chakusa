import type { AppointmentStatus } from "@prisma/client";
import { ApiError } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { WEEKDAYS, fitsWorkingHours, parseWorkingHours, zonedParts } from "../../lib/workingHours.js";
import { updateAppointment } from "../appointments/appointments.service.js";
import type { DispatchAssignInput } from "./dispatch.schemas.js";

const activeStatuses: AppointmentStatus[] = ["SCHEDULED", "CONFIRMED"];
const countsTowardLoad: AppointmentStatus[] = ["SCHEDULED", "CONFIRMED", "COMPLETED"];
const overlaps = (startA: Date, endA: Date, startB: Date, endB: Date) => startA < endB && endA > startB;
const addMinutes = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60_000);
const minutesBetween = (start: Date, end: Date) => Math.round((end.getTime() - start.getTime()) / 60_000);

/**
 * Read model for the dispatch board: for one calendar day, every active team
 * member with their appointments, booked minutes and blocked time, plus the
 * appointments that have no one assigned. Purely derived from existing
 * appointments / booking blocks / working hours — no new stored state, no GPS.
 */
export async function getDispatchBoard(businessId: string, date: string) {
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { timezone: true, workingHours: true } });
  if (!business) throw ApiError.notFound("Business not found");
  const timezone = business.timezone || "UTC";
  const anchor = new Date(`${date}T00:00:00.000Z`).getTime();
  // Wide UTC window around the local day; each row is then kept only if its
  // local calendar date matches, which sidesteps timezone-boundary math.
  const windowFrom = new Date(anchor - 14 * 3_600_000);
  const windowTo = new Date(anchor + 38 * 3_600_000);
  const weekday = WEEKDAYS[new Date(`${date}T12:00:00.000Z`).getUTCDay()]!;

  const [members, appointments, blocks] = await Promise.all([
    prisma.businessMember.findMany({ where: { businessId, status: "ACTIVE" }, select: { id: true, workingHours: true, user: { select: { fullName: true } } }, orderBy: { createdAt: "asc" } }),
    prisma.appointment.findMany({
      where: { businessId, startsAt: { lt: windowTo }, endsAt: { gt: windowFrom }, status: { not: "CANCELED" } },
      select: { id: true, assignedMemberId: true, serviceName: true, startsAt: true, endsAt: true, status: true, arrivalState: true, customer: { select: { name: true } } },
      orderBy: { startsAt: "asc" },
    }),
    prisma.bookingBlock.findMany({ where: { businessId, startsAt: { lt: windowTo }, endsAt: { gt: windowFrom } }, select: { id: true, assignedMemberId: true, reason: true, startsAt: true, endsAt: true }, orderBy: { startsAt: "asc" } }),
  ]);

  const onDay = appointments.filter(a => zonedParts(a.startsAt, timezone).date === date);
  const blocksOnDay = blocks.filter(b => zonedParts(b.startsAt, timezone).date === date);

  const shape = (a: (typeof onDay)[number]) => ({ id: a.id, serviceName: a.serviceName, customerName: a.customer?.name ?? null, startsAt: a.startsAt.toISOString(), endsAt: a.endsAt.toISOString(), status: a.status, arrivalState: a.arrivalState, durationMinutes: minutesBetween(a.startsAt, a.endsAt) });

  const memberRows = members.map(member => {
    const hours = parseWorkingHours(member.workingHours ?? business.workingHours);
    const mine = onDay.filter(a => a.assignedMemberId === member.id);
    const bookedMinutes = mine.filter(a => countsTowardLoad.includes(a.status)).reduce((sum, a) => sum + minutesBetween(a.startsAt, a.endsAt), 0);
    return {
      id: member.id,
      name: member.user.fullName,
      onDuty: Boolean(hours[weekday]?.enabled),
      workingHours: hours[weekday] ?? null,
      appointments: mine.map(shape),
      bookedMinutes,
      blocks: blocksOnDay.filter(b => b.assignedMemberId === member.id || b.assignedMemberId === null).map(b => ({ id: b.id, reason: b.reason ?? null, startsAt: b.startsAt.toISOString(), endsAt: b.endsAt.toISOString(), businessWide: b.assignedMemberId === null })),
    };
  });

  return {
    date,
    timezone,
    members: memberRows,
    unassigned: onDay.filter(a => !a.assignedMemberId).map(shape),
  };
}

export async function assignDispatch(businessId: string, actorId: string, input: DispatchAssignInput) {
  // Reuses the appointment update path, which locks the member's schedule and
  // rejects a move that would overlap another booking or a blocked window.
  return updateAppointment(businessId, actorId, input.appointmentId, { assignedMemberId: input.memberId });
}

/**
 * Active members who could take this appointment: they can provide the service
 * (when the offering restricts assignees), the slot fits their working hours,
 * and nothing they already have overlaps it.
 */
export async function getDispatchCandidates(businessId: string, appointmentId: string) {
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, businessId },
    select: { id: true, startsAt: true, endsAt: true, assignedMemberId: true, status: true, serviceOffering: { select: { preparationMinutes: true, cleanupMinutes: true, assignments: { select: { businessMemberId: true } } } } },
  });
  if (!appointment) throw ApiError.notFound("Appointment not found");
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { timezone: true, workingHours: true } });
  if (!business) throw ApiError.notFound("Business not found");
  const timezone = business.timezone || "UTC";

  const prep = appointment.serviceOffering?.preparationMinutes ?? 0;
  const cleanup = appointment.serviceOffering?.cleanupMinutes ?? 0;
  const occupiedFrom = addMinutes(appointment.startsAt, -prep);
  const occupiedTo = addMinutes(appointment.endsAt, cleanup);

  const eligibleIds = appointment.serviceOffering?.assignments.map(a => a.businessMemberId) ?? [];
  const members = await prisma.businessMember.findMany({
    where: { businessId, status: "ACTIVE", ...(eligibleIds.length ? { id: { in: eligibleIds } } : {}) },
    select: { id: true, workingHours: true, user: { select: { fullName: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (!members.length) return [];

  const [others, blocks] = await Promise.all([
    prisma.appointment.findMany({ where: { businessId, id: { not: appointment.id }, assignedMemberId: { in: members.map(m => m.id) }, status: { in: activeStatuses }, startsAt: { lt: occupiedTo }, endsAt: { gt: occupiedFrom } }, select: { assignedMemberId: true, startsAt: true, endsAt: true, serviceOffering: { select: { preparationMinutes: true, cleanupMinutes: true } } } }),
    prisma.bookingBlock.findMany({ where: { businessId, startsAt: { lt: occupiedTo }, endsAt: { gt: occupiedFrom }, OR: [{ assignedMemberId: null }, { assignedMemberId: { in: members.map(m => m.id) } }] }, select: { assignedMemberId: true, startsAt: true, endsAt: true } }),
  ]);

  return members.map(member => {
    const hours = parseWorkingHours(member.workingHours ?? business.workingHours);
    const withinHours = fitsWorkingHours(occupiedFrom, occupiedTo, timezone, hours);
    const appointmentConflict = others.some(o => o.assignedMemberId === member.id && overlaps(occupiedFrom, occupiedTo, addMinutes(o.startsAt, -(o.serviceOffering?.preparationMinutes ?? 0)), addMinutes(o.endsAt, o.serviceOffering?.cleanupMinutes ?? 0)));
    const blockConflict = blocks.some(b => (b.assignedMemberId === null || b.assignedMemberId === member.id) && overlaps(occupiedFrom, occupiedTo, b.startsAt, b.endsAt));
    return {
      id: member.id,
      name: member.user.fullName,
      available: withinHours && !appointmentConflict && !blockConflict,
      withinHours,
      hasConflict: appointmentConflict || blockConflict,
      isCurrent: appointment.assignedMemberId === member.id,
    };
  });
}
