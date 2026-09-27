// Runtime app configuration, fetched from the API's public /app-config and
// edited by platform admins in the admin console, so switches and links can
// change without a new build. Pure functions only (tested); fetching and
// caching live in services/runtimeConfig.ts.
//
// Merge rules against the build-time values in config.ts:
// - Product switches (automation, billing, email auth): the server value
//   wins, so admins can turn them on or off after release.
// - Native sign-in (Google, Apple): server can only HIDE a provider. A build
//   that lacks the native configuration never shows it.
// - Links: server value wins only if it's a valid https URL / email;
//   otherwise the build default stays.
// - Nothing here grants access: the backend enforces every action.

export interface BuildDefaults {
  automation: boolean;
  billing: boolean;
  emailAuth: boolean;
  googleSignIn: boolean;
  appleSignIn: boolean;
  supportEmail: string;
  supportUrl: string;
  privacyUrl: string;
  termsUrl: string;
}

export interface RemoteAppConfig {
  features: { automation?: boolean; billing?: boolean; emailAuth?: boolean; googleSignIn?: boolean; appleSignIn?: boolean };
  links: { supportEmail?: string; supportUrl?: string; privacyUrl?: string; termsUrl?: string; iosStoreUrl?: string | null; androidStoreUrl?: string | null };
  app: { minSupportedVersion?: string | null; notice?: string | null; maintenance?: boolean };
  company?: { websiteUrl?: string; legalName?: string | null; registrationNumber?: string | null; address?: string | null; copyrightHolder?: string; copyrightStartYear?: number };
  social?: { whatsappNumber?: string | null; instagramUrl?: string | null; facebookUrl?: string | null; tiktokUrl?: string | null; linkedinUrl?: string | null };
  updatedAt?: string | null;
}

export interface CompanyInfo {
  websiteUrl: string;
  legalName: string | null;
  registrationNumber: string | null;
  address: string | null;
  copyrightHolder: string;
  copyrightStartYear: number;
  whatsappUrl: string | null;
  socialLinks: { label: string; url: string }[];
}

export interface EffectiveConfig extends BuildDefaults {
  iosStoreUrl: string | null;
  androidStoreUrl: string | null;
  minSupportedVersion: string | null;
  notice: string | null;
  maintenance: boolean;
  company: CompanyInfo;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined);
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

export function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try { const url = new URL(value.trim()); return url.protocol === 'https:' ? url.toString() : null; } catch { return null; }
}

export function validEmail(value: unknown): string | null {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? value.trim() : null;
}

/** Parses an untrusted payload (network or cache). Returns null if it isn't a v1 config. */
export function parseRemoteConfig(raw: unknown): RemoteAppConfig | null {
  if (!isObj(raw) || raw.schemaVersion !== 1) return null;
  const f = isObj(raw.features) ? raw.features : {};
  const l = isObj(raw.links) ? raw.links : {};
  const a = isObj(raw.app) ? raw.app : {};
  return {
    features: { automation: bool(f.automation), billing: bool(f.billing), emailAuth: bool(f.emailAuth), googleSignIn: bool(f.googleSignIn), appleSignIn: bool(f.appleSignIn) },
    links: { supportEmail: str(l.supportEmail), supportUrl: str(l.supportUrl), privacyUrl: str(l.privacyUrl), termsUrl: str(l.termsUrl), iosStoreUrl: str(l.iosStoreUrl) ?? null, androidStoreUrl: str(l.androidStoreUrl) ?? null },
    app: { minSupportedVersion: str(a.minSupportedVersion) ?? null, notice: str(a.notice) ?? null, maintenance: bool(a.maintenance) ?? false },
    company: isObj(raw.company) ? { websiteUrl: str(raw.company.websiteUrl), legalName: str(raw.company.legalName) ?? null, registrationNumber: str(raw.company.registrationNumber) ?? null, address: str(raw.company.address) ?? null, copyrightHolder: str(raw.company.copyrightHolder), copyrightStartYear: typeof raw.company.copyrightStartYear === 'number' ? raw.company.copyrightStartYear : undefined } : undefined,
    social: isObj(raw.social) ? { whatsappNumber: str(raw.social.whatsappNumber) ?? null, instagramUrl: str(raw.social.instagramUrl) ?? null, facebookUrl: str(raw.social.facebookUrl) ?? null, tiktokUrl: str(raw.social.tiktokUrl) ?? null, linkedinUrl: str(raw.social.linkedinUrl) ?? null } : undefined,
    updatedAt: str(raw.updatedAt) ?? null,
  };
}

