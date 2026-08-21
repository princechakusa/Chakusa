import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { recordActivity } from "../../lib/activity.js";
import { renderTemplate } from "../../lib/templateEngine.js";
import { getDefaultTemplateBody } from "../../lib/defaultTemplates.js";
import { assertFeatureAvailable, assertUnderLimit, getPlanLimits, withLimitCheck } from "../../lib/entitlements.js";
import { sendMessage } from "../messages/messages.service.js";
import type { MessagingProvider } from "../../lib/messaging/messagingProvider.js";
import type { CreateReminderInput, UpdateReminderInput } from "./reminders.schemas.js";
import type { Plan, Reminder, SubscriptionStatus } from "@prisma/client";

/**
 * DUE NOW vs SCHEDULED FOR THE FUTURE is not a stored state — Reminder.status
 * stays "due" from creation regardless of how far away dueDate is (see the
 * P1 audit finding). Rather than add a new status or migrate dates, this
 * computes the distinction server-side on every read so Codex never has to
 * duplicate "is this actually due" logic (comparing dueDate to now) on the
 * client: isDueNow is true only when status is still "due" AND dueDate has
 * already passed — the exact same condition dashboard.service.ts's
 * dueReminders query already uses for "needs action now".
 */
function withDueNow<T extends Reminder>(reminder: T) {
  return { ...reminder, isDueNow: reminder.status === "due" && reminder.dueDate <= new Date() };
}

/**
 * Deliberately still a bare array, not the {items, total, page, pageSize}
 * envelope used by customers/leads — mobile's remindersApi.list() and
 * AppContext both type this as ReminderDto[] and this task must not change
 * the mobile-facing response shape. This is flagged as a P1 scale gap in
 * the audit report: unbounded today, same as before this pass. Migrating
 * it to the paginated envelope is mobile-coordinated work for a future
 * phase, not something to change silently here.
 */
export async function listReminders(businessId: string) {
  const reminders = await prisma.reminder.findMany({
    where: { businessId },
    orderBy: { dueDate: "asc" },
    include: { customer: true },
  });
  return reminders.map(withDueNow);
}

async function assertCustomerInBusiness(businessId: string, customerId: string) {
  const customer = await prisma.customer.findFirst({ where: { id: customerId, businessId } });
  if (!customer) {
    throw ApiError.badRequest("customerId does not belong to this business");
  }
}

export async function createReminder(
  businessId: string,
  actorId: string,
  input: CreateReminderInput,
  plan: Plan,
) {
  if (input.customerId) {
    await assertCustomerInBusiness(businessId, input.customerId);
  }

  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });

  let dueDate = input.dueDate;
  if (!dueDate) {
    if (!input.lastVisitDate) {
      throw ApiError.badRequest("Either dueDate or lastVisitDate is required");
    }
    dueDate = new Date(input.lastVisitDate);
    dueDate.setDate(dueDate.getDate() + business.reminderDays);
  }

  const limit = getPlanLimits(plan).openReminders;

  const reminder = await withLimitCheck(async (tx) => {
    if (limit !== null) {
      // "Open" = not completed and not dismissed — a standing cap, not a
      // monthly one, so there is no periodResetsAt for this resource.
      const current = await tx.reminder.count({ where: { businessId, status: { notIn: ["completed", "dismissed"] } } });
      assertUnderLimit({ plan, resource: "reminders", limit, current });
    }

    return tx.reminder.create({
      data: {
        businessId,
        customerId: input.customerId,
        serviceName: input.serviceName,
        lastVisitDate: input.lastVisitDate,
        dueDate,
      },
    });
  });

  await recordActivity({
    businessId,
    actorId,
    eventType: "REMINDER_CREATED",
    entityType: "reminder",
    entityId: reminder.id,
  });

  return reminder;
}

async function getOwnedReminder(businessId: string, id: string) {
  const reminder = await prisma.reminder.findFirst({ where: { id, businessId } });
  if (!reminder) {
    throw ApiError.notFound("Reminder not found");
  }
  return reminder;
}

export async function getReminder(businessId: string, id: string) {
  const reminder = await prisma.reminder.findFirst({
    where: { id, businessId },
    include: { customer: true },
  });
  if (!reminder) {
    throw ApiError.notFound("Reminder not found");
  }
  return withDueNow(reminder);
}

export async function updateReminder(businessId: string, id: string, input: UpdateReminderInput) {
  await getOwnedReminder(businessId, id);
  const reminder = await prisma.reminder.update({ where: { id }, data: input });
  return withDueNow(reminder);
}

async function renderReminderMessage(
  reminder: Reminder & { customer: { name: string } | null },
  business: { name: string; industry: string | null; phone: string | null },
  template: { body: string } | null,
) {
  const body = template?.body ?? getDefaultTemplateBody("comeback_reminder", business.industry);
  return renderTemplate(body, {
    customer_name: reminder.customer?.name ?? "there",
    business_name: business.name,
    service_name: reminder.serviceName ?? "your service",
    phone_number: business.phone ?? "",
  });
}

