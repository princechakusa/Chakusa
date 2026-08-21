export interface PublicBusinessProfileDetails {
  name: string;
  industry: string | null;
  phone: string | null;
  googleReviewLink: string | null;
  workingHours: Record<string, unknown> | null;
  defaultServices: string[] | null;
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
