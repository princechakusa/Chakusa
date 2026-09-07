import { describe, expect, it } from 'vitest';
import type { InvoiceDetailDto, InvoiceListItemDto } from '../apiTypes';
import {
  availableInvoiceActions,
  canCollectInvoicePayment,
  canPerformInvoiceAction,
  canSendInvoiceDraft,
  filterInvoicesByStatus,
  invoiceDetailLineItemsToDrafts,
  invoiceLineItemsToInputs,
  invoicePaymentStateLabel,
  invoicePaymentStateTone,
  invoiceStatusLabel,
  invoiceStatusTone,
  isInvoiceOverdue,
  validateInvoiceDates,
  validateInvoiceDraft,
  type LineItemDraft,
} from './invoices';

const draft = (over: Partial<LineItemDraft> = {}): LineItemDraft => ({
  description: 'Consulting',
  quantity: '2',
  unitPrice: '75.00',
  discountAmount: '',
  taxable: false,
  ...over,
});

const listItem = (over: Partial<InvoiceListItemDto> = {}): InvoiceListItemDto => ({
  id: 'inv1',
  invoiceNumber: 'INV-2026-0001',
  status: 'SENT',
  currency: 'USD',
  totals: { subtotal: '150.00', discountTotal: '0.00', taxTotal: '0.00', total: '150.00' },
  payment: { currency: 'USD', invoiceTotal: '150.00', amountPaid: '0.00', amountRefunded: '0.00', outstandingBalance: '150.00', state: null },
  customer: null,
  issueDate: '2026-09-01T00:00:00.000Z',
  dueDate: '2026-09-10T00:00:00.000Z',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  ...over,
});

describe('invoiceStatusLabel / invoiceStatusTone', () => {
  it('labels every status', () => {
    expect(invoiceStatusLabel('DRAFT')).toBe('Draft');
    expect(invoiceStatusLabel('SENT')).toBe('Sent');
    expect(invoiceStatusLabel('VOID')).toBe('Void');
  });

  it('tones SENT as attention and VOID as negative', () => {
    expect(invoiceStatusTone('DRAFT')).toBe('default');
    expect(invoiceStatusTone('SENT')).toBe('attention');
    expect(invoiceStatusTone('VOID')).toBe('negative');
  });
});

describe('availableInvoiceActions', () => {
  it('lets any role edit/delete/send a DRAFT but only OWNER/ADMIN void it', () => {
    expect(availableInvoiceActions('DRAFT', 'STAFF')).toEqual(['editDraft', 'deleteDraft', 'send']);
    expect(availableInvoiceActions('DRAFT', 'ADMIN')).toEqual(['editDraft', 'deleteDraft', 'send', 'void']);
    expect(availableInvoiceActions('DRAFT', 'OWNER')).toEqual(['editDraft', 'deleteDraft', 'send', 'void']);
  });

  it('lets any role share the link for a SENT invoice but only OWNER/ADMIN void it', () => {
    expect(availableInvoiceActions('SENT', 'STAFF')).toEqual(['shareLink']);
    expect(availableInvoiceActions('SENT', 'OWNER')).toEqual(['shareLink', 'void']);
  });

  it('offers nothing for a VOID invoice', () => {
    expect(availableInvoiceActions('VOID', 'OWNER')).toEqual([]);
    expect(availableInvoiceActions('VOID', 'STAFF')).toEqual([]);
  });

  it('canPerformInvoiceAction mirrors availableInvoiceActions', () => {
    expect(canPerformInvoiceAction('void', 'SENT', 'STAFF')).toBe(false);
    expect(canPerformInvoiceAction('void', 'SENT', 'OWNER')).toBe(true);
    expect(canPerformInvoiceAction('send', 'SENT', 'OWNER')).toBe(false);
  });
});

describe('isInvoiceOverdue', () => {
  it('is true only for a SENT invoice past its due date', () => {
    const now = new Date('2026-09-15T00:00:00.000Z');
    expect(isInvoiceOverdue(listItem({ status: 'SENT' }), now)).toBe(true);
    expect(isInvoiceOverdue(listItem({ status: 'DRAFT' }), now)).toBe(false);
    expect(isInvoiceOverdue(listItem({ status: 'VOID' }), now)).toBe(false);
    expect(isInvoiceOverdue(listItem({ status: 'SENT', dueDate: null }), now)).toBe(false);
  });

  it('is false before the due date', () => {
    expect(isInvoiceOverdue(listItem({ status: 'SENT' }), new Date('2026-09-05T00:00:00.000Z'))).toBe(false);
  });
});

