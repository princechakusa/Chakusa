import { describe, expect, it } from 'vitest';
import type { QuoteDetailDto, QuoteListItemDto } from '../apiTypes';
import {
  availableQuoteActions,
  canPerformQuoteAction,
  canSendDraft,
  detailLineItemsToDrafts,
  documentTypeLabel,
  emptyLineItem,
  filterQuotesByStatus,
  isTerminalQuoteStatus,
  lineItemDraftToInput,
  previewQuoteTotals,
  quoteContextLabel,
  quoteStatusLabel,
  quoteStatusTone,
  validateLineItem,
  validateQuoteDraft,
  type LineItemDraft,
} from './quotes';

const line = (over: Partial<LineItemDraft> = {}): LineItemDraft => ({
  description: over.description ?? 'Labor',
  quantity: over.quantity ?? '2',
  unitPrice: over.unitPrice ?? '50',
  discountAmount: over.discountAmount ?? '',
  taxable: over.taxable ?? false,
  serviceOfferingId: over.serviceOfferingId,
});

describe('quote status helpers', () => {
  it('labels every status', () => {
    expect(quoteStatusLabel('DRAFT')).toBe('Draft');
    expect(quoteStatusLabel('SENT')).toBe('Sent');
    expect(quoteStatusLabel('ACCEPTED')).toBe('Accepted');
    expect(quoteStatusLabel('DECLINED')).toBe('Declined');
    expect(quoteStatusLabel('CANCELED')).toBe('Canceled');
    expect(quoteStatusLabel('EXPIRED')).toBe('Expired');
  });
  it('tones map to intent', () => {
    expect(quoteStatusTone('ACCEPTED')).toBe('success');
    expect(quoteStatusTone('SENT')).toBe('attention');
    expect(quoteStatusTone('DECLINED')).toBe('negative');
    expect(quoteStatusTone('DRAFT')).toBe('default');
  });
  it('knows terminal statuses', () => {
    expect(isTerminalQuoteStatus('ACCEPTED')).toBe(true);
    expect(isTerminalQuoteStatus('EXPIRED')).toBe(true);
    expect(isTerminalQuoteStatus('DRAFT')).toBe(false);
    expect(isTerminalQuoteStatus('SENT')).toBe(false);
  });
  it('labels document types', () => {
    expect(documentTypeLabel('QUOTE')).toBe('Quote');
    expect(documentTypeLabel('ESTIMATE')).toBe('Estimate');
  });
});

describe('availableQuoteActions - mirrors backend authorization', () => {
  it('DRAFT: all roles may edit / delete / send', () => {
    for (const role of ['OWNER', 'ADMIN', 'STAFF'] as const) {
      expect(availableQuoteActions('DRAFT', role).sort()).toEqual(['deleteDraft', 'editDraft', 'send']);
    }
  });
  it('SENT: STAFF may resend (share link) but NOT revise or cancel', () => {
    expect(availableQuoteActions('SENT', 'STAFF').sort()).toEqual(['resend']);
  });
  it('SENT: OWNER and ADMIN may also revise and cancel', () => {
    for (const role of ['OWNER', 'ADMIN'] as const) {
      expect(availableQuoteActions('SENT', role).sort()).toEqual(['cancel', 'resend', 'revise']);
    }
  });
  it('terminal statuses expose no actions', () => {
    for (const status of ['ACCEPTED', 'DECLINED', 'CANCELED', 'EXPIRED'] as const) {
      expect(availableQuoteActions(status, 'OWNER')).toEqual([]);
    }
  });
  it('canPerformQuoteAction agrees', () => {
    expect(canPerformQuoteAction('cancel', 'SENT', 'STAFF')).toBe(false);
    expect(canPerformQuoteAction('cancel', 'SENT', 'ADMIN')).toBe(true);
    expect(canPerformQuoteAction('send', 'SENT', 'OWNER')).toBe(false);
    expect(canPerformQuoteAction('revise', 'ACCEPTED', 'OWNER')).toBe(false);
  });
});

describe('previewQuoteTotals - presentation mirror of calculateQuoteTotals', () => {
  it('matches the backend example: 2 x 50 - 10 discount => total 90', () => {
    expect(previewQuoteTotals([line({ quantity: '2', unitPrice: '50', discountAmount: '10' })])).toEqual({
      subtotal: 100,
      discountTotal: 10,
      taxTotal: 0,
      total: 90,
    });
  });
  it('applies tax only to taxable lines', () => {
    expect(
      previewQuoteTotals([line({ quantity: '1', unitPrice: '100', taxable: true }), line({ quantity: '1', unitPrice: '50', taxable: false })], 10),
    ).toEqual({ subtotal: 150, discountTotal: 0, taxTotal: 10, total: 160 });
  });
  it('is zero for an empty list', () => {
    expect(previewQuoteTotals([])).toEqual({ subtotal: 0, discountTotal: 0, taxTotal: 0, total: 0 });
  });
  it('rounds each line before summing', () => {
    const totals = previewQuoteTotals([line({ quantity: '3', unitPrice: '0.335', discountAmount: '' })]);
    // 3 * 0.335 = 1.005 -> rounds to 1.01
    expect(totals.subtotal).toBe(1.01);
    expect(totals.total).toBe(1.01);
  });
});