export function mergeConfig(build: BuildDefaults, remote: RemoteAppConfig | null): EffectiveConfig {
  const f = remote?.features ?? {};
  const l = remote?.links ?? {};
  const a = remote?.app ?? {};
  const notice = typeof a.notice === 'string' ? a.notice.trim().slice(0, 160) : '';
  return {
    automation: f.automation ?? build.automation,
    billing: f.billing ?? build.billing,
    emailAuth: f.emailAuth ?? build.emailAuth,
    googleSignIn: build.googleSignIn && f.googleSignIn !== false,
    appleSignIn: build.appleSignIn && f.appleSignIn !== false,
    supportEmail: validEmail(l.supportEmail) ?? build.supportEmail,
    supportUrl: httpsUrl(l.supportUrl) ?? build.supportUrl,
    privacyUrl: httpsUrl(l.privacyUrl) ?? build.privacyUrl,
    termsUrl: httpsUrl(l.termsUrl) ?? build.termsUrl,
    iosStoreUrl: httpsUrl(l.iosStoreUrl),
    androidStoreUrl: httpsUrl(l.androidStoreUrl),
    minSupportedVersion: a.minSupportedVersion ?? null,
    notice: notice || null,
    maintenance: a.maintenance === true,
    company: companyInfo(remote),
  };
}

const DEFAULT_WEBSITE = 'https://chakusarecovery.com';

function companyInfo(remote: RemoteAppConfig | null): CompanyInfo {
  const c = remote?.company ?? {};
  const s = remote?.social ?? {};
  const year = typeof c.copyrightStartYear === 'number' && c.copyrightStartYear >= 1900 && c.copyrightStartYear <= 2100 ? c.copyrightStartYear : 2026;
  const phone = typeof s.whatsappNumber === 'string' && /^\+\d{8,15}$/.test(s.whatsappNumber) ? s.whatsappNumber : null;
  const socials: [string, string | null | undefined][] = [['Instagram', s.instagramUrl], ['Facebook', s.facebookUrl], ['TikTok', s.tiktokUrl], ['LinkedIn', s.linkedinUrl]];
  return {
    websiteUrl: httpsUrl(c.websiteUrl) ?? DEFAULT_WEBSITE,
    legalName: c.legalName?.trim() || null,
    registrationNumber: c.registrationNumber?.trim() || null,
    address: c.address?.trim() || null,
    copyrightHolder: c.copyrightHolder?.trim() || 'Chakusa',
    copyrightStartYear: year,
    whatsappUrl: phone ? `https://wa.me/${phone.slice(1)}` : null,
    socialLinks: socials.flatMap(([label, url]) => { const u = httpsUrl(url); return u ? [{ label, url: u }] : []; }),
  };
}

/** "© 2026 Chakusa" or "© 2026–2027 Chakusa", computed from the current year. */
export function copyrightLine(info: Pick<CompanyInfo, 'copyrightHolder' | 'copyrightStartYear'>, now = new Date()): string {
  const year = now.getFullYear();
  const years = info.copyrightStartYear >= year ? String(year) : `${info.copyrightStartYear}–${year}`;
  return `© ${years} ${info.copyrightHolder}`;
}

/** Numeric dotted-version compare; missing parts count as 0. Non-numeric input compares as equal. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10));
  const pb = b.split('.').map((n) => Number.parseInt(n, 10));
  if ([...pa, ...pb].some((n) => Number.isNaN(n))) return 0;
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** True when this installed version is older than the admin's minimum. Unknown versions are never blocked. */
export function updateRequired(installed: string | null | undefined, minimum: string | null): boolean {
  if (!installed || !minimum) return false;
  return compareVersions(installed, minimum) < 0;
}
