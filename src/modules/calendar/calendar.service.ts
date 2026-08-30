import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { generateOpaqueToken, parseOpaqueToken, tokenHashMatches } from "../../lib/authTokens.js";
import type { CreateCalendarSubscriptionInput } from "./calendar.schemas.js";

const feedWindowBeforeMs = 30 * 86_400_000;
const feedWindowAfterMs = 366 * 86_400_000;

export async function createCalendarSubscription(businessId: string, input: CreateCalendarSubscriptionInput) {
  const token = generateOpaqueToken();
  const subscription = await prisma.externalCalendarSubscription.create({
    data: { id: token.id, businessId, tokenId: token.id, tokenHash: token.hash, label: input.label ?? "Chakusa calendar" },
    select: { id: true, label: true, createdAt: true },
  });
  // The raw token is intentionally returned only here. It is never persisted or logged.
  return { ...subscription, token: token.raw };
}

export function listCalendarSubscriptions(businessId: string) {
  return prisma.externalCalendarSubscription.findMany({
    where: { businessId },
    select: { id: true, label: true, createdAt: true, revokedAt: true, lastAccessedAt: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function revokeCalendarSubscription(businessId: string, id: string) {
  const result = await prisma.externalCalendarSubscription.updateMany({
    where: { id, businessId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (result.count !== 1) throw ApiError.notFound("Calendar subscription not found or already revoked");
  return { revoked: true };
}

function escapeIcs(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function icsDate(value: Date) {
  return value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export async function resolveCalendarFeed(rawToken: string, now = new Date()) {
  const tokenId = parseOpaqueToken(rawToken);
  if (!tokenId) return null;
  const subscription = await prisma.externalCalendarSubscription.findUnique({
    where: { tokenId },
    select: { id: true, tokenHash: true, businessId: true, label: true, revokedAt: true, business: { select: { name: true, platformStatus: true } } },
  });
  if (!subscription || subscription.revokedAt || subscription.business.platformStatus !== "ACTIVE" || !tokenHashMatches(rawToken, subscription.tokenHash)) return null;

  const from = new Date(now.getTime() - feedWindowBeforeMs);
  const to = new Date(now.getTime() + feedWindowAfterMs);
  const appointments = await prisma.appointment.findMany({
    where: { businessId: subscription.businessId, startsAt: { gte: from, lte: to } },
    select: { id: true, serviceName: true, startsAt: true, endsAt: true, status: true },
    orderBy: { startsAt: "asc" },
  });
  // This write contains no appointment/customer data and is intentionally best effort.
  void prisma.externalCalendarSubscription.update({ where: { id: subscription.id }, data: { lastAccessedAt: new Date() } }).catch(() => undefined);

  const events = appointments.map(appointment => [
    "BEGIN:VEVENT",
    `UID:${appointment.id}@chakusa.com`,
    `DTSTAMP:${icsDate(now)}`,
    `DTSTART:${icsDate(appointment.startsAt)}`,
    `DTEND:${icsDate(appointment.endsAt)}`,
    `SUMMARY:${escapeIcs(`${appointment.serviceName} — ${subscription.business.name}`)}`,
    `STATUS:${appointment.status === "CANCELED" ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
  ].join("\r\n"));
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Chakusa//Business Calendar//EN", `X-WR-CALNAME:${escapeIcs(subscription.label)}`, "CALSCALE:GREGORIAN", "METHOD:PUBLISH", ...events, "END:VCALENDAR", ""].join("\r\n");
}
