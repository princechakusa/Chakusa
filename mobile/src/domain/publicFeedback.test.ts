import { describe, expect, it } from 'vitest';
import { canRetryFeedback, canSubmitFeedback, errorViewState, publicReviewTokenFromPath, submittedViewState, viewStateFromResponse } from './publicFeedback';

const details = { business: { name: 'Safi Salon' }, serviceName: 'Hair styling', googleReviewLink: 'https://google.example/review' };

describe('public feedback domain', () => {
  it('recognizes only the public review route without logging or persisting its token', () => { expect(publicReviewTokenFromPath('/r/opaque-token')).toBe('opaque-token'); expect(publicReviewTokenFromPath('/r/opaque%20token/')).toBe('opaque token'); expect(publicReviewTokenFromPath('/dashboard')).toBeNull(); expect(publicReviewTokenFromPath('/r/bad/extra')).toBeNull(); });
  it('maps open, submitted, and expired responses', () => { expect(viewStateFromResponse({ state: 'open', ...details })).toEqual({ kind: 'open', details }); expect(viewStateFromResponse({ state: 'submitted', ...details })).toEqual({ kind: 'submitted', details }); expect(viewStateFromResponse({ state: 'expired' })).toEqual({ kind: 'expired' }); });
  it('requires an active rating and blocks submitting or terminal states', () => { const open = viewStateFromResponse({ state: 'open', ...details }); expect(canSubmitFeedback(open, 0)).toBe(false); expect(canSubmitFeedback(open, 1)).toBe(true); expect(canSubmitFeedback(open, 5)).toBe(true); expect(canSubmitFeedback({ kind: 'submitting', details }, 5)).toBe(false); expect(canSubmitFeedback({ kind: 'submitted', details }, 5)).toBe(false); });
  it('maps submit success and idempotent success to the terminal thank-you state', () => { expect(submittedViewState('submitted', details)).toEqual({ kind: 'submitted', details }); expect(submittedViewState('expired', details)).toEqual({ kind: 'expired' }); });
  it('keeps not-found generic and makes network failures retryable', () => { expect(errorViewState('not-found')).toEqual({ kind: 'invalid' }); const network = errorViewState('network'); expect(network).toEqual({ kind: 'network-error' }); expect(canRetryFeedback(network)).toBe(true); expect(canRetryFeedback({ kind: 'invalid' })).toBe(false); });
  it.each([1, 2, 3, 4, 5])('keeps the Google review link available at rating %s', rating => { const open = viewStateFromResponse({ state: 'open', ...details }); expect(canSubmitFeedback(open, rating)).toBe(true); expect(open.kind === 'open' && open.details.googleReviewLink).toBe(details.googleReviewLink); });
});
