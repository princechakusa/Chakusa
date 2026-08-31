import type { AppointmentStatus } from "@prisma/client";
import { prisma } from "../prisma.js";
import { ApiError } from "../errors.js";
import { calculateAvailability } from "../../modules/availability/availability.service.js";
import { createAppointment, transitionAppointment, updateAppointment } from "../../modules/appointments/appointments.service.js";
import { sendAppointmentConfirmation, sendCustomerAppointmentMessage } from "../../modules/appointments/appointmentReminders.js";
import { findOrCreateCustomerByPhone } from "../../modules/customers/customers.service.js";
import { linkCustomerToBusiness, recordCustomerActivity, findMatchingBusinessCustomers } from "../customer/customerContext.js";
import { notifyCustomer } from "../customer/customerNotifications.js";

// PROGRAM 2 LOOP 3: the authenticated-customer booking experience. Every
// scheduling decision, conflict check, outbox event and reminder is the
// EXISTING appointment/availability infrastructure — this module only
// resolves the customer <-> business contact link, records provenance
// (`bookedByCustomerProfileId` / `bookingChannel`), and fans out the
// customer-side notification + activity. No appointment model, no
// availability logic and no messaging channel is duplicated here.

const OPEN_STATUSES: AppointmentStatus[] = ["SCHEDULED", "CONFIRMED"];

async function resolveBookableBusiness(slug: string) {
  const business = await prisma.business.findFirst({
    where: { publicSlug: slug, platformStatus: "ACTIVE" },
    select: {
      id: true, ownerId: true, name: true, timezone: true, currency: true,
      cancellationNoticeMinutes: true, defaultAppointmentReminderMinutes: true,
      marketplaceListing: { select: { listed: true, discoverable: true } },
      subscription: { select: { plan: true } },
    },
  });
  if (!business) throw ApiError.notFound("Business not found");
  const listing = business.marketplaceListing;
  if (listing && (!listing.listed || !listing.discoverable)) throw ApiError.notFound("Business not found");
  return business;
}

export async function listBookableServices(slug: string) {
  const business = await resolveBookableBusiness(slug);
  const services = await prisma.serviceOffering.findMany({
    where: { businessId: business.id, active: true, publiclyBookable: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, description: true, category: true, durationMinutes: true, price: true, depositAmount: true },
  });
  return {
    businessName: business.name,
    currency: business.currency,
    services: services.map((service) => ({
      id: service.id,
      name: service.name,
      description: service.description,
      category: service.category,
      durationMinutes: service.durationMinutes,
      price: service.price ? Number(service.price) : null,
      depositAmount: service.depositAmount ? Number(service.depositAmount) : null,
    })),
  };
}

export async function getBookingAvailability(slug: string, input: { serviceOfferingId: string; from: string; to: string; memberId?: string }) {
  const business = await resolveBookableBusiness(slug);
  const service = await prisma.serviceOffering.findFirst({
    where: { id: input.serviceOfferingId, businessId: business.id, active: true, publiclyBookable: true },
    select: { id: true },
  });
  if (!service) throw ApiError.notFound("This service is not available for online booking");
  const slots = await calculateAvailability(business.id, { serviceOfferingId: input.serviceOfferingId, from: input.from, to: input.to, memberId: input.memberId });
  return { timezone: business.timezone || "UTC", slots };
}

/**
 * Resolves the business-scoped `Customer` contact row for this profile,
 * creating and linking one when the profile has no link yet. This is the
 * row every downstream system (appointments, conversations, AI memory) is
 * already keyed on — see the schema comment on CustomerBusinessLink.
 */
