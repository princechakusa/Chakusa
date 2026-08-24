import { prisma } from "../../lib/prisma.js";
import { sendPushToUser } from "../../lib/push/pushService.js";
import type { PushProvider } from "../../lib/push/pushProvider.js";
import { isEntitled } from "../../lib/entitlements.js";
import { parsePhoneNumber } from "../../lib/phone.js";
import { sendOutboundMessage } from "../../lib/messaging/messagingService.js";
import type { MessagingProvider } from "../../lib/messaging/messagingProvider.js";

async function sendCustomerAppointmentMessage(appointmentId: string, kind: "confirmation" | "reminder", provider?: MessagingProvider) {
  const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId }, include: { customer: true, business: { include: { subscription: true } } } });
  if (!appointment?.customer?.phoneE164 || !appointment.business.subscription || !isEntitled(appointment.business.subscription.plan, appointment.business.subscription.status, "OUTBOUND_MESSAGING")) return false;
  const field = kind === "confirmation" ? "confirmationSentAt" : "customerReminderSentAt";
  if (appointment[field]) return false;
  const optedOut = await prisma.customerOptOut.findFirst({ where: { businessId: appointment.businessId, phone: appointment.customer.phoneE164, channel: { in: ["SMS", "ALL"] } } });
  if (optedOut) return false;
  const claimedAt = new Date();
  const claimed = await prisma.appointment.updateMany({ where: { id: appointment.id, [field]: null }, data: { [field]: claimedAt } });
  if (claimed.count !== 1) return false;
  const when = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: appointment.business.timezone || "UTC" }).format(appointment.startsAt);
  const body = kind === "confirmation" ? `${appointment.business.name}: your ${appointment.serviceName} appointment is booked for ${when}.` : `${appointment.business.name}: reminder that your ${appointment.serviceName} appointment is at ${when}.`;
  try {
    const result = await sendOutboundMessage({ to: appointment.customer.phoneE164, channel: "sms", body, countryCode: parsePhoneNumber(appointment.customer.phoneE164).country ?? "ZZ", idempotencyKey: `appointment:${kind}:${appointment.id}` }, provider);
    await prisma.message.create({ data: { businessId: appointment.businessId, customerId: appointment.customer.id, messageType: "booking_confirmation", channel: "sms", body, status: result.accepted ? "sent" : "failed", sentAt: result.accepted ? new Date() : null, provider: "twilio", providerMessageId: result.providerMessageId } });
    if (!result.accepted) await prisma.appointment.updateMany({ where: { id: appointment.id, [field]: claimedAt }, data: { [field]: null } });
    return result.accepted;
  } catch (error) { await prisma.appointment.updateMany({ where: { id: appointment.id, [field]: claimedAt }, data: { [field]: null } }); throw error; }
}

export const sendAppointmentConfirmation = (appointmentId: string, provider?: MessagingProvider) => sendCustomerAppointmentMessage(appointmentId, "confirmation", provider);

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