describe('validation', () => {
  it('flags blank description, non-positive quantity, negative discount, over-discount', () => {
    expect(validateLineItem(line({ description: '  ' }), 0).some((e) => e.field === 'description')).toBe(true);
    expect(validateLineItem(line({ quantity: '0' }), 0).some((e) => e.field === 'quantity')).toBe(true);
    expect(validateLineItem(line({ discountAmount: '-1' }), 0).some((e) => e.field === 'discountAmount')).toBe(true);
    expect(validateLineItem(line({ quantity: '1', unitPrice: '10', discountAmount: '20' }), 0).some((e) => e.field === 'discountAmount')).toBe(true);
  });
  it('accepts a zero unit price but not a blank one', () => {
    expect(validateLineItem(line({ unitPrice: '0' }), 0).some((e) => e.field === 'unitPrice')).toBe(false);
    expect(validateLineItem(line({ unitPrice: '' }), 0).some((e) => e.field === 'unitPrice')).toBe(true);
  });
  it('canSendDraft: needs DRAFT status, >=1 line, and no errors', () => {
    expect(canSendDraft('DRAFT', [])).toBe(false);
    expect(canSendDraft('SENT', [line()])).toBe(false);
    expect(canSendDraft('DRAFT', [line({ quantity: '0' })])).toBe(false);
    expect(canSendDraft('DRAFT', [line()])).toBe(true);
  });
  it('validateQuoteDraft aggregates per-line errors with indices', () => {
    const errors = validateQuoteDraft([line(), line({ description: '' })]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.index).toBe(1);
  });
});

describe('serialisation', () => {
  it('emptyLineItem is a sane blank row', () => {
    expect(emptyLineItem()).toEqual({ description: '', quantity: '1', unitPrice: '', discountAmount: '', taxable: false });
  });
  it('lineItemDraftToInput trims and drops empty optionals', () => {
    expect(lineItemDraftToInput(line({ description: '  Paint  ', quantity: ' 2 ', unitPrice: ' 30 ', discountAmount: '', taxable: false }), 3)).toEqual({
      description: 'Paint',
      quantity: '2',
      unitPrice: '30',
      discountAmount: undefined,
      taxable: undefined,
      serviceOfferingId: undefined,
      sortOrder: 3,
    });
  });
  it('lineItemDraftToInput keeps supplied discount / taxable / service id', () => {
    expect(lineItemDraftToInput(line({ discountAmount: '5', taxable: true, serviceOfferingId: 'svc-1' }), 0)).toMatchObject({
      discountAmount: '5',
      taxable: true,
      serviceOfferingId: 'svc-1',
    });
  });
  it('detailLineItemsToDrafts round-trips a revision, hiding a 0.00 discount', () => {
    const detail = {
      currentRevision: {
        lineItems: [
          { id: 'li1', serviceOfferingId: null, description: 'A', quantity: '1.00', unitPrice: '10.00', discountAmount: '0.00', taxable: false, lineTotal: '10.00', sortOrder: 0 },
          { id: 'li2', serviceOfferingId: 'svc', description: 'B', quantity: '2.00', unitPrice: '5.00', discountAmount: '1.00', taxable: true, lineTotal: '9.00', sortOrder: 1 },
        ],
      },
    } as unknown as QuoteDetailDto;
    const drafts = detailLineItemsToDrafts(detail);
    expect(drafts[0]).toMatchObject({ description: 'A', discountAmount: '' });
    expect(drafts[1]).toMatchObject({ description: 'B', discountAmount: '1.00', taxable: true, serviceOfferingId: 'svc' });
  });
  it('detailLineItemsToDrafts is empty when there is no current revision', () => {
    expect(detailLineItemsToDrafts({ currentRevision: null } as QuoteDetailDto)).toEqual([]);
  });
});

describe('list helpers', () => {
  const item = (over: Partial<QuoteListItemDto>): QuoteListItemDto => ({
    id: over.id ?? 'q1',
    documentType: over.documentType ?? 'QUOTE',
    documentNumber: over.documentNumber ?? 'Q-2026-0001',
    status: over.status ?? 'DRAFT',
    currency: 'USD',
    totals: { subtotal: '0.00', discountTotal: '0.00', taxTotal: '0.00', total: '0.00' },
    customer: over.customer ?? null,
    lead: over.lead ?? null,
    expiresAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  it('quoteContextLabel prefers customer name, then lead service', () => {
    expect(quoteContextLabel(item({ customer: { id: 'c', name: 'Ada' } }))).toBe('Ada');
    expect(quoteContextLabel(item({ lead: { id: 'l', serviceRequested: 'Roof repair' } }))).toBe('Roof repair');
    expect(quoteContextLabel(item({}))).toBeNull();
  });
  it('filterQuotesByStatus filters or passes through on "all"', () => {
    const items = [item({ id: 'a', status: 'DRAFT' }), item({ id: 'b', status: 'SENT' })];
    expect(filterQuotesByStatus(items, 'all')).toHaveLength(2);
    expect(filterQuotesByStatus(items, 'SENT').map((q) => q.id)).toEqual(['b']);
  });
});
