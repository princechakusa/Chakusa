import { prisma } from "../../lib/prisma.js";
import { sendPushToUser } from "../../lib/push/pushService.js";
import type { PushProvider } from "../../lib/push/pushProvider.js";
import { isEntitled } from "../../lib/entitlements.js";
import { parsePhoneNumber } from "../../lib/phone.js";
import { sendOutboundMessage } from "../../lib/messaging/messagingService.js";
import type { MessagingProvider } from "../../lib/messaging/messagingProvider.js";
import type { MessageType } from "@prisma/client";
import { messagingBudgetAvailable } from "../../lib/messaging/messagingBudget.js";

type AppointmentMessageKind = "confirmation" | "reminder" | "same_day" | "rescheduled" | "canceled" | "follow_up" | "payment_reminder";
const fields: Record<AppointmentMessageKind, "confirmationSentAt" | "customerReminderSentAt" | "sameDayReminderSentAt" | "rescheduleConfirmationSentAt" | "cancellationConfirmationSentAt" | "followUpSentAt" | "paymentReminderSentAt"> = { confirmation: "confirmationSentAt", reminder: "customerReminderSentAt", same_day: "sameDayReminderSentAt", rescheduled: "rescheduleConfirmationSentAt", canceled: "cancellationConfirmationSentAt", follow_up: "followUpSentAt", payment_reminder: "paymentReminderSentAt" };
const messageTypes: Record<AppointmentMessageKind, MessageType> = { confirmation: "booking_confirmation", reminder: "appointment_reminder", same_day: "appointment_same_day_reminder", rescheduled: "appointment_rescheduled", canceled: "appointment_canceled", follow_up: "appointment_follow_up", payment_reminder: "payment_reminder" };

export async function sendCustomerAppointmentMessage(appointmentId: string, kind: AppointmentMessageKind, provider?: MessagingProvider) {
  const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId }, include: { customer: true, business: { include: { subscription: true } }, paymentTransactions: { where: { status: "pending", checkoutUrl: { not: null } }, orderBy: { createdAt: "desc" }, take: 1 } } });
  if (!appointment?.customer?.phoneE164 || !appointment.business.subscription || !isEntitled(appointment.business.subscription.plan, appointment.business.subscription.status, "OUTBOUND_MESSAGING")) return false;
  if (!(await messagingBudgetAvailable(appointment.businessId)).available) return false;
  const field = fields[kind];
  if (appointment[field]) return false;
  const optedOut = await prisma.customerOptOut.findFirst({ where: { businessId: appointment.businessId, phone: appointment.customer.phoneE164, channel: { in: ["SMS", "ALL"] } } });
  if (optedOut) return false;
  const claimedAt = new Date();
  const claimed = await prisma.appointment.updateMany({ where: { id: appointment.id, [field]: null }, data: { [field]: claimedAt } });
  if (claimed.count !== 1) return false;
  const when = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: appointment.business.timezone || "UTC" }).format(appointment.startsAt);
  const outstanding = Math.max(0, (appointment.price?.toNumber() ?? 0) - appointment.paidAmount.toNumber());
  const paymentLink = appointment.paymentTransactions[0]?.checkoutUrl;
  if (kind === "payment_reminder" && (!paymentLink || outstanding <= 0)) return false;
  const body = kind === "confirmation" ? `${appointment.business.name}: your ${appointment.serviceName} appointment is booked for ${when}.` : kind === "same_day" ? `${appointment.business.name}: your ${appointment.serviceName} appointment is today at ${when}.` : kind === "rescheduled" ? `${appointment.business.name}: your ${appointment.serviceName} appointment was moved to ${when}.` : kind === "canceled" ? `${appointment.business.name}: your ${appointment.serviceName} appointment for ${when} was canceled.` : kind === "follow_up" ? `${appointment.business.name}: thank you for your visit. We hope you enjoyed your ${appointment.serviceName} appointment.` : kind === "payment_reminder" ? `${appointment.business.name}: ${outstanding.toFixed(2)} ${appointment.business.currency ?? "USD"} remains for your ${appointment.serviceName}. Pay securely: ${paymentLink}` : `${appointment.business.name}: reminder that your ${appointment.serviceName} appointment is at ${when}.`;
  try {
    const result = await sendOutboundMessage({ to: appointment.customer.phoneE164, channel: "sms", body, countryCode: parsePhoneNumber(appointment.customer.phoneE164).country ?? "ZZ", idempotencyKey: `appointment:${kind}:${appointment.id}` }, provider);
    await prisma.message.create({ data: { businessId: appointment.businessId, customerId: appointment.customer.id, messageType: messageTypes[kind], channel: "sms", body, status: result.accepted ? "sent" : "failed", sentAt: result.accepted ? new Date() : null, provider: provider?.id ?? "twilio", providerMessageId: result.providerMessageId } });
    if (!result.accepted) await prisma.appointment.updateMany({ where: { id: appointment.id, [field]: claimedAt }, data: { [field]: null } });
    return result.accepted;
  } catch (error) { await prisma.appointment.updateMany({ where: { id: appointment.id, [field]: claimedAt }, data: { [field]: null } }); throw error; }
}

