import { prisma } from "./prisma.js";
import { encryptProviderCredential, decryptProviderCredential } from "./providerCredentials.js";

/**
 * Provider credentials a platform admin may set from the admin console
 * instead of a Render environment variable — so a key can be added or
 * rotated without a new mobile build or backend deploy. Only these exact
 * keys are accepted; anything else is rejected before it ever reaches
 * encryption or storage.
 */
export const PLATFORM_PROVIDER_SECRET_KEYS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_FROM_NUMBER",
  "TWILIO_MESSAGING_SERVICE_SID",
  "TWILIO_WHATSAPP_FROM",
] as const;

export type PlatformProviderSecretKey = (typeof PLATFORM_PROVIDER_SECRET_KEYS)[number];

export function isPlatformProviderSecretKey(key: string): key is PlatformProviderSecretKey {
  return (PLATFORM_PROVIDER_SECRET_KEYS as readonly string[]).includes(key);
}

export interface PlatformProviderSecretSummary {
  key: PlatformProviderSecretKey;
  configured: boolean;
  updatedAt: string | null;
  updatedByAdminId: string | null;
}

/**
 * Metadata only — the decrypted (or even encrypted) value is never returned
 * here. This is what the admin UI reads to render "Configured" / "Not set".
 */
export async function listPlatformProviderSecrets(): Promise<PlatformProviderSecretSummary[]> {
  const rows = await prisma.platformProviderSecret.findMany();
  const byKey = new Map(rows.map((row) => [row.key, row]));
  return PLATFORM_PROVIDER_SECRET_KEYS.map((key) => {
    const row = byKey.get(key);
    return {
      key,
      configured: Boolean(row),
      updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedByAdminId: row?.updatedByAdminId ?? null,
    };
  });
}

export async function setPlatformProviderSecret(key: PlatformProviderSecretKey, value: string, adminId: string): Promise<void> {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Value must not be empty");
  const encryptedValue = encryptProviderCredential(trimmed);
  await prisma.platformProviderSecret.upsert({
    where: { key },
    create: { key, encryptedValue, updatedByAdminId: adminId },
    update: { encryptedValue, updatedByAdminId: adminId },
  });
}

export async function clearPlatformProviderSecret(key: PlatformProviderSecretKey): Promise<void> {
  await prisma.platformProviderSecret.deleteMany({ where: { key } });
}

/**
 * Boot-time only. Decrypts every stored secret into a plain map so the AI
 * provider factories and the Twilio provider can prefer a DB-set value over
 * (or as a substitute for) the equivalent env var. Never expose this map or
 * its values outside the process — no route returns it.
 */
export async function loadPlatformProviderSecretOverrides(): Promise<Partial<Record<PlatformProviderSecretKey, string>>> {
  const rows = await prisma.platformProviderSecret.findMany();
  const overrides: Partial<Record<PlatformProviderSecretKey, string>> = {};
  for (const row of rows) {
    if (!isPlatformProviderSecretKey(row.key)) continue;
    try {
      overrides[row.key] = decryptProviderCredential(row.encryptedValue);
    } catch {
      // A corrupt/undecryptable row must never crash boot — treat it as
      // absent and fall back to the env var, same as if it were never set.
    }
  }
  return overrides;
}