async function ensureBusinessCustomer(customerProfileId: string, business: { id: string; ownerId: string; subscription: { plan: string } | null }) {
  const link = await prisma.customerBusinessLink.findUnique({
    where: { customerProfileId_businessId: { customerProfileId, businessId: business.id } },
    select: { businessCustomerId: true },
  });
  if (link?.businessCustomerId) return link.businessCustomerId;

  const plan = (business.subscription?.plan ?? "FREE") as never;
  const profile = await prisma.customerProfile.findUniqueOrThrow({
    where: { id: customerProfileId },
    select: { displayName: true, phone: true, phoneE164: true, user: { select: { fullName: true, email: true } } },
  });

  // Prefer a contact row this business already has for the customer.
  const matches = await findMatchingBusinessCustomers(customerProfileId);
  let businessCustomerId = matches.find((match) => match.businessId === business.id)?.id ?? null;

  if (!businessCustomerId && (profile.phoneE164 || profile.phone)) {
    const resolved = await findOrCreateCustomerByPhone(business.id, business.ownerId, profile.phoneE164 ?? profile.phone!, plan);
    businessCustomerId = resolved.id;
    await prisma.customer.update({ where: { id: businessCustomerId }, data: { name: profile.displayName ?? profile.user.fullName, email: profile.user.email ?? undefined } });
  }
  if (!businessCustomerId) {
    const created = await prisma.customer.create({
      data: { businessId: business.id, name: profile.displayName ?? profile.user.fullName, email: profile.user.email ?? null, phone: profile.phone, phoneE164: profile.phoneE164 },
      select: { id: true },
    });
    businessCustomerId = created.id;
  }

  await linkCustomerToBusiness({ customerProfileId, businessId: business.id, businessCustomerId });
  return businessCustomerId;
}

function receiptFor(appointment: { id: string; serviceName: string; startsAt: Date; endsAt: Date; status: string; price: unknown; depositAmount: unknown }, businessName: string, currency: string | null, staffName: string | null) {
  return {
    reference: appointment.id.slice(0, 8).toUpperCase(),
    businessName,
    service: appointment.serviceName,
    staff: staffName,
    startsAt: appointment.startsAt,
    endsAt: appointment.endsAt,
    status: appointment.status,
    price: appointment.price != null ? Number(appointment.price) : null,
    depositAmount: appointment.depositAmount != null ? Number(appointment.depositAmount) : null,
    currency,
  };
}

export async function createCustomerBooking(customerProfileId: string, input: { slug: string; serviceOfferingId: string; assignedMemberId?: string; startsAt: string; notes?: string }) {
  const business = await resolveBookableBusiness(input.slug);
  const service = await prisma.serviceOffering.findFirst({
    where: { id: input.serviceOfferingId, businessId: business.id, active: true, publiclyBookable: true },
    select: { id: true, name: true, durationMinutes: true },
  });
  if (!service) throw ApiError.notFound("This service is not available for online booking");

  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60_000);

  // Auto-assign the first free eligible member when the customer did not pick one.
  let memberId = input.assignedMemberId ?? null;
  if (!memberId) {
    // Window must span at least one full service duration or calculateAvailability emits no slot.
    const slots = await calculateAvailability(business.id, { serviceOfferingId: service.id, from: startsAt.toISOString(), to: new Date(endsAt.getTime() + 60_000).toISOString() });
    const slot = slots.find((entry) => new Date(entry.startsAt).getTime() === startsAt.getTime());
    const firstMember = slot?.members[0];
    if (!firstMember) throw ApiError.conflict("That time is no longer available");
    memberId = firstMember.id;
  }

  const businessCustomerId = await ensureBusinessCustomer(customerProfileId, business);

  const appointment = await createAppointment(business.id, business.ownerId, {
    customerId: businessCustomerId,
    assignedMemberId: memberId,
    serviceOfferingId: service.id,
    serviceName: service.name,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    notes: input.notes,
    reminderMinutes: business.defaultAppointmentReminderMinutes,
  });

  const [enriched] = await Promise.all([
    prisma.appointment.update({
      where: { id: appointment.id },
      data: { bookedByCustomerProfileId: customerProfileId, bookingChannel: "customer_app" },
      include: { assignedMember: { select: { user: { select: { fullName: true } } } } },
    }),
    linkCustomerToBusiness({ customerProfileId, businessId: business.id, businessCustomerId }),
    recordCustomerActivity({ customerProfileId, businessId: business.id, type: "BOOKING_CREATED", entityType: "appointment", entityId: appointment.id, metadata: { serviceName: service.name, startsAt: startsAt.toISOString() } }),
  ]);

  await notifyCustomer({
    customerProfileId,
    category: "booking_update",
    title: "Booking confirmed",
    body: `${service.name} at ${business.name} on ${new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: business.timezone || "UTC" }).format(startsAt)}.`,
    businessId: business.id,
    data: { appointmentId: appointment.id },
  }).catch(() => undefined);
  await sendAppointmentConfirmation(appointment.id).catch(() => undefined);

  return {
    appointment: enriched,
    receipt: receiptFor(enriched, business.name, business.currency, enriched.assignedMember?.user.fullName ?? null),
  };
}

