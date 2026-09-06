import type {
  QuoteDetailDto,
  QuoteDocumentStatus,
  QuoteDocumentType,
  QuoteLineItemInput,
  QuoteListItemDto,
} from '../apiTypes';

// PROGRAM 3 LOOP 3H: pure product rules for the Business Quotes & Estimates
// mobile surface. No networking, no navigation side effects. Money math
// here is PRESENTATION ONLY - the server is always the authority for
// persisted totals (see quotes.service.ts / calculateQuoteTotals). This
// module only mirrors the same line-then-round-then-sum shape so the
// editor can show a live preview before save.

// --- Status ----------------------------------------------------------------

export const QUOTE_STATUSES: readonly QuoteDocumentStatus[] = [
  'DRAFT',
  'SENT',
  'ACCEPTED',
  'DECLINED',
  'CANCELED',
  'EXPIRED',
];

export const TERMINAL_QUOTE_STATUSES: readonly QuoteDocumentStatus[] = ['ACCEPTED', 'DECLINED', 'CANCELED', 'EXPIRED'];

export function isTerminalQuoteStatus(status: QuoteDocumentStatus): boolean {
  return TERMINAL_QUOTE_STATUSES.includes(status);
}

export function quoteStatusLabel(status: QuoteDocumentStatus): string {
  switch (status) {
    case 'DRAFT':
      return 'Draft';
    case 'SENT':
      return 'Sent';
    case 'ACCEPTED':
      return 'Accepted';
    case 'DECLINED':
      return 'Declined';
    case 'CANCELED':
      return 'Canceled';
    case 'EXPIRED':
      return 'Expired';
  }
}

export type QuoteStatusTone = 'default' | 'success' | 'attention' | 'negative';

export function quoteStatusTone(status: QuoteDocumentStatus): QuoteStatusTone {
  switch (status) {
    case 'ACCEPTED':
      return 'success';
    case 'SENT':
      return 'attention';
    case 'DECLINED':
    case 'CANCELED':
    case 'EXPIRED':
      return 'negative';
    case 'DRAFT':
      return 'default';
  }
}

export function documentTypeLabel(type: QuoteDocumentType): string {
  return type === 'ESTIMATE' ? 'Estimate' : 'Quote';
}

// --- Lifecycle actions the UI may offer -----------------------------------
//
// Mirrors the backend authorization exactly so the UI never shows an
// action the server will 403/409. `role` is the caller's BusinessRole.

// `resend` mints a fresh secure link for the current revision and returns
// it once - it is also how the UI's "share / copy link" affordance works,
// since the raw bearer token is never retrievable after issuance.
export type QuoteAction = 'editDraft' | 'deleteDraft' | 'send' | 'revise' | 'cancel' | 'resend';

export type BusinessRole = 'OWNER' | 'ADMIN' | 'STAFF';

const ALL_ROLES: readonly BusinessRole[] = ['OWNER', 'ADMIN', 'STAFF'];
const OWNER_ADMIN: readonly BusinessRole[] = ['OWNER', 'ADMIN'];

export function availableQuoteActions(status: QuoteDocumentStatus, role: BusinessRole): QuoteAction[] {
  const can = (roles: readonly BusinessRole[]) => roles.includes(role);
  const actions: QuoteAction[] = [];
  if (status === 'DRAFT') {
    if (can(ALL_ROLES)) {
      actions.push('editDraft', 'deleteDraft', 'send');
    }
    return actions;
  }
  if (status === 'SENT') {
    if (can(ALL_ROLES)) actions.push('resend');
    if (can(OWNER_ADMIN)) actions.push('revise', 'cancel');
    return actions;
  }
  // ACCEPTED / DECLINED / CANCELED / EXPIRED: read-only.
  return actions;
}

export function canPerformQuoteAction(action: QuoteAction, status: QuoteDocumentStatus, role: BusinessRole): boolean {
  return availableQuoteActions(status, role).includes(action);
}

// --- Editor: line-item preview math (presentation only) ------------------

export interface LineItemDraft {
  description: string;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  taxable: boolean;
  serviceOfferingId?: string | null;
}

export function emptyLineItem(): LineItemDraft {
  return { description: '', quantity: '1', unitPrice: '', discountAmount: '', taxable: false };
}

