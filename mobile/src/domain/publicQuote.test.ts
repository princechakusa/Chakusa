import { describe, expect, it } from 'vitest';
import {
  canActOnQuote,
  canRetryQuote,
  documentTypeNoun,
  quoteErrorViewState,
  quoteStateDetail,
  quoteStateHeadline,
  viewStateFromQuoteResponse,
  type PublicQuoteResponse,
  type PublicQuoteState,
} from './publicQuote';

const response = (state: PublicQuoteState): PublicQuoteResponse => ({
  state,
  documentType: 'QUOTE',
  documentNumber: 'Q-2026-0001',
  currency: 'USD',
  expiresAt: null,
  business: { name: 'Jane’s Plumbing' },
  revision: {
    notes: null,
    terms: null,
    totals: { subtotal: '100.00', discountTotal: '0.00', taxTotal: '0.00', total: '100.00' },
    lineItems: [{ description: 'Labor', quantity: '2.00', unitPrice: '50.00', discountAmount: '0.00', taxable: false, lineTotal: '100.00' }],
  },
});

describe('publicQuote view state', () => {
  it('wraps a response into a ready view', () => {
    expect(viewStateFromQuoteResponse(response('open'))).toEqual({ kind: 'ready', details: response('open') });
  });

  it('maps a not-found error to invalid, everything else to network-error', () => {
    expect(quoteErrorViewState('not-found')).toEqual({ kind: 'invalid' });
    expect(quoteErrorViewState('network')).toEqual({ kind: 'network-error' });
    expect(quoteErrorViewState('server')).toEqual({ kind: 'network-error' });
  });

  it('only allows actions on an open quote', () => {
    expect(canActOnQuote(viewStateFromQuoteResponse(response('open')))).toBe(true);
    for (const state of ['accepted', 'declined', 'canceled', 'expired'] as const) {
      expect(canActOnQuote(viewStateFromQuoteResponse(response(state)))).toBe(false);
    }
    expect(canActOnQuote({ kind: 'loading' })).toBe(false);
    expect(canActOnQuote({ kind: 'acting', details: response('open'), action: 'accept' })).toBe(false);
  });

  it('canRetryQuote is only true for a network error', () => {
    expect(canRetryQuote({ kind: 'network-error' })).toBe(true);
    expect(canRetryQuote({ kind: 'invalid' })).toBe(false);
    expect(canRetryQuote(viewStateFromQuoteResponse(response('open')))).toBe(false);
  });
});

describe('publicQuote copy', () => {
  it('nouns the document type', () => {
    expect(documentTypeNoun('QUOTE')).toBe('quote');
    expect(documentTypeNoun('ESTIMATE')).toBe('estimate');
  });
  it('headlines every state without leaking internal jargon', () => {
    expect(quoteStateHeadline('open', 'QUOTE')).toBe('Review your quote');
    expect(quoteStateHeadline('accepted', 'ESTIMATE')).toBe('You accepted this estimate');
    expect(quoteStateHeadline('canceled', 'QUOTE')).toBe('This quote was withdrawn');
    expect(quoteStateHeadline('expired', 'QUOTE')).toBe('This quote has expired');
    expect(quoteStateHeadline('declined', 'QUOTE')).toBe('You declined this quote');
  });
  it('provides a detail line for every state', () => {
    for (const state of ['open', 'accepted', 'declined', 'canceled', 'expired'] as const) {
      expect(quoteStateDetail(state)).toBeTruthy();
    }
  });
  it('never describes acceptance as a signature', () => {
    for (const state of ['open', 'accepted', 'declined', 'canceled', 'expired'] as const) {
      expect(quoteStateDetail(state)?.toLowerCase()).not.toContain('signature');
      expect(quoteStateHeadline(state, 'QUOTE').toLowerCase()).not.toContain('sign');
    }
  });
});
