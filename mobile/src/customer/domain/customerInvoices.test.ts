import { describe, expect, it } from 'vitest';
import type { CustomerInvoiceListItemDto } from '../../apiTypes';
import {
  customerInvoiceDetailNote,
  customerInvoiceHeadline,
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
    expect(outstandingInvoiceCount([item({ status: 'SENT' }), item({ status: 'VOID' }), item({ status: 'SENT' })])).toBe(2);
  });
});
