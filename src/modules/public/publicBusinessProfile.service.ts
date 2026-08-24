import { prisma } from "../../lib/prisma.js";
import { findOrCreateCustomerByPhone } from "../customers/customers.service.js";
import { createLead } from "../leads/leads.service.js";
import { LEAD_SOURCE_PUBLIC_PROFILE } from "../../lib/leadSources.js";
import type { SubmitPublicContactInput } from "./public.schemas.js";
import type { CreatePublicBookingInput, ReschedulePublicBookingInput } from "./public.schemas.js";
import type { Business } from "@prisma/client";
import { calculateAvailability } from "../availability/availability.service.js";
import { createAppointment, transitionAppointment, updateAppointment } from "../appointments/appointments.service.js";
import { generateOpaqueToken, parseOpaqueToken, tokenHashMatches } from "../../lib/authTokens.js";
import { ApiError } from "../../lib/errors.js";
import { sendAppointmentConfirmation, sendCustomerAppointmentMessage } from "../appointments/appointmentReminders.js";

/**
 * Only what a prospective customer needs to decide to reach out — never the
 * owner's id, subscription/plan, or anything else internal. Matches the
 * minimal-exposure discipline of serializeOpenOrSubmittedReview in
 * publicReviews.service.ts.
 */
export interface PublicBusinessProfile {
  name: string;
  industry: string | null;
  phone: string | null;
  description: string | null;
  googleReviewLink: string | null;
  workingHours: Record<string, unknown> | null;
  defaultServices: string[] | null;
  currency: string | null;
  services: { id: string; name: string; description: string | null; durationMinutes: number; price: number | null; depositAmount: number | null }[];
}

