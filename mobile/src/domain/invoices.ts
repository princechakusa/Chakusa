import type { InvoiceDetailDto, InvoiceListItemDto, InvoiceStatus, QuoteLineItemInput } from '../apiTypes';
import {
  emptyLineItem,
  lineItemDraftToInput,
  previewQuoteTotals,
  validateLineItem,
  type BusinessRole,
  type LineItemDraft,
  type LineItemValidationError,
  type PreviewTotals,
} from './quotes';

// PROGRAM 3 / Invoicing I5: pure product rules for the Business invoice
// mobile surface. Money math is PRESENTATION ONLY - the server is always
// the authority for persisted totals. The line-item editor primitives are
// the same commercial-document shape as quotes, so they are reused rather
// than duplicated.

export { emptyLineItem, lineItemDraftToInput, previewQuoteTotals as previewInvoiceTotals, validateLineItem };
export type { BusinessRole, LineItemDraft, LineItemValidationError, PreviewTotals };

// --- Status -------------------------------------------------------------

export const INVOICE_STATUSES: readonly InvoiceStatus[] = ['DRAFT', 'SENT', 'VOID'];

export function invoiceStatusLabel(status: InvoiceStatus): string {
  switch (status) {
    case 'DRAFT':
      return 'Draft';
    case 'SENT':
      return 'Sent';
    case 'VOID':
      return 'Void';
  }
}

export type InvoiceStatusTone = 'default' | 'success' | 'attention' | 'negative';

export function invoiceStatusTone(status: InvoiceStatus): InvoiceStatusTone {
  switch (status) {
    case 'SENT':
      return 'attention';
    case 'VOID':
      return 'negative';
    case 'DRAFT':
      return 'default';
  }
}

export function isInvoiceOverdue(item: Pick<InvoiceListItemDto, 'status' | 'dueDate'>, now: Date = new Date()): boolean {
  if (item.status !== 'SENT' || !item.dueDate) return false;
  const due = new Date(item.dueDate);
  return Number.isFinite(due.getTime()) && now.getTime() > due.getTime();
}

// --- Lifecycle actions the UI may offer -------------------------------
// Mirrors the backend authorization exactly (INVOICE_ROLES = all;
// INVOICE_VOID_ROLES = OWNER/ADMIN).

export type InvoiceAction = 'editDraft' | 'deleteDraft' | 'send' | 'shareLink' | 'void' | 'createFromQuote';

const ALL_ROLES: readonly BusinessRole[] = ['OWNER', 'ADMIN', 'STAFF'];
const OWNER_ADMIN: readonly BusinessRole[] = ['OWNER', 'ADMIN'];

export function availableInvoiceActions(status: InvoiceStatus, role: BusinessRole): InvoiceAction[] {
  const can = (roles: readonly BusinessRole[]) => roles.includes(role);
  const actions: InvoiceAction[] = [];
  if (status === 'DRAFT') {
    if (can(ALL_ROLES)) actions.push('editDraft', 'deleteDraft', 'send');
    if (can(OWNER_ADMIN)) actions.push('void');
    return actions;
  }
  if (status === 'SENT') {
    if (can(ALL_ROLES)) actions.push('shareLink');
    if (can(OWNER_ADMIN)) actions.push('void');
    return actions;
  }
  // VOID: read-only.
  return actions;
}

export function canPerformInvoiceAction(action: InvoiceAction, status: InvoiceStatus, role: BusinessRole): boolean {
  return availableInvoiceActions(status, role).includes(action);
}

// --- Editor validation -------------------------------------------------

export function validateInvoiceDraft(lineItems: readonly LineItemDraft[]): LineItemValidationError[] {
  return lineItems.flatMap((item, index) => validateLineItem(item, index));
}

/** A DRAFT may be saved with zero line items, but it cannot be SENT that way. */
export function canSendInvoiceDraft(status: InvoiceStatus, lineItems: readonly LineItemDraft[]): boolean {
  if (status !== 'DRAFT') return false;
  if (lineItems.length === 0) return false;
  return validateInvoiceDraft(lineItems).length === 0;
}

/** issueDate/dueDate consistency for the editor (server re-checks on send). */
export function validateInvoiceDates(issueDate: string, dueDate: string): string | null {
  if (!issueDate || !dueDate) return null;
  const issue = new Date(issueDate).getTime();
  const due = new Date(dueDate).getTime();
  if (Number.isFinite(issue) && Number.isFinite(due) && due < issue) {
    return 'The due date cannot be before the issue date.';
  }
  return null;
}

// --- Serialisation ---------------------------------------------------

export function invoiceLineItemsToInputs(lineItems: readonly LineItemDraft[]): QuoteLineItemInput[] {
  return lineItems.filter((li) => li.description.trim() || li.unitPrice.trim()).map((li, i) => lineItemDraftToInput(li, i));
}

export function invoiceDetailLineItemsToDrafts(detail: InvoiceDetailDto): LineItemDraft[] {
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

// --- List helpers --------------------------------------------------

export function filterInvoicesByStatus(items: readonly InvoiceListItemDto[], status: InvoiceStatus | 'all'): InvoiceListItemDto[] {
  if (status === 'all') return [...items];
  return items.filter((item) => item.status === status);
}
