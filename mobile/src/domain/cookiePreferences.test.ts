import { describe, expect, it } from 'vitest';
import { ACCEPT_ALL_COOKIE_PREFERENCES, cookieConsentSource, DEFAULT_COOKIE_PREFERENCES, REJECT_OPTIONAL_COOKIE_PREFERENCES } from './cookiePreferences';

describe('cookie preferences domain', () => {
  it('keeps functional always on in the default, pre-choice state', () => {
    expect(DEFAULT_COOKIE_PREFERENCES).toEqual({ analytics: false, functional: true, marketing: false });
  });

  it('labels every analytics+marketing combination as accept_all, reject_optional, or customize', () => {
    expect(cookieConsentSource(ACCEPT_ALL_COOKIE_PREFERENCES)).toBe('accept_all');
    expect(cookieConsentSource(REJECT_OPTIONAL_COOKIE_PREFERENCES)).toBe('reject_optional');
    expect(cookieConsentSource({ analytics: true, functional: true, marketing: false })).toBe('customize');
    expect(cookieConsentSource({ analytics: false, functional: true, marketing: true })).toBe('customize');
  });
});
