import type { FeatureFlagScope } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";

export const AUTOMATION_CAPABILITIES = ["workflows", "conversations", "ai", "messaging", "providers", "runtime", "analytics"] as const;
export type AutomationCapability = (typeof AUTOMATION_CAPABILITIES)[number];
export type CapabilityStatus = "ENABLED" | "DISABLED" | "BETA" | "INTERNAL" | "PRODUCTION";

const defaults: Record<AutomationCapability, CapabilityStatus> = {
  workflows: "BETA", conversations: "INTERNAL", ai: "INTERNAL", messaging: "BETA", providers: "INTERNAL", runtime: "INTERNAL", analytics: "BETA",
};
const killSwitches = ["automation_enabled", "ai_enabled", "messaging_enabled", "providers_enabled", "conversations_enabled"] as const;

function rolloutApplies(percent: number, subject: string) {
  if (percent >= 100) return true;
  if (percent <= 0) return false;
  let hash = 0; for (const char of subject) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 100 < percent;
}

export async function getAutomationFoundationStatus(businessId?: string, userId?: string) {
  const settings = await prisma.platformSetting.findMany({ where: { key: { in: [...killSwitches, "maintenance_mode"] } }, select: { key: true, value: true, updatedAt: true } });
  const settingMap = new Map(settings.map((s) => [s.key, s.value === true]));
  const flags = await prisma.featureFlag.findMany({ where: { OR: [{ key: { startsWith: "automation." } }, { key: { startsWith: "kill_switch." } }], AND: { OR: [{ scope: "PLATFORM" }, { scope: "INTERNAL" }, ...(businessId ? [{ scope: "BUSINESS" as FeatureFlagScope, businessId }] : []), ...(userId ? [{ scope: "USER" as FeatureFlagScope, userId }] : [])] } }, orderBy: { updatedAt: "asc" } });
  const capabilities = Object.fromEntries(AUTOMATION_CAPABILITIES.map((key) => [key, defaults[key]])) as Record<AutomationCapability, CapabilityStatus>;
  const applicable = flags.filter((flag) => { if (flag.scope === "INTERNAL") { const metadata = flag.metadata && typeof flag.metadata === "object" && !Array.isArray(flag.metadata) ? flag.metadata as Record<string, unknown> : {}; const businesses = Array.isArray(metadata.businessIds) ? metadata.businessIds.map(String) : []; const users = Array.isArray(metadata.userIds) ? metadata.userIds.map(String) : []; if (metadata.all !== true && (!businessId || !businesses.includes(businessId)) && (!userId || !users.includes(userId))) return false; } return rolloutApplies(flag.rolloutPercent, businessId ?? userId ?? "platform"); }).sort((a,b) => ({ PLATFORM:0, INTERNAL:1, BUSINESS:2, USER:3 }[a.scope] - { PLATFORM:0, INTERNAL:1, BUSINESS:2, USER:3 }[b.scope]));
  for (const flag of applicable) { const key = flag.key.replace(/^automation\./, "") as AutomationCapability; if (key in capabilities) capabilities[key] = flag.enabled ? flag.status as CapabilityStatus : "DISABLED"; }
  const enabled = settingMap.get("automation_enabled") !== false;
  const tenantKill = (key: string) => applicable.some((flag) => flag.key === `kill_switch.${key}` && flag.enabled);
  const providerKillSwitches = Object.fromEntries(applicable.filter((flag) => flag.enabled && flag.key.startsWith("kill_switch.provider.")).map((flag) => [flag.key.slice("kill_switch.provider.".length), true]));
  return { capabilities, killSwitches: { automation: enabled && !tenantKill("automation"), ai: settingMap.get("ai_enabled") !== false && !tenantKill("ai"), messaging: settingMap.get("messaging_enabled") !== false && !tenantKill("messaging"), providers: settingMap.get("providers_enabled") !== false && !tenantKill("providers"), conversations: settingMap.get("conversations_enabled") !== false && !tenantKill("conversations") }, providerKillSwitches, maintenance: settingMap.get("maintenance_mode") === true, updatedAt: [...settings,...flags].reduce<Date | null>((latest, item) => !latest || item.updatedAt > latest ? item.updatedAt : latest, null) };
}
