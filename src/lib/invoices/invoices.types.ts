import type { InvoiceStatus } from "@prisma/client";

// PROGRAM 3 / Invoicing I1: pure domain types. No Prisma queries, no I/O.
// InvoiceStatus is the Prisma-generated enum (re-exported so the pure
// domain layer's callers don't reach into "@prisma/client" directly).

export type { InvoiceStatus };

/**
 * The only lifecycle actions the domain validates. Invoices are simpler
 * than quotes: a DRAFT is edited freely (each edit = a new immutable
 * revision) or deleted; SEND freezes it; VOID is the terminal
 * cancellation and is legal from DRAFT or SENT. There is no customer
 * "accept" - an invoice is paid, and payment state is derived elsewhere
 * from the authoritative payment ledger.
 */
export type InvoiceTransitionAction = "SEND" | "VOID";

/** Raw line-item input, before server-side calculation. */
export interface InvoiceLineItemInput {
  quantity: string | number;
  unitPrice: string | number;
  discountAmount?: string | number;
  taxable?: boolean;
}

/** One line item after server-side calculation (all monetary fields are 2dp strings). */
export interface InvoiceLineItemCalculated {
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  taxable: boolean;
  grossAmount: string;
  lineTotal: string;
}

export interface InvoiceTotalsInput {
  lineItems: InvoiceLineItemInput[];
  /** A single explicit rate (0-100) applied to the discounted total of taxable lines. NOT a jurisdiction-aware tax engine. */
  taxRatePercent?: string | number;
}

export interface InvoiceTotals {
  lineItems: InvoiceLineItemCalculated[];
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
}

export interface InvoiceNumberInput {
  year: number;
  counterValue: number;
}
