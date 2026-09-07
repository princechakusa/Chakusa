import { Prisma } from "@prisma/client";
import type { InvoiceStatus } from "@prisma/client";

// PROGRAM 3 / Invoicing I8: pure derivation of an invoice's payment
// position from its settled Stripe Connect transactions. No Prisma
// queries, no I/O. This is the ONLY place PAID / PARTIALLY_PAID / OVERDUE
// is decided - it is never stored on the Invoice (locked decision §3).
//
//   amountPaid        = sum of settled transaction amounts
//   amountRefunded    = sum of refunded amounts on those transactions
//   netPaid           = max(0, amountPaid - amountRefunded)
//   outstandingBalance = max(0, invoiceTotal - netPaid)
//   overdue predicate = outstandingBalance > 0
//                       AND a due date exists
//                       AND now is past it
//                       AND the lifecycle still permits collection (SENT)
//
// State precedence: PAID > OVERDUE > PARTIALLY_PAID > null(open / not due).

const TWO_DP = 2;
const round = (value: Prisma.Decimal) => value.toDecimalPlaces(TWO_DP, Prisma.Decimal.ROUND_HALF_UP);

export type InvoicePaymentState = "PAID" | "PARTIALLY_PAID" | "OVERDUE" | null;

export interface InvoicePaymentTransactionLike {
  status: string;
  amount: Prisma.Decimal | string | number;
  refundedAmount: Prisma.Decimal | string | number;
}

export interface DeriveInvoicePaymentInput {
  invoiceStatus: InvoiceStatus;
  dueDate: Date | null;
  currency: string;
  /** The frozen sent revision's grand total. */
  invoiceTotal: Prisma.Decimal | string | number | null;
  transactions: ReadonlyArray<InvoicePaymentTransactionLike>;
  now?: Date;
}

export interface InvoicePaymentSummary {
  currency: string;
  invoiceTotal: string;
  amountPaid: string;
  amountRefunded: string;
  outstandingBalance: string;
  state: InvoicePaymentState;
}

// A transaction counts toward money-in only once Stripe has actually
// settled it. "pending" and "failed" never move the balance.
const SETTLED = new Set(["paid", "partially_refunded", "refunded"]);

export function deriveInvoicePayment(input: DeriveInvoicePaymentInput): InvoicePaymentSummary {
  const zero = new Prisma.Decimal(0);
  const invoiceTotal = round(new Prisma.Decimal(input.invoiceTotal ?? 0));

  let amountPaid = zero;
  let amountRefunded = zero;
  for (const txn of input.transactions) {
    if (!SETTLED.has(txn.status)) continue;
    amountPaid = amountPaid.plus(new Prisma.Decimal(txn.amount));
    amountRefunded = amountRefunded.plus(new Prisma.Decimal(txn.refundedAmount));
  }
  amountPaid = round(amountPaid);
  amountRefunded = round(amountRefunded);

  const netPaid = Prisma.Decimal.max(zero, round(amountPaid.minus(amountRefunded)));
  const outstandingBalance = Prisma.Decimal.max(zero, round(invoiceTotal.minus(netPaid)));

  const now = input.now ?? new Date();
  const overdue =
    outstandingBalance.greaterThan(zero) &&
    input.dueDate != null &&
    now.getTime() > input.dueDate.getTime() &&
    input.invoiceStatus === "SENT";

  let state: InvoicePaymentState = null;
  if (netPaid.greaterThan(zero) && outstandingBalance.equals(zero)) {
    state = "PAID";
  } else if (overdue) {
    state = "OVERDUE";
  } else if (netPaid.greaterThan(zero) && outstandingBalance.greaterThan(zero)) {
    state = "PARTIALLY_PAID";
  }

  return {
    currency: input.currency,
    invoiceTotal: invoiceTotal.toFixed(TWO_DP),
    amountPaid: amountPaid.toFixed(TWO_DP),
    amountRefunded: amountRefunded.toFixed(TWO_DP),
    outstandingBalance: outstandingBalance.toFixed(TWO_DP),
    state,
  };
}
