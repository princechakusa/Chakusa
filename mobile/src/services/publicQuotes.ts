import type { PublicQuoteResponse } from '../domain/publicQuote';
import { api } from './api';

// PROGRAM 3 LOOP 3I: account-less customer access to a sent quote. Every
// call is unauthenticated (`'none'` - no Authorization header) so this
// bearer-token flow is never merged with the customer session. The raw
// token is only ever a URL path segment here; it is not logged or sent to
// analytics.

const pathFor = (token: string) => `/public/quotes/${encodeURIComponent(token)}`;

export const publicQuotesApi = {
  get: (token: string) => api.get<PublicQuoteResponse>(pathFor(token), 'none'),
  accept: (token: string, note?: string) =>
    api.post<PublicQuoteResponse>(`${pathFor(token)}/accept`, note ? { note } : {}, 'none'),
  decline: (token: string, note?: string) =>
    api.post<PublicQuoteResponse>(`${pathFor(token)}/decline`, note ? { note } : {}, 'none'),
};
