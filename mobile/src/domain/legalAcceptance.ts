import { LegalAcceptanceStatusDto, LegalDocumentType } from '../apiTypes';

export type PendingLegalDocument = LegalAcceptanceStatusDto['pending'][number];

export function hasPendingLegalAcceptance(pending: PendingLegalDocument[]): boolean {
  return pending.length > 0;
}

export function legalDocumentLabel(type: LegalDocumentType): string {
  switch (type) {
    case 'TERMS_OF_SERVICE': return 'Terms of Service';
    case 'PRIVACY_POLICY': return 'Privacy Policy';
    case 'COOKIE_POLICY': return 'Cookie Policy';
    case 'AI_DISCLOSURE': return 'AI Disclosure';
  }
}

/** Drops an accepted type from the pending list without waiting on a server round-trip. */
export function withoutAccepted(pending: PendingLegalDocument[], type: LegalDocumentType): PendingLegalDocument[] {
  return pending.filter(item => item.type !== type);
}
