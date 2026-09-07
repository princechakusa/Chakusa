import type { PublicInvoiceResponse } from '../domain/publicInvoice';
import { api } from './api';

// PROGRAM 3 / Invoicing I4-I5 + I8: account-less customer access to a SENT
// invoice. Unauthenticated (`'none'` - no Authorization header) so this
// bearer-token flow is never merged with the customer session. The raw
// token is only ever a URL path segment; it is not logged or sent to
// analytics. `pay` returns a Stripe Checkout URL to open externally.

const pathFor = (token: string) => `/public/invoices/${encodeURIComponent(token)}`;

export const publicInvoicesApi = {
  get: (token: string) => api.get<PublicInvoiceResponse>(pathFor(token), 'none'),
  pay: (token: string) => api.post<{ checkoutUrl: string }>(`${pathFor(token)}/pay`, {}, 'none'),
};