function round2(n: number): number {
  // Match backend ROUND_HALF_UP for non-negative money values.
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function toNumber(value: string): number {
  const n = Number(String(value).trim());
  return Number.isFinite(n) ? n : 0;
}

export interface PreviewTotals {
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
}

/**
 * A local mirror of calculateQuoteTotals for the editor preview only.
 * Never send these numbers as authoritative - the server recomputes and
 * persists its own.
 */
export function previewQuoteTotals(lineItems: readonly LineItemDraft[], taxRatePercent = 0): PreviewTotals {
  let subtotal = 0;
  let discountTotal = 0;
  let taxableBase = 0;
  for (const item of lineItems) {
    const gross = round2(toNumber(item.quantity) * toNumber(item.unitPrice));
    const discount = round2(toNumber(item.discountAmount));
    const lineTotal = round2(gross - discount);
    subtotal = round2(subtotal + gross);
    discountTotal = round2(discountTotal + discount);
    if (item.taxable) taxableBase = round2(taxableBase + lineTotal);
  }
  const rate = Number.isFinite(taxRatePercent) ? taxRatePercent : 0;
  const taxTotal = round2((taxableBase * rate) / 100);
  const total = round2(subtotal - discountTotal + taxTotal);
  return { subtotal, discountTotal, taxTotal, total };
}

// --- Editor validation ---------------------------------------------------

export interface LineItemValidationError {
  index: number;
  field: 'description' | 'quantity' | 'unitPrice' | 'discountAmount';
  message: string;
}

export function validateLineItem(item: LineItemDraft, index: number): LineItemValidationError[] {
  const errors: LineItemValidationError[] = [];
  if (!item.description.trim()) {
    errors.push({ index, field: 'description', message: 'Description is required' });
  }
  const qty = toNumber(item.quantity);
  if (!(qty > 0)) {
    errors.push({ index, field: 'quantity', message: 'Quantity must be greater than zero' });
  }
  const price = toNumber(item.unitPrice);
  if (price < 0 || item.unitPrice.trim() === '') {
    errors.push({ index, field: 'unitPrice', message: 'Enter a unit price of zero or more' });
  }
  const discount = toNumber(item.discountAmount);
  if (discount < 0) {
    errors.push({ index, field: 'discountAmount', message: 'Discount cannot be negative' });
  }
  if (discount > round2(qty * price)) {
    errors.push({ index, field: 'discountAmount', message: 'Discount cannot exceed the line amount' });
  }
  return errors;
}

export function validateQuoteDraft(lineItems: readonly LineItemDraft[]): LineItemValidationError[] {
  return lineItems.flatMap((item, index) => validateLineItem(item, index));
}

/** A DRAFT may be saved with zero line items, but it cannot be SENT that way. */
export function canSendDraft(status: QuoteDocumentStatus, lineItems: readonly LineItemDraft[]): boolean {
  if (status !== 'DRAFT') return false;
  if (lineItems.length === 0) return false;
  return validateQuoteDraft(lineItems).length === 0;
}

// --- Serialisation to the API request shape -----------------------------

export function lineItemDraftToInput(item: LineItemDraft, sortOrder: number): QuoteLineItemInput {
  return {
    description: item.description.trim(),
    quantity: item.quantity.trim(),
    unitPrice: item.unitPrice.trim(),
    discountAmount: item.discountAmount.trim() === '' ? undefined : item.discountAmount.trim(),
    taxable: item.taxable || undefined,
    serviceOfferingId: item.serviceOfferingId ?? undefined,
    sortOrder,
  };
}

export function detailLineItemsToDrafts(detail: QuoteDetailDto): LineItemDraft[] {
  const revision = detail.currentRevision;
  if (!revision) return [];
  return revision.lineItems.map((li) => ({
    description: li.description,
    quantity: li.quantity,
    unitPrice: li.unitPrice,
    discountAmount: li.discountAmount === '0.00' ? '' : li.discountAmount,
    taxable: li.taxable,
    serviceOfferingId: li.serviceOfferingId,
  }));
}

// --- List helpers ------------------------------------------------------

export function quoteContextLabel(item: Pick<QuoteListItemDto, 'customer' | 'lead'>): string | null {
  if (item.customer?.name) return item.customer.name;
  if (item.lead?.serviceRequested) return item.lead.serviceRequested;
  return null;
}

export function filterQuotesByStatus(
  items: readonly QuoteListItemDto[],
  status: QuoteDocumentStatus | 'all',
): QuoteListItemDto[] {
  if (status === 'all') return [...items];
  return items.filter((item) => item.status === status);
}
