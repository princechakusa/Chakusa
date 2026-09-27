import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { recordAdminAudit, type AdminAuditActor, type AdminAuditContext } from "../admin/adminAudit.service.js";

// Runtime app configuration: values the mobile app reads at launch instead
// of baking them in at build time, so a platform admin can change them from
// the admin console with no new app build or store release.
//
// Rules:
// - These are presentation/rollout switches only. The backend stays
//   authoritative: every feature still enforces its own entitlement,
//   authorization, and kill switches (e.g. automation_enabled in
//   automationFoundation.ts). Showing a screen never grants an action.
// - Defaults equal the current production build values, so an empty table
//   changes nothing for users.
// - App-facing keys are prefixed `app.` and are distinct from the backend
//   kill switches in PLATFORM_SETTING_DEFAULTS; turning automation *visible*
//   in the app is a different decision from letting workers run.
// - Links are https and restricted to approved hosts, so a mistaken or
//   compromised admin edit cannot point legal/support links off-domain.

export type AppConfigKind = "boolean" | "url" | "email" | "version" | "text" | "year" | "phone";

interface AppConfigDefinition {
  key: string;
  kind: AppConfigKind;
  default: boolean | string | null;
  label: string;
  description: string;
  /** Overrides the approved-host list for this key (e.g. store listings). */
  hosts?: readonly string[];
}

export const APP_CONFIG_DEFINITIONS = [
  { key: "app.automation_enabled", kind: "boolean", default: false, label: "Automation screens", description: "Show automation in the business app. The backend's automation_enabled switch and plan entitlements still decide what can run." },
  { key: "app.billing_enabled", kind: "boolean", default: true, label: "In-app purchases", description: "Show App Store / Google Play subscription purchase. Store product IDs still come from the build." },
  { key: "app.email_auth_enabled", kind: "boolean", default: false, label: "Email sign-in", description: "Offer email + password sign-in and password reset. Only enable once outbound email is configured." },
  { key: "app.google_sign_in_enabled", kind: "boolean", default: true, label: "Google sign-in", description: "Offer Google sign-in. Can only hide it; a build without Google configured never shows it." },
  { key: "app.apple_sign_in_enabled", kind: "boolean", default: true, label: "Apple sign-in", description: "Offer Sign in with Apple on iOS. Can only hide it; a build without Apple configured never shows it." },
  { key: "app.support_email", kind: "email", default: "support@chakusarecovery.com", label: "Support email", description: "Where the app sends people who need help." },
  { key: "app.support_url", kind: "url", default: "https://chakusarecovery.com/help", label: "Support page", description: "Help page opened from the app." },
  { key: "app.privacy_url", kind: "url", default: "https://chakusarecovery.com/privacy", label: "Privacy policy", description: "Privacy policy link shown in the app." },
  { key: "app.terms_url", kind: "url", default: "https://chakusarecovery.com/terms", label: "Terms of use", description: "Terms link shown in the app." },
  { key: "app.ios_store_url", kind: "url", default: null, hosts: ["apps.apple.com"], label: "App Store listing", description: "Link used when asking iPhone users to update (https://apps.apple.com/...). Empty until the listing is live." },
  { key: "app.android_store_url", kind: "url", default: "https://play.google.com/store/apps/details?id=com.chakusa.mobile", hosts: ["play.google.com"], label: "Google Play listing", description: "Link used when asking Android users to update." },
  { key: "app.min_supported_version", kind: "version", default: null, label: "Minimum app version", description: "Versions older than this are asked to update before continuing (e.g. 1.4.0). Leave empty to allow all." },
  { key: "app.website_url", kind: "url", default: "https://chakusarecovery.com", label: "Website", description: "Main website link shown in the app and footer." },
  { key: "app.whatsapp_number", kind: "phone", default: null, label: "Support WhatsApp", description: "International format, e.g. +263771234567. Leave empty to hide." },
  { key: "app.instagram_url", kind: "url", default: null, hosts: ["instagram.com"], label: "Instagram", description: "Profile link. Leave empty to hide." },
  { key: "app.facebook_url", kind: "url", default: null, hosts: ["facebook.com", "fb.com"], label: "Facebook", description: "Page link. Leave empty to hide." },
  { key: "app.tiktok_url", kind: "url", default: null, hosts: ["tiktok.com"], label: "TikTok", description: "Profile link. Leave empty to hide." },
  { key: "app.linkedin_url", kind: "url", default: null, hosts: ["linkedin.com"], label: "LinkedIn", description: "Company page link. Leave empty to hide." },
  { key: "app.company_legal_name", kind: "text", default: null, label: "Company legal name", description: "Registered company name shown in legal footers. Leave empty to show just 'Chakusa'." },
  { key: "app.company_registration_number", kind: "text", default: null, label: "Company registration number", description: "Shown in legal footers when set." },
  { key: "app.company_address", kind: "text", default: null, label: "Registered address", description: "Shown in legal footers when set." },
  { key: "app.copyright_holder", kind: "text", default: "Chakusa", label: "Copyright holder", description: "Name in the © line." },
  { key: "app.copyright_start_year", kind: "year", default: "2026", label: "Copyright start year", description: "The © line shows this year, or a range up to the current year (e.g. 2026–2027), computed when the page loads." },
  { key: "app.notice", kind: "text", default: null, label: "In-app notice", description: "Short message shown at the top of the app (max 160 characters). Leave empty for none." },
] as const satisfies readonly AppConfigDefinition[];

