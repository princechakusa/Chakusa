import type { Plan, SubscriptionStatus } from "@prisma/client";
import { prisma } from "../../prisma.js";
import { isEntitled } from "../../entitlements.js";

// AI Receptionist #15 — the business control layer over the existing AI
// Customer Agent engine. Three independent gates must all pass before the
// agent answers an inbound customer message:
//   1. platform master switch  (FeatureFlag "ai.customer_agent" — admin/ops)
//   2. business opt-in          (this settings row + per-channel toggle)
//   3. plan entitlement         (AI_RECEPTIONIST)
// This module owns #2 and #3. It never changes how the agent reasons, what
// tools it may call, or the Policy Engine's autonomy/escalation decisions.

export type ReceptionistChannel = "sms" | "whatsapp";

export interface ReceptionistSettings {
  enabled: boolean;
  smsEnabled: boolean;
  whatsappEnabled: boolean;
  updatedAt: string | null;
}

const DEFAULTS: ReceptionistSettings = { enabled: false, smsEnabled: true, whatsappEnabled: true, updatedAt: null };

export async function getReceptionistSettings(businessId: string): Promise<ReceptionistSettings> {
  const row = await prisma.aiReceptionistSettings.findUnique({ where: { businessId } });
  if (!row) return DEFAULTS;
  return { enabled: row.enabled, smsEnabled: row.smsEnabled, whatsappEnabled: row.whatsappEnabled, updatedAt: row.updatedAt.toISOString() };
}

export async function updateReceptionistSettings(
  businessId: string,
  actorUserId: string,
  patch: Partial<Pick<ReceptionistSettings, "enabled" | "smsEnabled" | "whatsappEnabled">>,
): Promise<ReceptionistSettings> {
  const row = await prisma.aiReceptionistSettings.upsert({
    where: { businessId },
    create: { businessId, updatedByUserId: actorUserId, ...patch },
    update: { updatedByUserId: actorUserId, ...patch },
  });
  return { enabled: row.enabled, smsEnabled: row.smsEnabled, whatsappEnabled: row.whatsappEnabled, updatedAt: row.updatedAt.toISOString() };
}

export interface ReceptionistGateResult {
  ok: boolean;
  reason?: "not_entitled" | "receptionist_disabled" | "channel_disabled";
}

/**
 * Business + entitlement gate for one inbound message on one channel. Called
 * from handleInboundAIMessage AFTER the platform master switch. Pure reads,
 * never throws — a false result just means "record the message, don't let
 * the AI answer".
 */
export async function receptionistGate(
  businessId: string,
  channel: ReceptionistChannel,
  plan: Plan,
  status: SubscriptionStatus,
): Promise<ReceptionistGateResult> {
  if (!isEntitled(plan, status, "AI_RECEPTIONIST")) return { ok: false, reason: "not_entitled" };
  const settings = await getReceptionistSettings(businessId);
  if (!settings.enabled) return { ok: false, reason: "receptionist_disabled" };
  const channelOk = channel === "sms" ? settings.smsEnabled : settings.whatsappEnabled;
  if (!channelOk) return { ok: false, reason: "channel_disabled" };
  return { ok: true };
}
