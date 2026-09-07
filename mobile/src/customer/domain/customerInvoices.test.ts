import { describe, expect, it } from 'vitest';
import type { CustomerInvoiceListItemDto } from '../../apiTypes';
import {
  canPayCustomerInvoice,
  customerInvoiceDetailNote,
  customerInvoiceHeadline,
  customerInvoicePaymentLabel,
  customerInvoiceStatusLabel,
  customerInvoiceStatusTone,
  isCustomerInvoiceOverdue,
  outstandingInvoiceCount,
  sortCustomerInvoices,
} from './customerInvoices';

const item = (over: Partial<CustomerInvoiceListItemDto> = {}): CustomerInvoiceListItemDto => ({
  id: 'inv1',
  invoiceNumber: 'INV-2026-0001',
  status: 'SENT',
  currency: 'USD',
  issueDate: '2026-09-01T00:00:00.000Z',
  dueDate: '2026-09-10T00:00:00.000Z',
  total: '140.00',
  payment: { currency: 'USD', invoiceTotal: '140.00', amountPaid: '0.00', outstandingBalance: '140.00', state: null },
  business: { name: 'Bright Studio' },
  createdAt: '2026-09-01T00:00:00.000Z',
  ...over,
});

describe('customerInvoiceStatusLabel / tone', () => {
  it('labels outstanding, overdue and canceled', () => {
    expect(customerInvoiceStatusLabel('SENT', false)).toBe('Outstanding');
    expect(customerInvoiceStatusLabel('SENT', true)).toBe('Overdue');
    expect(customerInvoiceStatusLabel('VOID', false)).toBe('Canceled');
  });

  it('tones overdue as negative, outstanding as attention, canceled as default', () => {
    expect(customerInvoiceStatusTone('SENT', false)).toBe('attention');
    expect(customerInvoiceStatusTone('SENT', true)).toBe('negative');
    expect(customerInvoiceStatusTone('VOID', true)).toBe('default');
  });
});

describe('isCustomerInvoiceOverdue', () => {
  it('is true only for a SENT invoice past its due date', () => {
    expect(isCustomerInvoiceOverdue(item(), new Date('2026-09-15T00:00:00.000Z'))).toBe(true);
    expect(isCustomerInvoiceOverdue(item(), new Date('2026-09-05T00:00:00.000Z'))).toBe(false);
    expect(isCustomerInvoiceOverdue(item({ status: 'VOID' }), new Date('2026-09-15T00:00:00.000Z'))).toBe(false);
    expect(isCustomerInvoiceOverdue(item({ dueDate: null }), new Date('2026-09-15T00:00:00.000Z'))).toBe(false);
  });
});

describe('copy is non-committal about payment', () => {
  it('never tells the customer to pay through the app', () => {
    const strings = [
      customerInvoiceHeadline('SENT'),
      customerInvoiceHeadline('VOID'),
      customerInvoiceDetailNote('SENT', false),
      customerInvoiceDetailNote('SENT', true),
      customerInvoiceDetailNote('VOID', false),
    ].join(' ').toLowerCase();
    expect(strings).not.toMatch(/pay now|pay here|pay online|make a payment|checkout/);
  });
});

describe('sortCustomerInvoices / outstandingInvoiceCount', () => {
  it('puts outstanding before canceled, newest issue date first', () => {
    const a = item({ id: 'a', status: 'SENT', issueDate: '2026-09-01T00:00:00.000Z' });
    const b = item({ id: 'b', status: 'SENT', issueDate: '2026-09-05T00:00:00.000Z' });
    const c = item({ id: 'c', status: 'VOID', issueDate: '2026-09-09T00:00:00.000Z' });
    expect(sortCustomerInvoices([a, c, b]).map((i) => i.id)).toEqual(['b', 'a', 'c']);
  });

  it('counts only outstanding invoices', () => {
    const paid = item({ status: 'SENT', payment: { currency: 'USD', invoiceTotal: '140.00', amountPaid: '140.00', outstandingBalance: '0.00', state: 'PAID' } });
    expect(outstandingInvoiceCount([item({ status: 'SENT' }), item({ status: 'VOID' }), item({ status: 'SENT' }), paid])).toBe(2);
  });
});

describe('canPayCustomerInvoice / customerInvoicePaymentLabel', () => {
  it('allows paying only a SENT invoice that still owes money', () => {
    expect(canPayCustomerInvoice(item())).toBe(true);
    expect(canPayCustomerInvoice(item({ status: 'VOID' }))).toBe(false);
    expect(canPayCustomerInvoice(item({ payment: { currency: 'USD', invoiceTotal: '140.00', amountPaid: '140.00', outstandingBalance: '0.00', state: 'PAID' } }))).toBe(false);
  });

  it('summarises a partial payment and reports paid-in-full', () => {
    expect(customerInvoicePaymentLabel({ currency: 'USD', invoiceTotal: '140.00', amountPaid: '0.00', outstandingBalance: '140.00', state: null })).toBeNull();
    expect(customerInvoicePaymentLabel({ currency: 'USD', invoiceTotal: '140.00', amountPaid: '40.00', outstandingBalance: '100.00', state: 'PARTIALLY_PAID' })).toContain('40.00 paid');
    expect(customerInvoicePaymentLabel({ currency: 'USD', invoiceTotal: '140.00', amountPaid: '140.00', outstandingBalance: '0.00', state: 'PAID' })).toBe('Paid in full');
  });
});
