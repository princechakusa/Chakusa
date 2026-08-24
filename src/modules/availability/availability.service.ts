import { Prisma, type AppointmentStatus } from "@prisma/client";
import { ApiError } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { fitsWorkingHours, parseWorkingHours, zonedParts } from "../../lib/workingHours.js";
import type { AvailabilityQuery, CreateBookingBlockInput } from "./availability.schemas.js";

const activeAppointmentStatuses: AppointmentStatus[] = ["SCHEDULED", "CONFIRMED"];
const overlaps = (startA: Date, endA: Date, startB: Date, endB: Date) => startA < endB && endA > startB;
const addMinutes = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60_000);

export async function calculateAvailability(businessId: string, input: AvailabilityQuery, now = new Date()) {
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { timezone: true, workingHours: true, bookingMinNoticeMinutes: true, bookingWindowDays: true, slotIntervalMinutes: true } });
  if (!business) throw ApiError.notFound("Business not found");
  const service = await prisma.serviceOffering.findFirst({ where: { id: input.serviceOfferingId, businessId, active: true }, include: { assignments: true } });
  if (!service) throw ApiError.notFound("Service not found");
  const eligibleIds = service.assignments.map(assignment => assignment.businessMemberId);
  const members = await prisma.businessMember.findMany({ where: { businessId, status: "ACTIVE", ...(eligibleIds.length ? { id: { in: eligibleIds } } : {}), ...(input.memberId ? { id: input.memberId } : {}) }, select: { id: true, workingHours: true, user: { select: { fullName: true } } }, orderBy: { createdAt: "asc" } });
  if (input.memberId && !members.length) throw ApiError.badRequest("This team member cannot provide the selected service");
  const timezone = business.timezone || "UTC";
  const requestedFrom = new Date(input.from); const requestedTo = new Date(input.to);
  const earliest = new Date(Math.max(requestedFrom.getTime(), addMinutes(now, business.bookingMinNoticeMinutes).getTime()));
  const latest = new Date(Math.min(requestedTo.getTime(), addMinutes(now, business.bookingWindowDays * 1_440).getTime()));
  if (latest <= earliest || !members.length) return [];
  const buffer = service.preparationMinutes + service.durationMinutes + service.cleanupMinutes;
  const queryFrom = addMinutes(earliest, -service.preparationMinutes - 1); const queryTo = addMinutes(latest, buffer + 1);
  const [appointments, blocks] = await Promise.all([
    prisma.appointment.findMany({ where: { businessId, assignedMemberId: { in: members.map(member => member.id) }, status: { in: activeAppointmentStatuses }, startsAt: { lt: queryTo }, endsAt: { gt: queryFrom } }, select: { assignedMemberId: true, startsAt: true, endsAt: true, serviceOffering: { select: { preparationMinutes: true, cleanupMinutes: true } } } }),
    prisma.bookingBlock.findMany({ where: { businessId, startsAt: { lt: queryTo }, endsAt: { gt: queryFrom }, OR: [{ assignedMemberId: null }, { assignedMemberId: { in: members.map(member => member.id) } }] }, select: { assignedMemberId: true, startsAt: true, endsAt: true } }),
  ]);
  const slots = new Map<string, { startsAt: string; endsAt: string; members: { id: string; name: string }[] }>();
  const step = business.slotIntervalMinutes * 60_000; let cursor = new Date(Math.ceil(earliest.getTime() / step) * step);
  for (; cursor < latest; cursor = new Date(cursor.getTime() + step)) {
    const local = zonedParts(cursor, timezone); if (local.minute % business.slotIntervalMinutes !== 0) continue;
    const startsAt = new Date(cursor); const endsAt = addMinutes(startsAt, service.durationMinutes); const occupiedFrom = addMinutes(startsAt, -service.preparationMinutes); const occupiedTo = addMinutes(endsAt, service.cleanupMinutes);
    if (endsAt > latest) continue;
    const availableMembers = members.filter(member => {
      const hours = parseWorkingHours(member.workingHours ?? business.workingHours);
      if (!fitsWorkingHours(occupiedFrom, occupiedTo, timezone, hours)) return false;
      const appointmentConflict = appointments.some(appointment => appointment.assignedMemberId === member.id && overlaps(occupiedFrom, occupiedTo, addMinutes(appointment.startsAt, -(appointment.serviceOffering?.preparationMinutes ?? 0)), addMinutes(appointment.endsAt, appointment.serviceOffering?.cleanupMinutes ?? 0)));
      const blockConflict = blocks.some(block => (block.assignedMemberId === null || block.assignedMemberId === member.id) && overlaps(occupiedFrom, occupiedTo, block.startsAt, block.endsAt));
      return !appointmentConflict && !blockConflict;
    }).map(member => ({ id: member.id, name: member.user.fullName }));
    if (availableMembers.length) slots.set(startsAt.toISOString(), { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), members: availableMembers });
  }
  return [...slots.values()];
}

async function validateMember(tx: Prisma.TransactionClient, businessId: string, memberId?: string | null) {
  if (memberId && !await tx.businessMember.findFirst({ where: { id: memberId, businessId, status: "ACTIVE" }, select: { id: true } })) throw ApiError.badRequest("assignedMemberId must be active in this business");
}
export function listBookingBlocks(businessId: string, from: string, to: string) { return prisma.bookingBlock.findMany({ where: { businessId, startsAt: { lt: new Date(to) }, endsAt: { gt: new Date(from) } }, orderBy: { startsAt: "asc" } }); }
export async function createBookingBlock(businessId: string, actorId: string, input: CreateBookingBlockInput) { return prisma.$transaction(async tx => { await validateMember(tx, businessId, input.assignedMemberId); return tx.bookingBlock.create({ data: { businessId, createdByUserId: actorId, ...input } }); }); }
export async function deleteBookingBlock(businessId: string, id: string) { const deleted = await prisma.bookingBlock.deleteMany({ where: { id, businessId } }); if (!deleted.count) throw ApiError.notFound("Blocked time not found"); }
export async function updateMemberWorkingHours(businessId: string, memberId: string, workingHours: Record<string, unknown> | null) { const member = await prisma.businessMember.findFirst({ where: { id: memberId, businessId } }); if (!member) throw ApiError.notFound("Team member not found"); return prisma.businessMember.update({ where: { id: memberId }, data: { workingHours: workingHours === null ? Prisma.JsonNull : workingHours as Prisma.InputJsonValue } }); }
