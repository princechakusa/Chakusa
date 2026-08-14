import { describe, expect, it } from 'vitest';
import { APPROVED_PUBLIC_DESTINATIONS, deletionConfirmationCopy, formatAppVersion, legalDestination, proDisclosureReady, supportDestination } from './trustSettings';

describe('trust and settings configuration', () => {
  it('accepts only configured HTTPS legal links', () => { expect(legalDestination('https://chakusa.test/privacy')).toEqual({ kind: 'url', value: 'https://chakusa.test/privacy' }); expect(legalDestination('http://unsafe.test')).toBeNull(); expect(legalDestination()).toBeNull(); });
  it('prefers a valid support URL and otherwise accepts a valid email', () => { expect(supportDestination('https://help.test', 'team@test.com')?.kind).toBe('url'); expect(supportDestination(undefined, 'team@test.com')).toEqual({ kind: 'email', value: 'team@test.com' }); expect(supportDestination(undefined, 'not-email')).toBeNull(); });
  it('formats authoritative version and optional build values', () => { expect(formatAppVersion('1.2.3')).toBe('Version 1.2.3'); expect(formatAppVersion('1.2.3', 42)).toBe('Version 1.2.3 (42)'); expect(formatAppVersion()).toBe('Version unavailable'); });
  it('requires both legal destinations for future purchase disclosure', () => { const link = legalDestination('https://legal.test'); expect(proDisclosureReady(link, link)).toBe(true); expect(proDisclosureReady(link, null)).toBe(false); });
  it('uses authoritative business context in destructive confirmation copy', () => { expect(deletionConfirmationCopy('Safi Salon')).toContain('Safi Salon'); expect(deletionConfirmationCopy()).not.toContain('undefined'); });
  it('uses the approved public legal and support identities', () => { expect(APPROVED_PUBLIC_DESTINATIONS).toEqual({ privacy: 'https://chakusa.com/privacy', terms: 'https://chakusa.com/terms', support: 'https://chakusa.com/support', deleteAccount: 'https://chakusa.com/delete-account', supportEmail: 'support@chakusa.com' }); });
});
