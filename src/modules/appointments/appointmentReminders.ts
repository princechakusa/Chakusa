import { prisma } from "../../lib/prisma.js";
import { sendPushToUser } from "../../lib/push/pushService.js";
import type { PushProvider } from "../../lib/push/pushProvider.js";

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
