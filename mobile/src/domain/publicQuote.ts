// PROGRAM 3 LOOP 3I: pure view-state logic for the account-less customer
// quote page (GET/POST /public/quotes/:token). No networking here. The
// bearer token itself lives only in the screen + service layer and is
// never placed in analytics or logs.

export type PublicQuoteState = 'open' | 'accepted' | 'declined' | 'canceled' | 'expired';

export interface PublicQuoteLineItem {
  description: string;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  taxable: boolean;
  lineTotal: string;
}

export interface PublicQuoteDetails {
  state: PublicQuoteState;
  documentType: 'QUOTE' | 'ESTIMATE';
  documentNumber: string;
  currency: string;
  expiresAt: string | null;
  business: { name: string };
  revision: {
    notes: string | null;
    terms: string | null;
    totals: { subtotal: string; discountTotal: string; taxTotal: string; total: string };
    lineItems: PublicQuoteLineItem[];
  };
}

export type PublicQuoteResponse = PublicQuoteDetails;

export type PublicQuoteViewState =
  | { kind: 'loading' }
  | { kind: 'ready'; details: PublicQuoteDetails }
  | { kind: 'acting'; details: PublicQuoteDetails; action: 'accept' | 'decline' }
  | { kind: 'invalid' }
  | { kind: 'network-error' };

export function viewStateFromQuoteResponse(response: PublicQuoteResponse): PublicQuoteViewState {
  return { kind: 'ready', details: response };
}

export function quoteErrorViewState(kind: string): PublicQuoteViewState {
  return kind === 'not-found' ? { kind: 'invalid' } : { kind: 'network-error' };
}

/** Accept / decline are offered only while the quote is live ("open"). */
export function canActOnQuote(state: PublicQuoteViewState): state is Extract<PublicQuoteViewState, { kind: 'ready' }> {
  return state.kind === 'ready' && state.details.state === 'open';
}

export function canRetryQuote(state: PublicQuoteViewState): boolean {
  return state.kind === 'network-error';
}

export function documentTypeNoun(type: 'QUOTE' | 'ESTIMATE'): string {
  return type === 'ESTIMATE' ? 'estimate' : 'quote';
}

export function quoteStateHeadline(state: PublicQuoteState, type: 'QUOTE' | 'ESTIMATE'): string {
  const noun = documentTypeNoun(type);
  switch (state) {
    case 'open':
      return `Review your ${noun}`;
    case 'accepted':
      return `You accepted this ${noun}`;
    case 'declined':
      return `You declined this ${noun}`;
    case 'canceled':
      return `This ${noun} was withdrawn`;
    case 'expired':
      return `This ${noun} has expired`;
  }
}

export function quoteStateDetail(state: PublicQuoteState): string | null {
  switch (state) {
    case 'open':
      return 'Accept to let the business know you’d like to go ahead, or decline if it’s not right for you.';
    case 'accepted':
      return 'The business has been notified. They’ll follow up with next steps.';
    case 'declined':
      return 'The business has been notified.';
    case 'canceled':
      return 'Contact the business if you still need this work done.';
    case 'expired':
      return 'Ask the business to send an updated version if you’re still interested.';
  }
}
