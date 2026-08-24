export interface PublicBusinessProfileDetails {
  name: string;
  industry: string | null;
  phone: string | null;
  description: string | null;
  googleReviewLink: string | null;
  workingHours: Record<string, unknown> | null;
  defaultServices: string[] | null;
  currency: string | null;
  services: { id: string; name: string; description: string | null; durationMinutes: number; price: number | null; depositAmount: number | null }[];
}

export type PublicBusinessProfileViewState =
  | { kind: 'loading' }
  | { kind: 'loaded'; details: PublicBusinessProfileDetails }
  | { kind: 'submitting'; details: PublicBusinessProfileDetails }
  | { kind: 'submitted'; details: PublicBusinessProfileDetails }
  | { kind: 'invalid' }
  | { kind: 'network-error' };

export function errorViewState(kind: string): PublicBusinessProfileViewState {
  return kind === 'not-found' ? { kind: 'invalid' } : { kind: 'network-error' };
}

export function canSubmitContact(state: PublicBusinessProfileViewState, name: string, phone: string) {
  return state.kind === 'loaded' && name.trim().length > 0 && phone.trim().length > 0;
}

export function workingHoursSummary(workingHours: Record<string, unknown> | null): string | null {
  const summary = workingHours?.summary;
  return typeof summary === 'string' && summary.trim().length > 0 ? summary : null;
}

export function publicBusinessProfileUrl(slug: string, referredByCustomerId?: string): string {
  const base = `https://chakusa.com/b/${encodeURIComponent(slug)}`;
  return referredByCustomerId ? `${base}?ref=${encodeURIComponent(referredByCustomerId)}` : base;
}

/** Pre-filled WhatsApp greeting for the public profile's "Message on WhatsApp" button — a visitor can still edit it before sending. */
export function publicProfileWhatsAppGreeting(businessName: string): string {
  return `Hi ${businessName}, I found your page on Chakusa and I'd like to know more.`;
}

/** Share-sheet copy for a visitor sharing the profile onward (distinct from the owner's own share copy in BusinessSettingsScreen). */
export function publicProfileShareMessage(businessName: string, url: string): string {
  return `Check out ${businessName} on Chakusa: ${url}`;
}
