import type { QuoteDocumentStatus, QuoteDocumentType } from "@prisma/client";

// PROGRAM 3 LOOP 3A: pure Quotes & Estimates domain types. No routes, no
// Prisma queries, no I/O live in this module — see quotes.domain.ts for
// the functions that operate on these shapes. QuoteDocumentType/
// QuoteDocumentStatus are the Prisma-generated enums (re-exported here so
// callers of this domain layer don't need to import from "@prisma/client"
// directly for pure-logic purposes).

export type { QuoteDocumentStatus, QuoteDocumentType };

/**
 * The only actions this domain module knows how to validate a transition
 * for. "REVISE" is deliberately a SENT -> SENT self-transition (a new
 * QuoteRevision becomes current) — not a new top-level status — matching
 * the locked v1 lifecycle exactly.
 */
export type QuoteTransitionAction = "SEND" | "REVISE" | "ACCEPT" | "DECLINE" | "CANCEL" | "EXPIRE";

/** Raw input for one line item, before server-side calculation. Quantity/unitPrice/discountAmount accept anything `Prisma.Decimal` can parse (string, number, or Decimal) — the caller is never trusted to have already done the arithmetic. */
export interface QuoteLineItemInput {
  quantity: string | number;
  unitPrice: string | number;
  /** Flat monetary discount for this line, not a percentage. Defaults to 0. Must never exceed the line's pre-discount amount. */
  discountAmount?: string | number;
  taxable?: boolean;
}

/** One line item after server-side calculation — every monetary field is a rounded, 2-decimal-place Prisma.Decimal ready to persist as a QuoteLineItem row. */
export interface QuoteLineItemCalculated {
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  taxable: boolean;
  /** (quantity * unitPrice), rounded to 2dp — BEFORE this line's discount. */
  grossAmount: string;
  /** grossAmount - discountAmount, rounded to 2dp. Never negative. */
  lineTotal: string;
}

export interface QuoteTotalsInput {
  lineItems: QuoteLineItemInput[];
  /**
   * A single, explicit, business-supplied tax rate (0-100) applied
   * uniformly to the discounted total of every line marked `taxable`.
   * This is NOT a jurisdiction-aware tax engine — Chakusa does not know
   * VAT/GST/sales-tax rules for any region. A future loop may replace
   * this with per-jurisdiction logic without changing this input's shape
   * (0 stays a valid "no tax" rate).
   */
  taxRatePercent?: string | number;
}

export interface QuoteTotals {
  lineItems: QuoteLineItemCalculated[];
  /** Sum of every line's grossAmount (before discount). */
  subtotal: string;
  /** Sum of every line's discountAmount. */
  discountTotal: string;
  /** taxRatePercent applied to the sum of taxable lines' lineTotal, rounded to 2dp. */
  taxTotal: string;
  /** subtotal - discountTotal + taxTotal. */
  total: string;
}

export interface QuoteTransitionResult {
  ok: boolean;
  next?: QuoteDocumentStatus;
  reason?: string;
}

/** Formatted, human-facing document-number components. Counter allocation itself is database-authoritative — this only formats an already-allocated value. */
export interface DocumentNumberInput {
  documentType: QuoteDocumentType;
  year: number;
  counterValue: number;
}