describe('validateInvoiceDraft / canSendInvoiceDraft', () => {
  it('accepts a valid line item', () => {
    expect(validateInvoiceDraft([draft()])).toEqual([]);
    expect(canSendInvoiceDraft('DRAFT', [draft()])).toBe(true);
  });

  it('cannot send a zero-line draft or a non-DRAFT', () => {
    expect(canSendInvoiceDraft('DRAFT', [])).toBe(false);
    expect(canSendInvoiceDraft('SENT', [draft()])).toBe(false);
  });

  it('rejects an invalid line item', () => {
    expect(validateInvoiceDraft([draft({ description: '' })]).length).toBeGreaterThan(0);
    expect(canSendInvoiceDraft('DRAFT', [draft({ quantity: '0' })])).toBe(false);
  });
});

describe('validateInvoiceDates', () => {
  it('rejects a due date before the issue date', () => {
    expect(validateInvoiceDates('2026-09-10', '2026-09-01')).toMatch(/due date/i);
  });

  it('accepts equal or later due dates and blank inputs', () => {
    expect(validateInvoiceDates('2026-09-01', '2026-09-01')).toBeNull();
    expect(validateInvoiceDates('2026-09-01', '2026-09-30')).toBeNull();
    expect(validateInvoiceDates('', '2026-09-01')).toBeNull();
  });
});

describe('serialisation', () => {
  it('drops empty rows and trims values for the API', () => {
    const inputs = invoiceLineItemsToInputs([draft(), draft({ description: '', unitPrice: '' })]);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({ description: 'Consulting', quantity: '2', unitPrice: '75.00' });
  });

  it('turns an invoice detail revision back into editable drafts', () => {
    const detail = {
      currentRevision: {
        id: 'rev1',
        revisionNumber: 1,
        notes: null,
        terms: null,
        totals: { subtotal: '150.00', discountTotal: '0.00', taxTotal: '0.00', total: '150.00' },
        lineItems: [
          {
            id: 'li1',
            serviceOfferingId: null,
            description: 'Consulting',
            quantity: '2.00',
            unitPrice: '75.00',
            discountAmount: '0.00',
            taxable: false,
            lineTotal: '150.00',
            sortOrder: 0,
          },
        ],
      },
    } as InvoiceDetailDto;
    const drafts = invoiceDetailLineItemsToDrafts(detail);
    expect(drafts).toEqual([
      { description: 'Consulting', quantity: '2.00', unitPrice: '75.00', discountAmount: '', taxable: false, serviceOfferingId: null },
    ]);
  });

  it('returns no drafts when there is no current revision', () => {
    expect(invoiceDetailLineItemsToDrafts({ currentRevision: null } as InvoiceDetailDto)).toEqual([]);
  });
});

describe('invoice payment (I8)', () => {
  it('labels and tones each derived payment state', () => {
    expect(invoicePaymentStateLabel('PAID')).toBe('Paid');
    expect(invoicePaymentStateLabel('PARTIALLY_PAID')).toBe('Part-paid');
    expect(invoicePaymentStateLabel('OVERDUE')).toBe('Overdue');
    expect(invoicePaymentStateLabel(null)).toBeNull();
    expect(invoicePaymentStateTone('PAID')).toBe('success');
    expect(invoicePaymentStateTone('OVERDUE')).toBe('negative');
    expect(invoicePaymentStateTone('PARTIALLY_PAID')).toBe('attention');
    expect(invoicePaymentStateTone(null)).toBe('default');
  });

  it('offers collection only for a SENT invoice that still owes money', () => {
    expect(canCollectInvoicePayment('SENT', { outstandingBalance: '140.00' })).toBe(true);
    expect(canCollectInvoicePayment('SENT', { outstandingBalance: '0.00' })).toBe(false);
    expect(canCollectInvoicePayment('DRAFT', { outstandingBalance: '140.00' })).toBe(false);
    expect(canCollectInvoicePayment('VOID', { outstandingBalance: '140.00' })).toBe(false);
  });
});

describe('filterInvoicesByStatus', () => {
  it('filters by status and passes everything through for "all"', () => {
    const items = [listItem({ id: 'a', status: 'DRAFT' }), listItem({ id: 'b', status: 'SENT' }), listItem({ id: 'c', status: 'VOID' })];
    expect(filterInvoicesByStatus(items, 'all').map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(filterInvoicesByStatus(items, 'SENT').map((i) => i.id)).toEqual(['b']);
    expect(filterInvoicesByStatus(items, 'DRAFT').map((i) => i.id)).toEqual(['a']);
  });
});