/** Appointments this profile can see: ones it booked, plus any on its linked business-customer rows. */
async function ownedAppointmentWhere(customerProfileId: string) {
  const links = await prisma.customerBusinessLink.findMany({
    where: { customerProfileId, businessCustomerId: { not: null } },
    select: { businessCustomerId: true },
  });
  const customerIds = links.map((link) => link.businessCustomerId!).filter(Boolean);
  return { OR: [{ bookedByCustomerProfileId: customerProfileId }, ...(customerIds.length ? [{ customerId: { in: customerIds } }] : [])] };
}

const bookingInclude = {
  business: { select: { id: true, name: true, publicSlug: true, timezone: true, currency: true, phone: true, cancellationNoticeMinutes: true } },
  serviceOffering: { select: { id: true, name: true, durationMinutes: true, category: true } },
  assignedMember: { select: { user: { select: { fullName: true } } } },
} as const;

function serializeBooking(appointment: {
  id: string; serviceName: string; startsAt: Date; endsAt: Date; status: string; notes: string | null;
  price: unknown; paidAmount: unknown; paymentStatus: string; reminderMinutes: number | null;
  customerReminderSentAt: Date | null; sameDayReminderSentAt: Date | null; bookingChannel: string;
  business: { id: string; name: string; publicSlug: string | null; timezone: string | null; currency: string | null; phone: string | null; cancellationNoticeMinutes: number };
  serviceOffering: { id: string; name: string; durationMinutes: number; category: string | null } | null;
  assignedMember: { user: { fullName: string } } | null;
}) {
  const cancelCutoff = new Date(appointment.startsAt.getTime() - appointment.business.cancellationNoticeMinutes * 60_000);
  const open = OPEN_STATUSES.includes(appointment.status as AppointmentStatus);
  return {
    id: appointment.id,
    status: appointment.status,
    serviceName: appointment.serviceName,
    serviceId: appointment.serviceOffering?.id ?? null,
    category: appointment.serviceOffering?.category ?? null,
    startsAt: appointment.startsAt,
    endsAt: appointment.endsAt,
    notes: appointment.notes,
    staffName: appointment.assignedMember?.user.fullName ?? null,
    price: appointment.price != null ? Number(appointment.price) : null,
    paidAmount: Number(appointment.paidAmount ?? 0),
    paymentStatus: appointment.paymentStatus,
    bookingChannel: appointment.bookingChannel,
    reminder: {
      minutesBefore: appointment.reminderMinutes,
      reminderSent: Boolean(appointment.customerReminderSentAt),
      sameDayReminderSent: Boolean(appointment.sameDayReminderSentAt),
    },
    canReschedule: open && Date.now() < cancelCutoff.getTime(),
    canCancel: open && Date.now() < cancelCutoff.getTime(),
    cancellationCutoff: cancelCutoff,
    business: {
      id: appointment.business.id,
      name: appointment.business.name,
      slug: appointment.business.publicSlug,
      timezone: appointment.business.timezone,
      currency: appointment.business.currency,
      phone: appointment.business.phone,
    },
  };
}

const CLOSED_STATUSES: AppointmentStatus[] = ["COMPLETED", "CANCELED", "NO_SHOW"];

