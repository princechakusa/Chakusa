import { parseCustomerDeepLink } from '../customer/domain/customerNav';

// PROGRAM 2 LOOP 9: pure logic for the runtime experience router that now
// sits above the two already-isolated shells (BusinessRoot / CustomerRoot).
//
// This module holds NO tokens and performs NO I/O. It only decides which
// experience to show given facts the router gathers (a stored preference,
// whether each session store has something, an incoming deep link). The
// two security boundaries are untouched — a customer session is never a
// business session and vice-versa.

export type Experience = 'customer' | 'business';
export type ExperienceOrUnselected = Experience | 'unselected';

/** The persisted last-used experience. Untrusted local UI state — never authorization. */
export const EXPERIENCE_PREFERENCE_KEY = 'chakusa.experience.v1';

export function isExperience(value: unknown): value is Experience {
  return value === 'customer' || value === 'business';
}

/** Normalises whatever came back from storage; anything unrecognised → 'unselected'. */
export function coerceExperiencePreference(raw: string | null | undefined): ExperienceOrUnselected {
  const trimmed = raw?.trim().toLowerCase();
  return isExperience(trimmed) ? trimmed : 'unselected';
}

export interface ExperienceResolutionInput {
  /** Value read from EXPERIENCE_PREFERENCE_KEY (already coerced). */
  preference: ExperienceOrUnselected;
  /** Whether the business session store (`chakusa.auth.session.v2`) holds a session. */
  hasBusinessSession: boolean;
  /** Whether the customer session store (`chakusa.customer.session.v1`) holds a session. */
  hasCustomerSession: boolean;
  /** Experience implied by a trusted incoming deep link / notification, if any. */
  deepLinkExperience?: Experience | null;
  /** Build-time dev override (EXPO_PUBLIC_APP_VARIANT). Never set in production. */
  forced?: Experience | null;
}

/**
 * The cold-start decision. Order of precedence:
 *  1. dev `forced` override (internal builds only)
 *  2. a trusted deep link that names an experience
 *  3. the saved preference
 *  4. migration for existing users: exactly one session present → that experience
 *  5. otherwise → 'unselected' (show the selector)
 *
 * An existing logged-in business owner (business session, no preference,
 * no customer session) resolves to 'business' — they never see the
 * selector on upgrade.
 */
export function resolveInitialExperience(input: ExperienceResolutionInput): ExperienceOrUnselected {
  if (input.forced) return input.forced;
  if (input.deepLinkExperience) return input.deepLinkExperience;
  if (input.preference !== 'unselected') return input.preference;
  if (input.hasBusinessSession && !input.hasCustomerSession) return 'business';
  if (input.hasCustomerSession && !input.hasBusinessSession) return 'customer';
  // Both or neither, and nothing else to go on: let the user choose.
  return 'unselected';
}

/** Does the target experience already have a session the router can restore? */
export function hasSessionFor(experience: Experience, input: Pick<ExperienceResolutionInput, 'hasBusinessSession' | 'hasCustomerSession'>): boolean {
  return experience === 'business' ? input.hasBusinessSession : input.hasCustomerSession;
}

// --- Deep-link classification ----------------------------------------------

// Business-owner deep links the app already understands (App.tsx `linking`
// + AppNavigator + the web-only public routes). Kept as an allowlist so an
// arbitrary string can never select the business experience.
const BUSINESS_LINK_HEADS = new Set([
  'reset-password', 'team-invite', 'dashboard', 'calendar', 'leads', 'lead',
  'reviews', 'review', 'customers', 'customer', 'settings', 'account',
  'automation', 'insights', 'team', 'business-settings', 'services',
  'feedback', 'document', 'b', 'manage',
]);

function linkHead(raw: string): string {
  let path = raw.trim().replace(/^chakusa:\/\//i, '').replace(/^https?:\/\/[^/]+/i, '');
  path = path.replace(/[?#].*$/, '').replace(/^\/+/, '').replace(/\/+$/, '');
  return path.split('/').filter(Boolean)[0]?.toLowerCase() ?? '';
}

/**
 * Which experience a deep link belongs to, or null when it is unknown /
 * malformed / ambiguous. Customer classification reuses Loop 7/8's
 * `parseCustomerDeepLink` (which itself refuses business-owner routes), so
 * the customer boundary guard is never weakened here.
 */
export function classifyDeepLinkExperience(raw: string | null | undefined): Experience | null {
  if (!raw || !raw.trim()) return null;
  if (parseCustomerDeepLink(raw)) return 'customer';
  return BUSINESS_LINK_HEADS.has(linkHead(raw)) ? 'business' : null;
}

// --- Notification classification -----------------------------------------

// Customer notification categories (see mobile apiTypes CustomerNotificationCategory
// + backend NOTIFICATION_CATEGORIES). Business notifications use their own
// payload `type`s and are treated as business by default.
const CUSTOMER_NOTIFICATION_CATEGORIES = new Set([
  'booking_update', 'ai_reply', 'promotion', 'review_reminder',
  'appointment_reminder', 'loyalty', 'legal_update', 'message',
]);

/**
 * Which experience a notification belongs to. `data.experience` wins if
 * present and valid; otherwise a known customer `data.category` → customer;
 * otherwise null (caller stays where it is rather than guessing from
 * title/body text).
 */
export function classifyNotificationExperience(data: Record<string, unknown> | null | undefined): Experience | null {
  if (!data) return null;
  if (isExperience(data.experience)) return data.experience;
  const category = typeof data.category === 'string' ? data.category : '';
  if (category === 'loyalty' || category === 'booking_update' || category === 'ai_reply') return 'customer';
  if (CUSTOMER_NOTIFICATION_CATEGORIES.has(category)) return 'customer';
  return null;
}
