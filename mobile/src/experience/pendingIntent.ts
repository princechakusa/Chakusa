import { loyaltyNotificationTarget } from '../customer/domain/customerLoyalty';
import { parseCustomerDeepLink } from '../customer/domain/customerNav';
import {
  classifyDeepLinkExperience,
  classifyNotificationExperience,
  Experience,
  isExperience,
} from './experience';

// PROGRAM 2 LOOP 10: pending-intent handoff — the PURE half (no RN / no
// expo imports so it is unit-testable). Persistence lives in
// `pendingIntentStorage.ts`.
//
// A PendingIntent is NEVER authorization. It carries only an already
// validated + allowlisted destination (a known route name + flat string
// params) plus which experience it belongs to and where it came from. No
// token, no session, no raw URL, no notification body text. The backend
// and the destination screen stay authoritative.

export const PENDING_INTENT_KEY = 'chakusa.pending-intent.v1';
export const PENDING_INTENT_TTL_MS = 15 * 60 * 1000; // 15 min — covers an OAuth round trip.
const SCHEMA_VERSION = 1;

export type IntentSource = 'deep-link' | 'notification';

export interface PendingIntent {
  experience: Experience;
  source: IntentSource;
  /** A known route name in that experience's navigator, or null = "just enter this experience". */
  route: string | null;
  /** Flat string params for the route. Never nested, never sensitive. */
  params?: Record<string, string>;
  createdAt: number;
}

// --- Normalisation -------------------------------------------------------

function flattenParams(params: Record<string, unknown> | undefined): Record<string, string> | undefined {
  if (!params) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' && value.length <= 256) out[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = String(value);
  }
  return Object.keys(out).length ? out : undefined;
}

// Business deep links the app can actually navigate to (BusinessRoot
// `linking` config). Anything else that classifies as business becomes a
// route-less intent: switch into business, land on the safe default.
function businessDeepLinkRoute(raw: string): { route: string | null; params?: Record<string, string> } {
  const path = raw.trim().replace(/^chakusa:\/\//i, '').replace(/^https?:\/\/[^/]+/i, '').replace(/[?#].*$/, '').replace(/^\/+/, '').replace(/\/+$/, '');
  const segments = path.split('/').filter(Boolean);
  if (segments[0]?.toLowerCase() === 'reset-password') return { route: 'ResetPassword' };
  if (segments[0]?.toLowerCase() === 'team-invite' && segments[1]) return { route: 'TeamInvite', params: { token: segments[1] } };
  return { route: null };
}

/**
 * Turn a raw deep link into a validated PendingIntent, or null when it
 * does not map to a known destination. Customer classification runs
 * through Loop 7/8's `parseCustomerDeepLink` (which rejects business-owner
 * routes), so the customer boundary guard is not weakened.
 */
export function normalizeDeepLinkIntent(raw: string | null | undefined, now: number = Date.now()): PendingIntent | null {
  if (!raw || !raw.trim()) return null;
  const experience = classifyDeepLinkExperience(raw);
  if (!experience) return null;

  if (experience === 'customer') {
    const parsed = parseCustomerDeepLink(raw);
    if (!parsed) return null;
    return { experience, source: 'deep-link', route: parsed.route, params: flattenParams(parsed.params), createdAt: now };
  }
  const { route, params } = businessDeepLinkRoute(raw);
  return { experience, source: 'deep-link', route, params, createdAt: now };
}

/**
 * Turn a structured notification payload into a validated PendingIntent.
 * Routing uses ONLY structured fields (`data.experience`, `data.category`,
 * `data.loyaltyKind`, `data.deepLink`) — never the title or body. Unknown
 * payloads → null (no privileged navigation).
 */
export function normalizeNotificationIntent(data: Record<string, unknown> | null | undefined, now: number = Date.now()): PendingIntent | null {
  if (!data) return null;
  const experience = classifyNotificationExperience(data);
  if (!experience) return null;

  if (typeof data.deepLink === 'string') {
    const viaLink = normalizeDeepLinkIntent(data.deepLink, now);
    if (viaLink && viaLink.experience === experience) return { ...viaLink, source: 'notification' };
  }

  if (experience === 'customer') {
    if (data.category === 'loyalty') {
      const target = loyaltyNotificationTarget({
        category: 'loyalty',
        businessId: typeof data.businessId === 'string' ? data.businessId : null,
        data,
      });
      if (target.route === 'CustomerLoyaltyBusiness') {
        return { experience, source: 'notification', route: 'CustomerLoyaltyBusiness', params: { businessId: target.businessId }, createdAt: now };
      }
      return { experience, source: 'notification', route: target.route, createdAt: now };
    }
    return { experience, source: 'notification', route: null, createdAt: now };
  }

  // Business notification: enter business; the business NotificationTapHandler
  // routes the same response precisely once mounted.
  return { experience, source: 'notification', route: null, createdAt: now };
}

// --- Serialisation -----------------------------------------------------

interface StoredShape {
  v: number;
  experience: string;
  source: string;
  route: string | null;
  params?: Record<string, string>;
  createdAt: number;
}

export function serializePendingIntent(intent: PendingIntent): string {
  const shape: StoredShape = {
    v: SCHEMA_VERSION,
    experience: intent.experience,
    source: intent.source,
    route: intent.route,
    params: intent.params,
    createdAt: intent.createdAt,
  };
  return JSON.stringify(shape);
}

export function parsePendingIntent(raw: string | null | undefined, now: number = Date.now()): PendingIntent | null {
  if (!raw) return null;
  let shape: unknown;
  try { shape = JSON.parse(raw); } catch { return null; }
  if (!shape || typeof shape !== 'object') return null;
  const s = shape as Partial<StoredShape>;
  if (s.v !== SCHEMA_VERSION) return null;
  if (!isExperience(s.experience)) return null;
  if (s.source !== 'deep-link' && s.source !== 'notification') return null;
  if (s.route !== null && typeof s.route !== 'string') return null;
  if (typeof s.createdAt !== 'number' || !Number.isFinite(s.createdAt)) return null;
  if (now - s.createdAt > PENDING_INTENT_TTL_MS || now - s.createdAt < -60_000) return null; // expired / clock-skew garbage
  const params = flattenParams(s.params as Record<string, unknown> | undefined);
  return { experience: s.experience, source: s.source, route: s.route, params, createdAt: s.createdAt };
}