export type AppConfigKey = (typeof APP_CONFIG_DEFINITIONS)[number]["key"];
const definitions = new Map<string, AppConfigDefinition>(APP_CONFIG_DEFINITIONS.map((d) => [d.key, d]));

function approvedHosts() {
  return (process.env.APP_CONFIG_ALLOWED_HOSTS ?? "chakusarecovery.com")
    .split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
}

function hostApproved(host: string, allowedList: readonly string[] = approvedHosts()) {
  const h = host.toLowerCase();
  return allowedList.some((allowed) => h === allowed || h.endsWith(`.${allowed}`));
}

/** Validates and normalizes an admin-supplied value. Returns null for "unset". */
export function normalizeAppConfigValue(key: string, value: unknown): boolean | string | null {
  const def = definitions.get(key);
  if (!def) throw ApiError.badRequest("Unknown app configuration key");
  // null means "reset to default" for every kind.
  if (value === null) return null;
  if (value === "" && def.kind !== "boolean") return null;
  switch (def.kind) {
    case "boolean":
      if (typeof value !== "boolean") throw ApiError.badRequest("Expected true or false");
      return value;
    case "url": {
      if (typeof value !== "string") throw ApiError.badRequest("Expected a link");
      let url: URL;
      try { url = new URL(value.trim()); } catch { throw ApiError.badRequest("Enter a full link starting with https://"); }
      if (url.protocol !== "https:") throw ApiError.badRequest("Links must use https");
      const allowed = def.hosts ?? approvedHosts();
      if (!hostApproved(url.hostname, allowed)) throw ApiError.badRequest(`This link must point to ${allowed.join(" or ")}`);
      return url.toString();
    }
    case "email": {
      if (typeof value !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) throw ApiError.badRequest("Enter a valid email address");
      const email = value.trim().toLowerCase();
      if (!hostApproved(email.split("@")[1] ?? "")) throw ApiError.badRequest(`Email must use an approved domain (${approvedHosts().join(", ")})`);
      return email;
    }
    case "version":
      if (typeof value !== "string" || !/^\d{1,4}(\.\d{1,4}){0,2}$/.test(value.trim())) throw ApiError.badRequest("Use a version like 1.4.0");
      return value.trim();
    case "year":
      if (typeof value !== "string" && typeof value !== "number") throw ApiError.badRequest("Enter a year like 2026");
      if (!/^(19|20)\d{2}$/.test(String(value).trim())) throw ApiError.badRequest("Enter a year like 2026");
      return String(value).trim();
    case "phone": {
      if (typeof value !== "string") throw ApiError.badRequest("Enter a phone number");
      const phone = value.replace(/[\s()-]/g, "");
      if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw ApiError.badRequest("Use international format, e.g. +263771234567");
      return phone;
    }
    case "text": {
      if (typeof value !== "string") throw ApiError.badRequest("Expected text");
      const text = value.replace(/\s+/g, " ").trim();
      if (text.length > 160) throw ApiError.badRequest("Keep the notice to 160 characters");
      return text || null;
    }
  }
}

async function storedValues() {
  const rows = await prisma.platformSetting.findMany({
    where: { key: { in: [...definitions.keys(), "maintenance_mode"] } },
    select: { key: true, value: true, updatedAt: true },
  });
  return new Map(rows.map((r) => [r.key, r]));
}

