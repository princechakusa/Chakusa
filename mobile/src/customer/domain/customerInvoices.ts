import type { CustomerInvoiceListItemDto, CustomerInvoicePaymentDto, CustomerInvoiceStatus } from '../../apiTypes';

// PROGRAM 3 / Invoicing I7: pure product rules for the customer invoice
// inbox. Read-only surface: a customer views an invoice their business
// sent them, nothing more. There is NO pay action here - a payment
// architecture does not exist yet, so the UI must never imply one.

export function customerInvoiceStatusLabel(status: CustomerInvoiceStatus, overdue: boolean): string {
  if (status === 'VOID') return 'Canceled';
  return overdue ? 'Overdue' : 'Outstanding';
}

export type CustomerInvoiceStatusTone = 'default' | 'attention' | 'negative';

export function customerInvoiceStatusTone(status: CustomerInvoiceStatus, overdue: boolean): CustomerInvoiceStatusTone {
  if (status === 'VOID') return 'default';
  return overdue ? 'negative' : 'attention';
}

export function isCustomerInvoiceOverdue(
  item: Pick<CustomerInvoiceListItemDto, 'status' | 'dueDate'>,
  now: Date = new Date(),
): boolean {
  if (item.status !== 'SENT' || !item.dueDate) return false;
  const due = new Date(item.dueDate);
  return Number.isFinite(due.getTime()) && now.getTime() > due.getTime();
}

export function customerInvoiceHeadline(status: CustomerInvoiceStatus): string {
  return status === 'VOID' ? 'This invoice was canceled' : 'Invoice from your business';
}

/**
 * A short, non-committal explainer. It deliberately does NOT tell the
 * customer to pay through the app - payment happens directly with the
 * business until a real payment flow exists.
 */
export function customerInvoiceDetailNote(status: CustomerInvoiceStatus, overdue: boolean): string {
  if (status === 'VOID') return 'Your business canceled this invoice. You do not owe anything for it.';
  if (overdue) return 'This invoice is past its due date. You can pay it securely below, or contact your business with any questions.';
  return 'Your business sent you this invoice. You can pay it securely below, or contact them with any questions.';
}

const STATUS_ORDER: Record<CustomerInvoiceStatus, number> = { SENT: 0, VOID: 1 };

/** Outstanding first, then canceled; each group newest issue date first. */
export function sortCustomerInvoices(items: readonly CustomerInvoiceListItemDto[]): CustomerInvoiceListItemDto[] {
  return [...items].sort((a, b) => {
    if (STATUS_ORDER[a.status] !== STATUS_ORDER[b.status]) return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    const aDate = new Date(a.issueDate ?? a.createdAt).getTime();
    const bDate = new Date(b.issueDate ?? b.createdAt).getTime();
    return bDate - aDate;
  });
}

export function outstandingInvoiceCount(items: readonly CustomerInvoiceListItemDto[]): number {
  return items.filter((item) => item.status === 'SENT' && Number(item.payment.outstandingBalance) > 0).length;
}

// --- Payment (Invoicing I8) ------------------------------------------

/** The customer may pay a SENT invoice that still owes money. */
export function canPayCustomerInvoice(
  item: Pick<CustomerInvoiceListItemDto, 'status' | 'payment'>,
): boolean {
  return item.status === 'SENT' && Number(item.payment.outstandingBalance) > 0;
}

export function customerInvoicePaymentLabel(payment: CustomerInvoicePaymentDto): string | null {
  if (payment.state === 'PAID') return 'Paid in full';
  const paid = Number(payment.amountPaid);
  const outstanding = Number(payment.outstandingBalance);
  if (paid > 0 && outstanding > 0) return `${payment.currency} ${payment.amountPaid} paid · ${payment.currency} ${payment.outstandingBalance} left`;
  return null;
}