export async function listCustomerBookings(customerProfileId: string, scope: "upcoming" | "past" | "all" = "all") {
  const base = await ownedAppointmentWhere(customerProfileId);
  const now = new Date();
  const conditions: Array<Record<string, unknown>> = [base];
  if (scope === "upcoming") conditions.push({ startsAt: { gte: now }, status: { in: OPEN_STATUSES } });
  if (scope === "past") conditions.push({ OR: [{ startsAt: { lt: now } }, { status: { in: CLOSED_STATUSES } }] });
  const rows = await prisma.appointment.findMany({
    where: { AND: conditions },
    include: bookingInclude,
    orderBy: { startsAt: scope === "past" ? "desc" : "asc" },
    take: 200,
  });
  return rows.map(serializeBooking);
}

export async function getCustomerBooking(customerProfileId: string, id: string) {
  const base = await ownedAppointmentWhere(customerProfileId);
  const appointment = await prisma.appointment.findFirst({ where: { id, ...base }, include: bookingInclude });
  if (!appointment) throw ApiError.notFound("Booking not found");
  return serializeBooking(appointment);
}

async function loadOwnedOpenBooking(customerProfileId: string, id: string) {
  const base = await ownedAppointmentWhere(customerProfileId);
  const appointment = await prisma.appointment.findFirst({
    where: { id, ...base },
    include: { business: { select: { id: true, ownerId: true, cancellationNoticeMinutes: true, timezone: true } }, serviceOffering: { select: { durationMinutes: true } } },
  });
  if (!appointment) throw ApiError.notFound("Booking not found");
  if (!OPEN_STATUSES.includes(appointment.status)) throw ApiError.conflict("This booking can no longer be changed");
  return appointment;
}

export async function rescheduleCustomerBooking(customerProfileId: string, id: string, input: { startsAt: string; assignedMemberId?: string }) {
  const appointment = await loadOwnedOpenBooking(customerProfileId, id);
  if (!appointment.serviceOffering) throw ApiError.conflict("Contact the business to reschedule this appointment");
  const cutoff = appointment.startsAt.getTime() - appointment.business.cancellationNoticeMinutes * 60_000;
  if (Date.now() > cutoff) throw ApiError.conflict("This booking is inside the change window. Contact the business for help.");

  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(startsAt.getTime() + appointment.serviceOffering.durationMinutes * 60_000);
  await updateAppointment(appointment.business.id, appointment.business.ownerId, id, {
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    ...(input.assignedMemberId ? { assignedMemberId: input.assignedMemberId } : {}),
  });
  await prisma.appointment.update({ where: { id }, data: { rescheduleConfirmationSentAt: null, customerReminderSentAt: null, sameDayReminderSentAt: null } });
  await recordCustomerActivity({ customerProfileId, businessId: appointment.business.id, type: "BOOKING_RESCHEDULED", entityType: "appointment", entityId: id, metadata: { startsAt: startsAt.toISOString() } });
  await notifyCustomer({ customerProfileId, category: "booking_update", title: "Booking rescheduled", body: `Your appointment was moved to ${new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: appointment.business.timezone || "UTC" }).format(startsAt)}.`, businessId: appointment.business.id, data: { appointmentId: id } }).catch(() => undefined);
  await sendCustomerAppointmentMessage(id, "rescheduled").catch(() => undefined);
  return getCustomerBooking(customerProfileId, id);
}

export async function cancelCustomerBooking(customerProfileId: string, id: string) {
  const appointment = await loadOwnedOpenBooking(customerProfileId, id);
  const cutoff = appointment.startsAt.getTime() - appointment.business.cancellationNoticeMinutes * 60_000;
  if (Date.now() > cutoff) throw ApiError.conflict("This booking is inside the cancellation window. Contact the business for help.");

  await transitionAppointment(appointment.business.id, appointment.business.ownerId, id, "CANCELED");
  await recordCustomerActivity({ customerProfileId, businessId: appointment.business.id, type: "BOOKING_CANCELED", entityType: "appointment", entityId: id });
  await notifyCustomer({ customerProfileId, category: "booking_update", title: "Booking canceled", body: "Your appointment has been canceled.", businessId: appointment.business.id, data: { appointmentId: id } }).catch(() => undefined);
  await sendCustomerAppointmentMessage(id, "canceled").catch(() => undefined);
  return getCustomerBooking(customerProfileId, id);
}

