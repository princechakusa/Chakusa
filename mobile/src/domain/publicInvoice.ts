// PROGRAM 3 / Invoicing I4-I5 + I8: pure view-state logic for the
// account-less customer invoice page (GET /public/invoices/:token). No
// networking. The bearer token lives only in the screen + service layer
// and is never placed in analytics or logs. Read-only - an invoice is not
// "accepted". A Pay action exists only when the invoice is open and still
// carries an outstanding balance.

export type PublicInvoiceState = 'open' | 'expired' | 'void';

export type PublicInvoicePaymentState = 'PAID' | 'PARTIALLY_PAID' | 'OVERDUE' | null;

export interface PublicInvoicePayment {
  currency: string;
  invoiceTotal: string;
  amountPaid: string;
  outstandingBalance: string;
  state: PublicInvoicePaymentState;
}

export interface PublicInvoiceLineItem {
  description: string;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  taxable: boolean;
  lineTotal: string;
}

export interface PublicInvoiceDetails {
  state: PublicInvoiceState;
  invoiceNumber: string;
  currency: string;
  issueDate: string | null;
  dueDate: string | null;
  business: { name: string };
  payment: PublicInvoicePayment;
  revision: {
    notes: string | null;
    terms: string | null;
    totals: { subtotal: string; discountTotal: string; taxTotal: string; total: string };
    lineItems: PublicInvoiceLineItem[];
  };
}

export type PublicInvoiceResponse = PublicInvoiceDetails;

export type PublicInvoiceViewState =
  | { kind: 'loading' }
  | { kind: 'ready'; details: PublicInvoiceDetails }
  | { kind: 'invalid' }
  | { kind: 'network-error' };

export function viewStateFromInvoiceResponse(response: PublicInvoiceResponse): PublicInvoiceViewState {
  return { kind: 'ready', details: response };
}

export function invoiceErrorViewState(kind: string): PublicInvoiceViewState {
  return kind === 'not-found' ? { kind: 'invalid' } : { kind: 'network-error' };
}

export function canRetryInvoice(state: PublicInvoiceViewState): boolean {
  return state.kind === 'network-error';
}

/** True once now is past dueDate and the invoice is still open. Presentation only. */
export function isInvoiceOverdue(details: PublicInvoiceDetails, now: Date = new Date()): boolean {
  if (details.state !== 'open' || !details.dueDate) return false;
  const due = new Date(details.dueDate);
  return Number.isFinite(due.getTime()) && now.getTime() > due.getTime();
}

export function invoiceStateHeadline(state: PublicInvoiceState): string {
  switch (state) {
    case 'open':
      return 'Your invoice';
    case 'expired':
      return 'This invoice link has expired';
    case 'void':
      return 'This invoice was canceled';
  }
}

export function invoiceStateDetail(state: PublicInvoiceState, overdue: boolean): string | null {
  switch (state) {
    case 'open':
      return overdue
        ? 'This invoice is past its due date. You can pay it securely below.'
        : 'You can pay this invoice securely below, or contact the business with any questions.';
    case 'expired':
      return 'Ask the business to send you a fresh link.';
    case 'void':
      return 'Contact the business if you have questions.';
  }
}

/** True when the customer should see a Pay action: open link, money still owed. */
export function canPayPublicInvoice(details: Pick<PublicInvoiceDetails, 'state' | 'payment'>): boolean {
  return details.state === 'open' && Number(details.payment.outstandingBalance) > 0;
}

export function invoicePaymentSummaryLabel(payment: PublicInvoicePayment): string | null {
  const paid = Number(payment.amountPaid);
  const outstanding = Number(payment.outstandingBalance);
  if (payment.state === 'PAID') return 'Paid in full';
  if (paid > 0 && outstanding > 0) return 'Partially paid';
  return null;
}