export async function resolvePublicBusinessProfile(slug: string): Promise<PublicBusinessProfile | null> {
  const business = await prisma.business.findFirst({ where: { publicSlug: slug, platformStatus: "ACTIVE" }, include: { serviceOfferings: { where: { active: true, publiclyBookable: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } } });
  if (!business) return null;

  return serializePublicBusinessProfile(business);
}

function serializePublicBusinessProfile(business: Business & { serviceOfferings: { id: string; name: string; description: string | null; durationMinutes: number; price: { toNumber(): number } | null; depositAmount: { toNumber(): number } | null }[] }): PublicBusinessProfile {
  return {
    name: business.name,
    industry: business.industry,
    phone: business.phone,
    description: business.description,
    googleReviewLink: business.googleReviewLink,
    workingHours: (business.workingHours as Record<string, unknown> | null) ?? null,
    defaultServices: (business.defaultServices as string[] | null) ?? null,
    currency: business.currency,
    services: business.serviceOfferings.map(service => ({ ...service, price: service.price?.toNumber() ?? null, depositAmount: service.depositAmount?.toNumber() ?? null })),
  };
}

export async function publicAvailability(slug: string, serviceOfferingId: string, from: string, to: string) {
  const business = await prisma.business.findFirst({ where: { publicSlug: slug, platformStatus: "ACTIVE" }, select: { id: true } });
  if (!business) return null;
  const service = await prisma.serviceOffering.findFirst({ where: { id: serviceOfferingId, businessId: business.id, active: true, publiclyBookable: true }, select: { id: true } });
  if (!service) throw ApiError.notFound("This service is not available for online booking");
  return calculateAvailability(business.id, { serviceOfferingId, from, to });
}

export async function createPublicBooking(slug: string, input: CreatePublicBookingInput) {
  const business = await prisma.business.findFirst({ where: { publicSlug: slug, platformStatus: "ACTIVE" }, select: { id: true, ownerId: true, name: true, defaultAppointmentReminderMinutes: true } });
  if (!business) return null;
  const offering = await prisma.serviceOffering.findFirst({ where: { id: input.serviceOfferingId, businessId: business.id, active: true, publiclyBookable: true } });
  if (!offering) throw ApiError.notFound("This service is not available for online booking");
  const endsAt = new Date(new Date(input.startsAt).getTime() + offering.durationMinutes * 60_000).toISOString();
  const customer = await findOrCreateCustomerByPhone(business.id, business.ownerId, input.phone, "FREE");
  await prisma.customer.update({ where: { id: customer.id }, data: { name: input.name, ...(input.email ? { email: input.email } : {}) } });
  const appointment = await createAppointment(business.id, business.ownerId, { customerId: customer.id, assignedMemberId: input.assignedMemberId, serviceOfferingId: offering.id, serviceName: offering.name, startsAt: input.startsAt, endsAt, notes: input.notes, reminderMinutes: business.defaultAppointmentReminderMinutes });
  const token = generateOpaqueToken();
  await prisma.publicBookingAccess.create({ data: { id: token.id, businessId: business.id, appointmentId: appointment.id, tokenHash: token.hash, expiresAt: new Date(appointment.endsAt.getTime() + 365 * 86_400_000) } });
  await sendAppointmentConfirmation(appointment.id).catch(error => console.error("[appointments] automatic booking confirmation failed", error));
  return { businessName: business.name, appointment, managementToken: token.raw };
}

export async function resolvePublicBooking(slug: string, rawToken: string) {
  const tokenId = parseOpaqueToken(rawToken); if (!tokenId) return null;
  const access = await prisma.publicBookingAccess.findFirst({ where: { id: tokenId, business: { publicSlug: slug, platformStatus: "ACTIVE" }, expiresAt: { gt: new Date() } }, include: { appointment: { include: { business: { select: { name: true, cancellationNoticeMinutes: true } }, serviceOffering: true, assignedMember: { include: { user: { select: { fullName: true } } } } } } } });
  if (!access || !tokenHashMatches(rawToken, access.tokenHash)) return null;
  return access.appointment;
}

export async function cancelPublicBooking(slug: string, rawToken: string) {
  const appointment = await resolvePublicBooking(slug, rawToken); if (!appointment) return null;
  if (!["SCHEDULED", "CONFIRMED"].includes(appointment.status)) throw ApiError.conflict("This booking can no longer be canceled");
  const cutoff = appointment.startsAt.getTime() - appointment.business.cancellationNoticeMinutes * 60_000;
  if (Date.now() > cutoff) throw ApiError.conflict("This booking is inside the cancellation window. Contact the business for help.");
  const canceled = await transitionAppointment(appointment.businessId, appointment.createdByUserId, appointment.id, "CANCELED");
  await sendCustomerAppointmentMessage(appointment.id, "canceled").catch(error => console.error("[appointments] automatic cancellation confirmation failed", error));
  return canceled;
}

export async function confirmPublicBooking(slug: string, rawToken: string) {
  const appointment = await resolvePublicBooking(slug, rawToken); if (!appointment) return null;
  if (appointment.status === "CONFIRMED") return appointment;
  if (appointment.status !== "SCHEDULED") throw ApiError.conflict("This booking can no longer be confirmed");
  return transitionAppointment(appointment.businessId, appointment.createdByUserId, appointment.id, "CONFIRMED");
}

export async function reschedulePublicBooking(slug: string, rawToken: string, input: ReschedulePublicBookingInput) {
  const appointment = await resolvePublicBooking(slug, rawToken); if (!appointment) return null;
  if (!["SCHEDULED", "CONFIRMED"].includes(appointment.status)) throw ApiError.conflict("This booking can no longer be rescheduled");
  if (!appointment.serviceOffering) throw ApiError.conflict("Contact the business to reschedule this appointment");
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(startsAt.getTime() + appointment.serviceOffering.durationMinutes * 60_000);
  const updated = await updateAppointment(appointment.businessId, appointment.createdByUserId, appointment.id, { assignedMemberId: input.assignedMemberId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() });
  await prisma.appointment.update({ where: { id: appointment.id }, data: { rescheduleConfirmationSentAt: null, customerReminderSentAt: null, sameDayReminderSentAt: null } });
  await sendCustomerAppointmentMessage(appointment.id, "rescheduled").catch(error => console.error("[appointments] automatic reschedule confirmation failed", error));
  return updated;
}

function icsEscape(value: string) { return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;"); }
function icsDate(value: Date) { return value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"); }
export async function publicBookingCalendar(slug: string, rawToken: string) {
  const appointment = await resolvePublicBooking(slug, rawToken); if (!appointment) return null;
  const staff = appointment.assignedMember?.user.fullName ? ` with ${appointment.assignedMember.user.fullName}` : "";
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Chakusa//Booking//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VEVENT", `UID:${appointment.id}@chakusa.com`, `DTSTAMP:${icsDate(new Date())}`, `DTSTART:${icsDate(appointment.startsAt)}`, `DTEND:${icsDate(appointment.endsAt)}`, `SUMMARY:${icsEscape(`${appointment.serviceName} — ${appointment.business.name}`)}`, `DESCRIPTION:${icsEscape(`Appointment at ${appointment.business.name}${staff}`)}`, `STATUS:${appointment.status === "CANCELED" ? "CANCELLED" : "CONFIRMED"}`, "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
}

/**
 * A public profile has no authenticated request, so — unlike every
 * authenticated lead-creation path — there is no request.plan/request.actor
 * to reuse. Plan/status are resolved the same defensive way
 * tenant.ts's requireBusiness does for an authenticated request (missing
 * Subscription row defaults to FREE/ACTIVE, the least-privilege fallback).
 * actorId is the business owner: a real User row is required by
 * recordActivity's/createLead's foreign key, and attributing a
 * customer-initiated public submission to the business's own owner is the
 * same convention this codebase already uses for other system-attributed
 * writes with no human actor (see markPublicReviewOpened's actorId: null,
 * which activity events support but createLead's actorId does not).
 */
export async function submitPublicContactForm(
  slug: string,
  input: SubmitPublicContactInput,
): Promise<{ businessName: string } | null> {
  const business = await prisma.business.findFirst({ where: { publicSlug: slug, platformStatus: "ACTIVE" } });
  if (!business) return null;

  const subscription = await prisma.subscription.findUnique({
    where: { businessId: business.id },
    select: { plan: true },
  });
  const plan = subscription?.plan ?? "FREE";

  const customer = await findOrCreateCustomerByPhone(business.id, business.ownerId, input.phone, plan);
  if (customer.created) {
    await prisma.customer.update({ where: { id: customer.id }, data: { name: input.name } });
  }

  // Silently ignored rather than validated/rejected: a stale or tampered
  // ?ref= value must never block a legitimate submission (see
  // submitPublicContactSchema's doc comment). Also guards against
  // attributing to the customer that was just created above from a
  // self-share (a customer can't "refer" themselves).
  const referrer = input.ref && input.ref !== customer.id
    ? await prisma.customer.findFirst({ where: { id: input.ref, businessId: business.id }, select: { id: true } })
    : null;

  await createLead(business.id, business.ownerId, {
    customerId: customer.id,
    source: LEAD_SOURCE_PUBLIC_PROFILE,
    serviceRequested: input.serviceRequested,
    urgency: "medium",
    notes: input.message,
    referredByCustomerId: referrer?.id,
  }, plan);

  return { businessName: business.name };
}
