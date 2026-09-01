import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { ApiError } from "../errors.js";
import { sendPushToUser } from "../push/pushService.js";
import type { PushProvider } from "../push/pushProvider.js";

// PROGRAM 2 LOOP 1: the customer notification feed. This table is the
// durable inbox the dashboard reads; delivery reuses the existing push
// service (and, later, the Messaging Platform). Preferences gate the
// channels, never the feed row.

export const NOTIFICATION_CATEGORIES = [
  "booking_update",
  "message",
  "ai_reply",
  "promotion",
  "review_reminder",
  "appointment_reminder",
  "loyalty",
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

function channelAllowed(preferences: unknown, category: string, channel: "push" | "email"): boolean {
  const prefs = preferences && typeof preferences === "object" ? (preferences as Record<string, { push?: boolean; email?: boolean }>) : {};
  const entry = prefs[category];
  if (!entry) return channel === "push"; // default: push on, email off
  return entry[channel] !== false && (entry[channel] === true || channel === "push");
}

/**
 * Records a notification for a customer and fans it out to the channels
 * their preferences permit. Best-effort: a failed push never fails the
 * caller and the feed row is always written.
 */
export async function notifyCustomer(
  input: {
    customerProfileId: string;
    category: NotificationCategory;
    title: string;
    body: string;
    businessId?: string | null;
    data?: unknown;
  },
  pushProvider?: PushProvider,
) {
  const profile = await prisma.customerProfile.findUnique({
    where: { id: input.customerProfileId },
    select: { userId: true, status: true, notificationPreferences: true },
  });
  if (!profile) throw ApiError.notFound("Customer profile not found");

  const wantsPush = profile.status === "ACTIVE" && channelAllowed(profile.notificationPreferences, input.category, "push");
  const delivered: string[] = [];

  if (wantsPush) {
    try {
      const message = { title: input.title, body: input.body, data: { category: input.category, ...(input.data && typeof input.data === "object" ? (input.data as Record<string, unknown>) : {}) } };
      const results = pushProvider ? await sendPushToUser(profile.userId, message, pushProvider) : await sendPushToUser(profile.userId, message);
      if (results.length) delivered.push("push");
    } catch {
      /* best-effort */
    }
  }

  return prisma.customerNotification.create({
    data: {
      customerProfileId: input.customerProfileId,
      businessId: input.businessId ?? null,
      category: input.category,
      title: input.title,
      body: input.body,
      data: (input.data ?? undefined) as Prisma.InputJsonValue | undefined,
      channels: delivered as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function listCustomerNotifications(customerProfileId: string, options: { unreadOnly?: boolean; limit?: number } = {}) {
  return prisma.customerNotification.findMany({
    where: { customerProfileId, ...(options.unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: "desc" },
    take: Math.min(options.limit ?? 50, 200),
  });
}

export async function markNotificationRead(customerProfileId: string, id: string) {
  const updated = await prisma.customerNotification.updateMany({ where: { id, customerProfileId, readAt: null }, data: { readAt: new Date() } });
  if (!updated.count) {
    const exists = await prisma.customerNotification.findFirst({ where: { id, customerProfileId }, select: { id: true } });
    if (!exists) throw ApiError.notFound("Notification not found");
  }
  return prisma.customerNotification.findFirstOrThrow({ where: { id, customerProfileId } });
}

export async function markAllNotificationsRead(customerProfileId: string) {
  const result = await prisma.customerNotification.updateMany({ where: { customerProfileId, readAt: null }, data: { readAt: new Date() } });
  return { updated: result.count };
}

export async function unreadNotificationCount(customerProfileId: string) {
  return prisma.customerNotification.count({ where: { customerProfileId, readAt: null } });
}
