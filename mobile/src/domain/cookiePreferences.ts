export interface CookiePreferences {
  analytics: boolean;
  functional: boolean;
  marketing: boolean;
}

/**
 * Functional is treated as always-on rather than a fourth toggle: it
 * covers what Chakusa needs to keep a session working at all, the same
 * "strictly necessary" category the website's Cookie Policy describes as
 * not requiring a choice. Analytics and marketing are the two real
 * choices this screen offers.
 */
export const DEFAULT_COOKIE_PREFERENCES: CookiePreferences = { analytics: false, functional: true, marketing: false };
export const ACCEPT_ALL_COOKIE_PREFERENCES: CookiePreferences = { analytics: true, functional: true, marketing: true };
export const REJECT_OPTIONAL_COOKIE_PREFERENCES: CookiePreferences = { analytics: false, functional: true, marketing: false };

export type CookieConsentSource = 'accept_all' | 'reject_optional' | 'customize';

export function cookieConsentSource(preferences: CookiePreferences): CookieConsentSource {
  if (preferences.analytics && preferences.marketing) return 'accept_all';
  if (!preferences.analytics && !preferences.marketing) return 'reject_optional';
  return 'customize';
}