/** Current value for each key, falling back to its default when unset or invalid. */
function resolve(rows: Awaited<ReturnType<typeof storedValues>>) {
  const out: Record<string, boolean | string | null> = {};
  for (const def of APP_CONFIG_DEFINITIONS) {
    const row = rows.get(def.key);
    let value: boolean | string | null = def.default;
    if (row) {
      try { value = normalizeAppConfigValue(def.key, row.value as unknown); } catch { value = def.default; }
    }
    out[def.key] = value;
  }
  return out;
}

/** Public payload for the apps. Contains no secrets and nothing tenant-specific. */
export async function getPublicAppConfig() {
  const rows = await storedValues();
  const v = resolve(rows);
  const updatedAt = [...rows.values()].reduce<Date | null>((max, r) => (!max || r.updatedAt > max ? r.updatedAt : max), null);
  return {
    schemaVersion: 1,
    features: {
      automation: v["app.automation_enabled"] as boolean,
      billing: v["app.billing_enabled"] as boolean,
      emailAuth: v["app.email_auth_enabled"] as boolean,
      googleSignIn: v["app.google_sign_in_enabled"] as boolean,
      appleSignIn: v["app.apple_sign_in_enabled"] as boolean,
    },
    links: {
      supportEmail: v["app.support_email"] as string,
      supportUrl: v["app.support_url"] as string,
      privacyUrl: v["app.privacy_url"] as string,
      termsUrl: v["app.terms_url"] as string,
      iosStoreUrl: (v["app.ios_store_url"] as string | null) ?? null,
      androidStoreUrl: (v["app.android_store_url"] as string | null) ?? null,
    },
    company: {
      websiteUrl: v["app.website_url"] as string,
      legalName: (v["app.company_legal_name"] as string | null) ?? null,
      registrationNumber: (v["app.company_registration_number"] as string | null) ?? null,
      address: (v["app.company_address"] as string | null) ?? null,
      copyrightHolder: v["app.copyright_holder"] as string,
      copyrightStartYear: Number(v["app.copyright_start_year"]),
    },
    social: {
      whatsappNumber: (v["app.whatsapp_number"] as string | null) ?? null,
      instagramUrl: (v["app.instagram_url"] as string | null) ?? null,
      facebookUrl: (v["app.facebook_url"] as string | null) ?? null,
      tiktokUrl: (v["app.tiktok_url"] as string | null) ?? null,
      linkedinUrl: (v["app.linkedin_url"] as string | null) ?? null,
    },
    app: {
      minSupportedVersion: (v["app.min_supported_version"] as string | null) ?? null,
      notice: (v["app.notice"] as string | null) ?? null,
      maintenance: rows.get("maintenance_mode")?.value === true,
    },
    updatedAt: updatedAt?.toISOString() ?? null,
  };
}

/** Admin view: every key with its definition, current value, and whether it's the default. */
export async function listAdminAppConfig() {
  const rows = await storedValues();
  const v = resolve(rows);
  return APP_CONFIG_DEFINITIONS.map((def) => ({
    key: def.key,
    kind: def.kind,
    label: def.label,
    description: def.description,
    value: v[def.key],
    defaultValue: def.default,
    isDefault: !rows.has(def.key),
    updatedAt: rows.get(def.key)?.updatedAt.toISOString() ?? null,
  }));
}

/** Validated, audited update. Setting and audit row commit together. */
export async function updateAdminAppConfig(actor: AdminAuditActor, key: string, rawValue: unknown, context: AdminAuditContext) {
  const value = normalizeAppConfigValue(key, rawValue);
  const def = definitions.get(key)!;
  return prisma.$transaction(async (tx) => {
    const current = await tx.platformSetting.findUnique({ where: { key } });
    const saved = value === null
      ? (current ? await tx.platformSetting.delete({ where: { key } }) : null)
      : await tx.platformSetting.upsert({
          where: { key },
          create: { key, value, description: def.description },
          update: { value },
        });
    await recordAdminAudit({
      actor,
      action: "APP_CONFIG_UPDATED",
      targetType: "app_config",
      targetId: key,
      oldValue: { value: current?.value ?? def.default },
      newValue: { value: value ?? def.default, reset: value === null },
      context,
    }, tx);
    return { key, value: value ?? def.default, isDefault: value === null || !saved };
  });
}