function icsEscape(value: string) { return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;"); }
function icsDate(value: Date) { return value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"); }

export async function customerBookingIcs(customerProfileId: string, id: string) {
  const base = await ownedAppointmentWhere(customerProfileId);
  const appointment = await prisma.appointment.findFirst({ where: { id, ...base }, include: { business: { select: { name: true } }, assignedMember: { select: { user: { select: { fullName: true } } } } } });
  if (!appointment) throw ApiError.notFound("Booking not found");
  const staff = appointment.assignedMember?.user.fullName ? ` with ${appointment.assignedMember.user.fullName}` : "";
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Chakusa//Customer Booking//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT", `UID:${appointment.id}@chakusa.com`, `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(appointment.startsAt)}`, `DTEND:${icsDate(appointment.endsAt)}`,
    `SUMMARY:${icsEscape(`${appointment.serviceName} — ${appointment.business.name}`)}`,
    `DESCRIPTION:${icsEscape(`Appointment at ${appointment.business.name}${staff}`)}`,
    `STATUS:${appointment.status === "CANCELED" ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT", "END:VCALENDAR", "",
  ].join("\r\n");
}

// --- AI booking context (reads only; the LOOP 3 AI Platform is unchanged) ---

export async function customerBookingAIContext(customerProfileId: string) {
  const base = await ownedAppointmentWhere(customerProfileId);
  const now = new Date();
  const [upcoming, history] = await Promise.all([
    prisma.appointment.findMany({ where: { ...base, startsAt: { gte: now }, status: { in: OPEN_STATUSES } }, include: bookingInclude, orderBy: { startsAt: "asc" }, take: 10 }),
    prisma.appointment.findMany({ where: { ...base, status: "COMPLETED" }, include: bookingInclude, orderBy: { startsAt: "desc" }, take: 40 }),
  ]);

  const byService = new Map<string, { serviceName: string; businessName: string; slug: string | null; count: number; lastVisit: Date; gaps: number[] }>();
  for (const appointment of history) {
    const key = `${appointment.business.id}:${appointment.serviceName.toLowerCase()}`;
    const entry = byService.get(key);
    if (!entry) {
      byService.set(key, { serviceName: appointment.serviceName, businessName: appointment.business.name, slug: appointment.business.publicSlug, count: 1, lastVisit: appointment.startsAt, gaps: [] });
    } else {
      entry.gaps.push(Math.abs(entry.lastVisit.getTime() - appointment.startsAt.getTime()) / 86_400_000);
      entry.count += 1;
      if (appointment.startsAt > entry.lastVisit) entry.lastVisit = appointment.startsAt;
    }
  }

  const recommendations = [...byService.values()]
    .filter((entry) => entry.count >= 2)
    .map((entry) => {
      const avgGap = entry.gaps.length ? entry.gaps.reduce((sum, gap) => sum + gap, 0) / entry.gaps.length : null;
      const daysSince = (now.getTime() - entry.lastVisit.getTime()) / 86_400_000;
      return {
        serviceName: entry.serviceName,
        businessName: entry.businessName,
        slug: entry.slug,
        visits: entry.count,
        typicalIntervalDays: avgGap ? Math.round(avgGap) : null,
        daysSinceLast: Math.round(daysSince),
        due: avgGap != null && daysSince >= avgGap * 0.9,
      };
    })
    .sort((a, b) => Number(b.due) - Number(a.due) || b.visits - a.visits);

  return {
    upcoming: upcoming.map(serializeBooking),
    historyCount: history.length,
    recommendations,
  };
}
