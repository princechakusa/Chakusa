import type { AppointmentStatus, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { transitionAppointment, updateAppointment } from "../appointments/appointments.service.js";

// PROGRAM 2 LOOP 3: platform-wide booking oversight. Reads the existing
// Appointment model; manual adjustments delegate to the existing
// appointment services (serializable conflict checks, outbox events,
// activity trail all reused). RBAC + CSRF + audit live in the admin router.

function page(p = 1, size = 25) {
  const take = Math.min(100, Math.max(1, size));
  return { skip: (Math.max(1, p) - 1) * take, take, page: Math.max(1, p), pageSize: take };
}

const OPEN: AppointmentStatus[] = ["SCHEDULED", "CONFIRMED"];

const listInclude = {
  business: { select: { id: true, name: true, publicSlug: true, timezone: true } },
  customer: { select: { id: true, name: true } },
  serviceOffering: { select: { id: true, name: true } },
  assignedMember: { select: { user: { select: { fullName: true } } } },
} as const;

export async function adminListBookings(query: { businessId?: string; status?: AppointmentStatus; customerProfileId?: string; channel?: string; from?: string; to?: string; page?: number; pageSize?: number }) {
  const { skip, take, page: p, pageSize } = page(query.page, query.pageSize);
  const where: Prisma.AppointmentWhereInput = {
    ...(query.businessId ? { businessId: query.businessId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.customerProfileId ? { bookedByCustomerProfileId: query.customerProfileId } : {}),
    ...(query.channel ? { bookingChannel: query.channel } : {}),
    ...(query.from || query.to ? { startsAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.appointment.findMany({ where, include: listInclude, orderBy: { startsAt: "desc" }, skip, take }),
    prisma.appointment.count({ where }),
  ]);
  return {
    items: items.map((appointment) => ({
      id: appointment.id,
      businessId: appointment.businessId,
      businessName: appointment.business.name,
      customerName: appointment.customer?.name ?? null,
      bookedByCustomerProfileId: appointment.bookedByCustomerProfileId,
      bookingChannel: appointment.bookingChannel,
      serviceName: appointment.serviceName,
      staffName: appointment.assignedMember?.user.fullName ?? null,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      status: appointment.status,
      price: appointment.price != null ? Number(appointment.price) : null,
      paymentStatus: appointment.paymentStatus,
    })),
    total,
    page: p,
    pageSize,
  };
}

export async function adminGetBooking(id: string) {
  const appointment = await prisma.appointment.findUnique({
    where: { id },
    include: { ...listInclude, bookedByCustomer: { select: { id: true, displayName: true, user: { select: { fullName: true, email: true } } } } },
  });
  if (!appointment) throw ApiError.notFound("Booking not found");
  const auditTrail = await prisma.activityEvent.findMany({
    where: { entityType: "appointment", entityId: id },
    orderBy: { createdAt: "asc" },
    take: 100,
    select: { id: true, eventType: true, actorId: true, metadata: true, createdAt: true },
  });
  return {
    id: appointment.id,
    business: appointment.business,
    customer: appointment.customer,
    bookedByCustomer: appointment.bookedByCustomer
      ? { id: appointment.bookedByCustomer.id, name: appointment.bookedByCustomer.displayName ?? appointment.bookedByCustomer.user.fullName, email: appointment.bookedByCustomer.user.email }
      : null,
    bookingChannel: appointment.bookingChannel,
    serviceName: appointment.serviceName,
    service: appointment.serviceOffering,
    staffName: appointment.assignedMember?.user.fullName ?? null,
    startsAt: appointment.startsAt,
    endsAt: appointment.endsAt,
    status: appointment.status,
    notes: appointment.notes,
    price: appointment.price != null ? Number(appointment.price) : null,
    paidAmount: Number(appointment.paidAmount ?? 0),
    paymentStatus: appointment.paymentStatus,
    reminders: {
      reminderSentAt: appointment.reminderSentAt,
      customerReminderSentAt: appointment.customerReminderSentAt,
      sameDayReminderSentAt: appointment.sameDayReminderSentAt,
      confirmationSentAt: appointment.confirmationSentAt,
      cancellationConfirmationSentAt: appointment.cancellationConfirmationSentAt,
      rescheduleConfirmationSentAt: appointment.rescheduleConfirmationSentAt,
    },
    createdAt: appointment.createdAt,
    updatedAt: appointment.updatedAt,
    auditTrail,
  };
}

async function loadForAdjustment(id: string) {
  const appointment = await prisma.appointment.findUnique({ where: { id }, include: { business: { select: { id: true, ownerId: true } }, serviceOffering: { select: { durationMinutes: true } } } });
  if (!appointment) throw ApiError.notFound("Booking not found");
  return appointment;
}

export async function adminRescheduleBooking(actorUserId: string, id: string, input: { startsAt: string; assignedMemberId?: string | null }) {
  const appointment = await loadForAdjustment(id);
  if (!OPEN.includes(appointment.status)) throw ApiError.conflict("Only open bookings can be rescheduled");
  const duration = appointment.serviceOffering?.durationMinutes ?? Math.round((appointment.endsAt.getTime() - appointment.startsAt.getTime()) / 60_000);
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(startsAt.getTime() + duration * 60_000);
  const updated = await updateAppointment(appointment.business.id, actorUserId, id, {
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    ...(input.assignedMemberId !== undefined ? { assignedMemberId: input.assignedMemberId } : {}),
  });
  await prisma.appointment.update({ where: { id }, data: { rescheduleConfirmationSentAt: null, customerReminderSentAt: null, sameDayReminderSentAt: null } });
  return updated;
}

export async function adminSetBookingStatus(actorUserId: string, id: string, status: Extract<AppointmentStatus, "CONFIRMED" | "COMPLETED" | "CANCELED" | "NO_SHOW">) {
  const appointment = await loadForAdjustment(id);
  return transitionAppointment(appointment.business.id, actorUserId, id, status);
}

export async function adminBookingAnalytics() {
  const now = new Date();
  const in7 = new Date(now.getTime() + 7 * 86_400_000);
  const last30 = new Date(now.getTime() - 30 * 86_400_000);
  const [byStatus, upcoming7d, created30d, canceled30d, noShow30d, channels, topServices, byBusinessRaw] = await Promise.all([
    prisma.appointment.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.appointment.count({ where: { status: { in: OPEN }, startsAt: { gte: now, lte: in7 } } }),
    prisma.appointment.count({ where: { createdAt: { gte: last30 } } }),
    prisma.appointment.count({ where: { status: "CANCELED", updatedAt: { gte: last30 } } }),
    prisma.appointment.count({ where: { status: "NO_SHOW", updatedAt: { gte: last30 } } }),
    prisma.appointment.groupBy({ by: ["bookingChannel"], _count: { _all: true } }),
    prisma.appointment.groupBy({ by: ["serviceName"], _count: { _all: true }, orderBy: { _count: { serviceName: "desc" } }, take: 10 }),
    prisma.appointment.groupBy({ by: ["businessId"], _count: { _all: true }, orderBy: { _count: { businessId: "desc" } }, take: 10 }),
  ]);
  const businessIds = byBusinessRaw.map((row) => row.businessId);
  const names = businessIds.length ? await prisma.business.findMany({ where: { id: { in: businessIds } }, select: { id: true, name: true } }) : [];
  const nameBy = new Map(names.map((business) => [business.id, business.name]));
  const closed30d = created30d || 1;
  return {
    total: byStatus.reduce((sum, row) => sum + row._count._all, 0),
    byStatus: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])),
    upcomingNext7Days: upcoming7d,
    created30d,
    canceled30d,
    noShow30d,
    cancellationRate: Number((canceled30d / closed30d).toFixed(3)),
    noShowRate: Number((noShow30d / closed30d).toFixed(3)),
    byChannel: Object.fromEntries(channels.map((row) => [row.bookingChannel, row._count._all])),
    topServices: topServices.map((row) => ({ serviceName: row.serviceName, count: row._count._all })),
    byBusiness: byBusinessRaw.map((row) => ({ businessId: row.businessId, name: nameBy.get(row.businessId) ?? null, count: row._count._all })),
  };
}