export async function generateReminderMessage(businessId: string, id: string) {
  const reminder = await prisma.reminder.findFirst({
    where: { id, businessId },
    include: { customer: true },
  });
  if (!reminder) {
    throw ApiError.notFound("Reminder not found");
  }

  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });

  const template = await prisma.messageTemplate.findFirst({
    where: { businessId, templateType: "comeback_reminder" },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }, { id: "asc" }],
  });

  const rendered = await renderReminderMessage(reminder, business, template);

  await prisma.reminder.update({ where: { id }, data: { message: rendered } });

  return { message: rendered };
}

function dueReminders(businessId: string) {
  return prisma.reminder.findMany({
    where: { businessId, status: "due", dueDate: { lte: new Date() } },
    include: { customer: true },
  });
}

/**
 * Marketing module's "Comeback campaign" — prepares (but never sends) a
 * message for every currently-due reminder that doesn't already have one.
 * Available on every plan, same as the single-reminder generate above;
 * the owner still copies/opens SMS or WhatsApp themselves from the list
 * this returns. See bulkSendReminders for the Pro+ one-tap-send version.
 */
export async function bulkGenerateReminderMessages(businessId: string) {
  const [reminders, business, template] = await Promise.all([
    dueReminders(businessId),
    prisma.business.findUniqueOrThrow({ where: { id: businessId } }),
    prisma.messageTemplate.findFirst({
      where: { businessId, templateType: "comeback_reminder" },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }, { id: "asc" }],
    }),
  ]);

  const results: { id: string; customerName: string | null; message: string }[] = [];
  for (const reminder of reminders) {
    const message = reminder.message ?? (await renderReminderMessage(reminder, business, template));
    if (!reminder.message) {
      await prisma.reminder.update({ where: { id: reminder.id }, data: { message } });
    }
    results.push({ id: reminder.id, customerName: reminder.customer?.name ?? null, message });
  }
  return results;
}

/**
 * Pro+ one-tap version of the campaign above: actually sends via
 * sendMessage's existing entitlement/opt-out/phone-validation pipeline,
 * one real SMS per due reminder with a valid recipient. Entitlement is
 * asserted once up front (a clean single 403 rather than the same
 * rejection N times); everything after that is per-recipient so one
 * customer's opt-out or missing phone number never blocks the rest of
 * the batch. Reminders without a resolvable customer/phone are reported
 * as skipped, never silently dropped.
 */
export async function bulkSendReminders(
  businessId: string,
  actorId: string,
  plan: Plan,
  status: SubscriptionStatus,
  provider?: MessagingProvider,
) {
  assertFeatureAvailable(plan, status, "OUTBOUND_MESSAGING");

  const prepared = await bulkGenerateReminderMessages(businessId);
  const reminders = await dueReminders(businessId);
  const messageById = new Map(prepared.map((item) => [item.id, item.message]));

  const results: { id: string; customerName: string | null; outcome: "sent" | "failed" | "skipped"; reason?: string }[] = [];
  for (const reminder of reminders) {
    const message = messageById.get(reminder.id);
    if (!reminder.customerId || !message) {
      results.push({ id: reminder.id, customerName: reminder.customer?.name ?? null, outcome: "skipped", reason: "No customer on this reminder" });
      continue;
    }
    try {
      await sendMessage(businessId, { customerId: reminder.customerId, body: message, messageType: "comeback_reminder" }, plan, status, provider);
      await markReminderSent(businessId, actorId, reminder.id);
      results.push({ id: reminder.id, customerName: reminder.customer?.name ?? null, outcome: "sent" });
    } catch (error) {
      const reason = error instanceof ApiError ? error.message : "Could not send this message";
      results.push({ id: reminder.id, customerName: reminder.customer?.name ?? null, outcome: "failed", reason });
    }
  }

  return {
    sentCount: results.filter((r) => r.outcome === "sent").length,
    failedCount: results.filter((r) => r.outcome === "failed").length,
    skippedCount: results.filter((r) => r.outcome === "skipped").length,
    results,
  };
}

async function transitionReminder(
  businessId: string,
  actorId: string,
  id: string,
  status: "sent" | "completed" | "dismissed",
  eventType: "REMINDER_SENT" | "REMINDER_COMPLETED" | "REMINDER_DISMISSED",
) {
  await getOwnedReminder(businessId, id);

  const reminder = await prisma.reminder.update({ where: { id }, data: { status } });

  await recordActivity({ businessId, actorId, eventType, entityType: "reminder", entityId: id });

  return withDueNow(reminder);
}

export const markReminderSent = (businessId: string, actorId: string, id: string) =>
  transitionReminder(businessId, actorId, id, "sent", "REMINDER_SENT");

export const markReminderCompleted = (businessId: string, actorId: string, id: string) =>
  transitionReminder(businessId, actorId, id, "completed", "REMINDER_COMPLETED");

export const dismissReminder = (businessId: string, actorId: string, id: string) =>
  transitionReminder(businessId, actorId, id, "dismissed", "REMINDER_DISMISSED");