export const sendAppointmentConfirmation = (appointmentId: string, provider?: MessagingProvider) => sendCustomerAppointmentMessage(appointmentId, "confirmation", provider);

function localDate(value: Date, timeZone: string) { return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(value); }
export async function sendDueCustomerAppointmentMessages(provider?: MessagingProvider, batchSize = 50, now = new Date()) {
  const appointments = await prisma.appointment.findMany({
    where: { OR: [
      { status: { in: ["SCHEDULED", "CONFIRMED"] }, startsAt: { gt: now, lte: new Date(now.getTime() + 7 * 86_400_000) }, OR: [{ customerReminderSentAt: null }, { sameDayReminderSentAt: null }] },
      { status: "COMPLETED", endsAt: { lte: new Date(now.getTime() - 2 * 60 * 60_000), gte: new Date(now.getTime() - 7 * 86_400_000) }, followUpSentAt: null },
    ] },
    include: { business: { select: { timezone: true } } }, orderBy: { startsAt: "asc" }, take: batchSize,
  });
  let sent = 0;
  for (const appointment of appointments) {
    if (appointment.status === "COMPLETED") { if (await sendCustomerAppointmentMessage(appointment.id, "follow_up", provider)) sent += 1; continue; }
    const reminderAt = new Date(appointment.startsAt.getTime() - (appointment.reminderMinutes ?? 1440) * 60_000);
    if (!appointment.customerReminderSentAt && reminderAt <= now && await sendCustomerAppointmentMessage(appointment.id, "reminder", provider)) sent += 1;
    if (!appointment.sameDayReminderSentAt && localDate(appointment.startsAt, appointment.business.timezone || "UTC") === localDate(now, appointment.business.timezone || "UTC") && await sendCustomerAppointmentMessage(appointment.id, "same_day", provider)) sent += 1;
  }
  return sent;
}

/** Sends one balance reminder 24 hours after a completed appointment, but only when a secure pending Checkout link already exists. */
export async function sendDueAppointmentPaymentReminders(provider?: MessagingProvider, batchSize = 50, now = new Date()) {
  const due = await prisma.appointment.findMany({
    where: {
      status: "COMPLETED",
      paymentStatus: { in: ["unpaid", "partially_paid"] },
      price: { not: null },
      endsAt: { lte: new Date(now.getTime() - 24 * 60 * 60_000), gte: new Date(now.getTime() - 30 * 86_400_000) },
      paymentReminderSentAt: null,
      business: { paymentRemindersEnabled: true, messagingConsentConfirmedAt: { not: null } },
      paymentTransactions: { some: { status: "pending", checkoutUrl: { not: null } } },
    },
    orderBy: { endsAt: "asc" },
    take: batchSize,
    select: { id: true },
  });
  let sent = 0;
  for (const appointment of due) if (await sendCustomerAppointmentMessage(appointment.id, "payment_reminder", provider)) sent += 1;
  return sent;
}

export async function sendDueAppointmentReminders(provider?: PushProvider, batchSize = 50, now = new Date()) {
  const due = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM appointments
    WHERE reminder_minutes IS NOT NULL AND reminder_sent_at IS NULL
      AND status IN ('SCHEDULED', 'CONFIRMED') AND starts_at > ${now}
      AND starts_at <= ${now} + reminder_minutes * INTERVAL '1 minute'
    ORDER BY starts_at ASC LIMIT ${batchSize}
  `;
  let sent = 0;
  for (const { id } of due) {
    const claimed = await prisma.appointment.updateMany({ where: { id, reminderSentAt: null }, data: { reminderSentAt: now } });
    if (claimed.count !== 1) continue;
    const appointment = await prisma.appointment.findUnique({ where: { id }, include: { business: { select: { ownerId: true } }, customer: { select: { name: true } } } });
    if (!appointment) continue;
    try {
      await sendPushToUser(appointment.business.ownerId, { title: "Upcoming appointment", body: `${appointment.customer?.name ?? "Customer"} · ${appointment.serviceName} at ${appointment.startsAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`, data: { type: "appointment", appointmentId: appointment.id } }, provider);
      sent += 1;
    } catch (error) {
      await prisma.appointment.updateMany({ where: { id, reminderSentAt: now }, data: { reminderSentAt: null } });
      throw error;
    }
  }
  return sent;
}
