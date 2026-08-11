import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { recordActivity } from "../../lib/activity.js";
import { renderTemplate } from "../../lib/templateEngine.js";
import { getDefaultTemplateBody } from "../../lib/defaultTemplates.js";
import type { CreateReminderInput, UpdateReminderInput } from "./reminders.schemas.js";

export async function listReminders(businessId: string) {
  return prisma.reminder.findMany({
    where: { businessId },
    orderBy: { dueDate: "asc" },
    include: { customer: true },
  });
}

export async function createReminder(
  businessId: string,
  actorId: string,
  input: CreateReminderInput,
) {
  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });

  let dueDate = input.dueDate;
  if (!dueDate) {
    if (!input.lastVisitDate) {
      throw ApiError.badRequest("Either dueDate or lastVisitDate is required");
    }
    dueDate = new Date(input.lastVisitDate);
    dueDate.setDate(dueDate.getDate() + business.reminderDays);
  }

  const reminder = await prisma.reminder.create({
    data: {
      businessId,
      customerId: input.customerId,
      serviceName: input.serviceName,
      lastVisitDate: input.lastVisitDate,
      dueDate,
    },
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
  return reminder;
}

export async function updateReminder(businessId: string, id: string, input: UpdateReminderInput) {
  await getOwnedReminder(businessId, id);
  return prisma.reminder.update({ where: { id }, data: input });
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
    orderBy: { isDefault: "desc" },
  });

  const body = template?.body ?? getDefaultTemplateBody("comeback_reminder", business.industry);

  const rendered = renderTemplate(body, {
    customer_name: reminder.customer?.name ?? "there",
    business_name: business.name,
    service_name: reminder.serviceName ?? "your service",
    phone_number: business.phone ?? "",
  });

  await prisma.reminder.update({ where: { id }, data: { message: rendered } });

  return { message: rendered };
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

  return reminder;
}

export const markReminderSent = (businessId: string, actorId: string, id: string) =>
  transitionReminder(businessId, actorId, id, "sent", "REMINDER_SENT");

export const markReminderCompleted = (businessId: string, actorId: string, id: string) =>
  transitionReminder(businessId, actorId, id, "completed", "REMINDER_COMPLETED");

export const dismissReminder = (businessId: string, actorId: string, id: string) =>
  transitionReminder(businessId, actorId, id, "dismissed", "REMINDER_DISMISSED");
