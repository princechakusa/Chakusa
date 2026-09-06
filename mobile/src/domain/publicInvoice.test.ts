import { describe, expect, it } from 'vitest';
import {
  canRetryInvoice,
  invoiceErrorViewState,
  invoiceStateDetail,
  invoiceStateHeadline,
  isInvoiceOverdue,
  viewStateFromInvoiceResponse,
  type PublicInvoiceResponse,
  type PublicInvoiceState,
} from './publicInvoice';

const response = (over: Partial<PublicInvoiceResponse> = {}): PublicInvoiceResponse => ({
  state: over.state ?? 'open',
  invoiceNumber: 'INV-2026-0001',
  currency: 'USD',
  issueDate: over.issueDate ?? '2026-01-01T00:00:00.000Z',
  dueDate: over.dueDate ?? null,
  business: { name: 'Jane’s Plumbing' },
  revision: {
    notes: null,
    terms: null,
    totals: { subtotal: '100.00', discountTotal: '0.00', taxTotal: '0.00', total: '100.00' },
    lineItems: [{ description: 'Labor', quantity: '2.00', unitPrice: '50.00', discountAmount: '0.00', taxable: false, lineTotal: '100.00' }],
  },
});

describe('publicInvoice view state', () => {
  it('wraps a response into a ready view', () => {
    expect(viewStateFromInvoiceResponse(response())).toEqual({ kind: 'ready', details: response() });
  });
  it('maps not-found -> invalid, else -> network-error', () => {
    expect(invoiceErrorViewState('not-found')).toEqual({ kind: 'invalid' });
    expect(invoiceErrorViewState('network')).toEqual({ kind: 'network-error' });
    expect(invoiceErrorViewState('server')).toEqual({ kind: 'network-error' });
  });
  it('canRetryInvoice only for a network error', () => {
    expect(canRetryInvoice({ kind: 'network-error' })).toBe(true);
    expect(canRetryInvoice({ kind: 'invalid' })).toBe(false);
    expect(canRetryInvoice(viewStateFromInvoiceResponse(response()))).toBe(false);
  });
});

describe('isInvoiceOverdue', () => {
  it('is true only when open, has a dueDate, and now is past it', () => {
    const past = response({ dueDate: '2020-01-01T00:00:00.000Z' });
    expect(isInvoiceOverdue(past)).toBe(true);
    expect(isInvoiceOverdue(response({ dueDate: '2999-01-01T00:00:00.000Z' }))).toBe(false);
    expect(isInvoiceOverdue(response({ dueDate: null }))).toBe(false);
    expect(isInvoiceOverdue(response({ state: 'void', dueDate: '2020-01-01T00:00:00.000Z' }))).toBe(false);
    expect(isInvoiceOverdue(response({ state: 'expired', dueDate: '2020-01-01T00:00:00.000Z' }))).toBe(false);
  });
});

describe('publicInvoice copy', () => {
  it('headlines every state and never says "pay now" / "signature"', () => {
    for (const state of ['open', 'expired', 'void'] as const) {
      const h = invoiceStateHeadline(state).toLowerCase();
      expect(h).not.toContain('pay now');
      expect(h).not.toContain('signature');
      expect(invoiceStateHeadline(state)).toBeTruthy();
    }
    expect(invoiceStateHeadline('void')).toBe('This invoice was canceled');
  });
  it('detail text reflects overdue only for the open state', () => {
    expect(invoiceStateDetail('open', true)).toContain('past its due date');
    expect(invoiceStateDetail('open', false)).not.toContain('past its due date');
    for (const state of ['open', 'expired', 'void'] as PublicInvoiceState[]) {
      expect(invoiceStateDetail(state, false)).toBeTruthy();
    }
  });
});
