import { describe, expect, it } from 'vitest';
import { hasPendingLegalAcceptance, legalDocumentLabel, withoutAccepted } from './legalAcceptance';

const pending = [
  { type: 'TERMS_OF_SERVICE' as const, currentVersionId: 'v-tos', currentVersion: 2 },
  { type: 'PRIVACY_POLICY' as const, currentVersionId: 'v-privacy', currentVersion: 1 },
];

describe('legal acceptance domain', () => {
  it('treats an empty pending list as nothing left to accept', () => {
    expect(hasPendingLegalAcceptance([])).toBe(false);
    expect(hasPendingLegalAcceptance(pending)).toBe(true);
  });

  it('labels every document type in plain language', () => {
    expect(legalDocumentLabel('TERMS_OF_SERVICE')).toBe('Terms of Service');
    expect(legalDocumentLabel('PRIVACY_POLICY')).toBe('Privacy Policy');
    expect(legalDocumentLabel('COOKIE_POLICY')).toBe('Cookie Policy');
    expect(legalDocumentLabel('AI_DISCLOSURE')).toBe('AI Disclosure');
  });

  it('drops only the accepted type from the pending list, keeping the rest untouched', () => {
    const remaining = withoutAccepted(pending, 'TERMS_OF_SERVICE');
    expect(remaining).toEqual([pending[1]]);
    expect(withoutAccepted(pending, 'AI_DISCLOSURE')).toEqual(pending);
  });
});
