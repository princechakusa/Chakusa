import type { Plan, SubscriptionStatus } from "@prisma/client";
import { prisma } from "../../prisma.js";
import { isEntitled } from "../../entitlements.js";
import { resolveBusinessHours, type BusinessHoursState } from "../../businessHours.js";

// AI Receptionist #15 + After-hours #16 — the business control layer over the
// existing AI Customer Agent engine. Four independent gates must all pass
// before the agent answers an inbound customer message:
//   1. platform master switch  (FeatureFlag "ai.customer_agent" — admin/ops)
//   2. business opt-in          (this settings row + per-channel toggle)
//   3. plan entitlement         (AI_RECEPTIONIST)
//   4. schedule mode            (#16: AFTER_HOURS_ONLY only answers when the
//                                business is deterministically outside its
//                                configured working hours)
// This module owns #2, #3 and #4. It never changes how the agent reasons,
// what tools it may call, or the Policy Engine's autonomy/escalation.

export type ReceptionistChannel = "sms" | "whatsapp";
export type ReceptionistMode = "ALWAYS" | "AFTER_HOURS_ONLY";
export const RECEPTIONIST_MODES: readonly ReceptionistMode[] = ["ALWAYS", "AFTER_HOURS_ONLY"];

export interface ReceptionistSettings {
  enabled: boolean;
  smsEnabled: boolean;
  whatsappEnabled: boolean;
  mode: ReceptionistMode;
  updatedAt: string | null;
}

const DEFAULTS: ReceptionistSettings = { enabled: false, smsEnabled: true, whatsappEnabled: true, mode: "ALWAYS", updatedAt: null };

function normalizeMode(value: string): ReceptionistMode {
  return value === "AFTER_HOURS_ONLY" ? "AFTER_HOURS_ONLY" : "ALWAYS";
}

export async function getReceptionistSettings(businessId: string): Promise<ReceptionistSettings> {
  const row = await prisma.aiReceptionistSettings.findUnique({ where: { businessId } });
  if (!row) return DEFAULTS;
  return { enabled: row.enabled, smsEnabled: row.smsEnabled, whatsappEnabled: row.whatsappEnabled, mode: normalizeMode(row.mode), updatedAt: row.updatedAt.toISOString() };
}

export async function updateReceptionistSettings(
  businessId: string,
  actorUserId: string,
  patch: Partial<Pick<ReceptionistSettings, "enabled" | "smsEnabled" | "whatsappEnabled" | "mode">>,
): Promise<ReceptionistSettings> {
  const data = { ...patch, ...(patch.mode ? { mode: normalizeMode(patch.mode) } : {}) };
  const row = await prisma.aiReceptionistSettings.upsert({
    where: { businessId },
    create: { businessId, updatedByUserId: actorUserId, ...data },
    update: { updatedByUserId: actorUserId, ...data },
  });
  return { enabled: row.enabled, smsEnabled: row.smsEnabled, whatsappEnabled: row.whatsappEnabled, mode: normalizeMode(row.mode), updatedAt: row.updatedAt.toISOString() };
}

/** Server-resolved business-hours state, or null when the receptionist has no schedule dependency (ALWAYS mode). */
export async function resolveBusinessHoursForReceptionist(businessId: string, now = new Date()): Promise<BusinessHoursState> {
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { timezone: true, workingHours: true } });
  const closedRanges = await prisma.bookingBlock.findMany({
    where: { businessId, assignedMemberId: null, startsAt: { lte: now }, endsAt: { gt: now } },
    select: { startsAt: true, endsAt: true },
  });
  return resolveBusinessHours({
    timezone: business?.timezone,
    workingHours: business?.workingHours,
    now,
    closedRanges: closedRanges.map(b => ({ start: b.startsAt, end: b.endsAt })),
  });
}

export interface ReceptionistGateResult {
  ok: boolean;
  reason?: "not_entitled" | "receptionist_disabled" | "channel_disabled" | "inside_hours" | "hours_unresolved";
  /** Present whenever schedule was evaluated (AFTER_HOURS_ONLY mode). Lets the caller stamp the run + feed the model context. */
  hours?: BusinessHoursState;
}

/**
 * Full eligibility for one inbound message on one channel. Called from
 * handleInboundAIMessage AFTER the platform master switch. Pure reads, never
 * throws — a false result means "record the message, don't let the AI answer".
 * The after-hours decision here is deterministic server-side logic; the model
 * is never consulted about it.
 */
export async function receptionistGate(
  businessId: string,
  channel: ReceptionistChannel,
  plan: Plan,
  status: SubscriptionStatus,
  now = new Date(),
): Promise<ReceptionistGateResult> {
  if (!isEntitled(plan, status, "AI_RECEPTIONIST")) return { ok: false, reason: "not_entitled" };
  const settings = await getReceptionistSettings(businessId);
  if (!settings.enabled) return { ok: false, reason: "receptionist_disabled" };
  const channelOk = channel === "sms" ? settings.smsEnabled : settings.whatsappEnabled;
  if (!channelOk) return { ok: false, reason: "channel_disabled" };

  if (settings.mode === "AFTER_HOURS_ONLY") {
    const hours = await resolveBusinessHoursForReceptionist(businessId, now);
    if (!hours.resolved) return { ok: false, reason: "hours_unresolved", hours }; // fail conservative — do not invent hours
    if (hours.open) return { ok: false, reason: "inside_hours", hours };
    return { ok: true, hours };
  }
  return { ok: true };
}
