export interface PublicReviewDetails {
  business: { name: string };
  serviceName: string | null;
  googleReviewLink: string | null;
}

export type PublicReviewResponse =
  | ({ state: 'open' | 'submitted' } & PublicReviewDetails)
  | { state: 'expired' };

export type PublicFeedbackViewState =
  | { kind: 'loading' }
  | { kind: 'open'; details: PublicReviewDetails }
  | { kind: 'submitting'; details: PublicReviewDetails }
  | { kind: 'submitted'; details: PublicReviewDetails }
  | { kind: 'expired' }
  | { kind: 'invalid' }
  | { kind: 'network-error' };

export function publicReviewTokenFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/r\/([^/]+)\/?$/);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return null; }
}

export function viewStateFromResponse(response: PublicReviewResponse): PublicFeedbackViewState {
  if (response.state === 'expired') return { kind: 'expired' };
  return { kind: response.state, details: { business: response.business, serviceName: response.serviceName, googleReviewLink: response.googleReviewLink } };
}

export function canSubmitFeedback(state: PublicFeedbackViewState, rating: number) {
  return state.kind === 'open' && rating >= 1 && rating <= 5;
}

export function errorViewState(kind: string): PublicFeedbackViewState {
  return kind === 'not-found' ? { kind: 'invalid' } : { kind: 'network-error' };
}

export function submittedViewState(state: 'submitted' | 'expired', details: PublicReviewDetails): PublicFeedbackViewState {
  return state === 'expired' ? { kind: 'expired' } : { kind: 'submitted', details };
}

export function canRetryFeedback(state: PublicFeedbackViewState) {
  return state.kind === 'network-error';
}
