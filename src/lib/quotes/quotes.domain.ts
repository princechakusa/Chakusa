import { Prisma, type QuoteDocumentStatus } from "@prisma/client";
import { ApiError } from "../errors.js";
import type {
  DocumentNumberInput,
  QuoteLineItemCalculated,
  QuoteLineItemInput,
  QuoteTotals,
  QuoteTotalsInput,
  QuoteTransitionAction,
  QuoteTransitionResult,
} from "./quotes.types.js";

// PROGRAM 3 LOOP 3A: pure Quotes & Estimates domain logic. No Prisma
// queries, no Fastify, no I/O — every function here is a deterministic
// transformation of its inputs, matching this codebase's existing
// src/lib/entitlements.ts discipline ("domain logic first, routes call
// into it"). Money is never handled as a JavaScript float: every monetary
// value is parsed into a Prisma.Decimal (decimal.js under the hood,
// bundled with Prisma Client — no new dependency) and every output is
// rounded exactly once, at the point it is produced, using ROUND_HALF_UP
// (standard commercial rounding), never Math.round() on a float.

const TWO_DP = 2;
const round = (value: Prisma.Decimal) => value.toDecimalPlaces(TWO_DP, Prisma.Decimal.ROUND_HALF_UP);

// ---------------------------------------------------------------------------
// Totals — server-authoritative. A client-submitted total is NEVER trusted;
// every route that eventually creates/re-sends a QuoteRevision must call
// this and persist ITS output, never a value the mobile client computed.
// ---------------------------------------------------------------------------

/**
 * Line-level rounding first, then summation — the architecture
 * investigation's explicit recommendation. Every gross/line amount below
 * is rounded to 2dp the moment it is computed, so summing already-rounded
 * Decimals for subtotal/discountTotal never reintroduces a rounding
 * question at the total level (Prisma.Decimal addition is exact, not
 * floating-point).
 *
 * Throws ApiError.badRequest for any invalid input — negative/zero
 * quantity, negative unit price, negative discount, a discount exceeding
 * the line's own gross amount, or an out-of-range tax rate. A zero
 * quantity is rejected alongside negative quantity: a real line item
 * always represents *some* amount of work/goods — "free" is expressed via
 * a zero unitPrice or a full-amount discount, not a zero quantity, so
 * there is exactly one way to represent "no charge for this line."
 */
export function calculateQuoteTotals(input: QuoteTotalsInput): QuoteTotals {
  if (!input.lineItems.length) {
    throw ApiError.badRequest("A quote must have at least one line item to calculate totals");
  }

  const taxRatePercent = new Prisma.Decimal(input.taxRatePercent ?? 0);
  if (taxRatePercent.isNegative() || taxRatePercent.greaterThan(100)) {
    throw ApiError.badRequest("taxRatePercent must be between 0 and 100");
  }

  const calculated: QuoteLineItemCalculated[] = input.lineItems.map((line, index) => calculateLineItem(line, index));

  const subtotal = calculated.reduce((sum, line) => sum.plus(line.grossAmount), new Prisma.Decimal(0));
  const discountTotal = calculated.reduce((sum, line) => sum.plus(line.discountAmount), new Prisma.Decimal(0));
  const taxableBase = calculated
    .filter((line) => line.taxable)
    .reduce((sum, line) => sum.plus(line.lineTotal), new Prisma.Decimal(0));
  const taxTotal = round(taxableBase.times(taxRatePercent).dividedBy(100));
  // subtotal/discountTotal/taxTotal are each already exact 2dp values, so
  // this addition cannot introduce a new rounding decision — the
  // toDecimalPlaces call below is a formatting guarantee, not a second
  // rounding of already-imprecise data.
  const total = round(subtotal.minus(discountTotal).plus(taxTotal));

  return {
    lineItems: calculated,
    subtotal: subtotal.toFixed(TWO_DP),
    discountTotal: discountTotal.toFixed(TWO_DP),
    taxTotal: taxTotal.toFixed(TWO_DP),
    total: total.toFixed(TWO_DP),
  };
}

function calculateLineItem(line: QuoteLineItemInput, index: number): QuoteLineItemCalculated {
  const quantity = new Prisma.Decimal(line.quantity);
  const unitPrice = new Prisma.Decimal(line.unitPrice);
  const discountAmount = new Prisma.Decimal(line.discountAmount ?? 0);

  if (quantity.lessThanOrEqualTo(0)) {
    throw ApiError.badRequest(`Line item ${index + 1}: quantity must be greater than zero`, { index, field: "quantity" });
  }
  if (unitPrice.isNegative()) {
    throw ApiError.badRequest(`Line item ${index + 1}: unit price cannot be negative`, { index, field: "unitPrice" });
  }
  if (discountAmount.isNegative()) {
    throw ApiError.badRequest(`Line item ${index + 1}: discount cannot be negative`, { index, field: "discountAmount" });
  }

  const grossAmount = round(quantity.times(unitPrice));

  if (discountAmount.greaterThan(grossAmount)) {
    throw ApiError.badRequest(`Line item ${index + 1}: discount cannot exceed the line amount`, {
      index,
      field: "discountAmount",
      grossAmount: grossAmount.toFixed(TWO_DP),
    });
  }

  const lineTotal = round(grossAmount.minus(discountAmount));

  return {
    quantity: quantity.toFixed(TWO_DP),
    unitPrice: unitPrice.toFixed(TWO_DP),
    discountAmount: discountAmount.toFixed(TWO_DP),
    taxable: line.taxable ?? false,
    grossAmount: grossAmount.toFixed(TWO_DP),
    lineTotal: lineTotal.toFixed(TWO_DP),
  };
}

// ---------------------------------------------------------------------------
// Lifecycle — the LOCKED v1 transition graph. QuoteDocument.status is the
// only authoritative lifecycle field in the whole domain (see the schema's
// file-level doc comment) — this function is the single place that graph
// is encoded; nothing else in a future service/route layer should
// hand-roll its own status-transition check.
// ---------------------------------------------------------------------------

const LEGAL_TRANSITIONS: Record<QuoteDocumentStatus, Partial<Record<QuoteTransitionAction, QuoteDocumentStatus>>> = {
  DRAFT: { SEND: "SENT" },
  // REVISE is SENT -> SENT: a new QuoteRevision becomes current, the
  // document's own status does not change state.
  SENT: { REVISE: "SENT", ACCEPT: "ACCEPTED", DECLINE: "DECLINED", CANCEL: "CANCELED", EXPIRE: "EXPIRED" },
  ACCEPTED: {},
  DECLINED: {},
  CANCELED: {},
  EXPIRED: {},
};

/** Pure predicate — never throws. */
export function isLegalQuoteTransition(current: QuoteDocumentStatus, action: QuoteTransitionAction): boolean {
  return LEGAL_TRANSITIONS[current]?.[action] !== undefined;
}

/**
 * Returns the resulting status for a legal transition, or a result with
 * `ok: false` for an illegal one. Does not throw by default — a future
 * service layer decides whether to convert `ok: false` into an
 * ApiError.conflict at the route boundary (see `assertLegalQuoteTransition`
 * below for the throwing variant, matching entitlements.ts's
 * hasFeature/assertFeatureAvailable pairing).
 */
export function validateQuoteTransition(current: QuoteDocumentStatus, action: QuoteTransitionAction): QuoteTransitionResult {
  const next = LEGAL_TRANSITIONS[current]?.[action];
  if (next === undefined) {
    return { ok: false, reason: `Cannot ${action} a document in ${current} status` };
  }
  return { ok: true, next };
}

/** Throws ApiError.conflict for an illegal transition — the assert-style counterpart to validateQuoteTransition. */
export function assertLegalQuoteTransition(current: QuoteDocumentStatus, action: QuoteTransitionAction): QuoteDocumentStatus {
  const result = validateQuoteTransition(current, action);
  if (!result.ok) throw ApiError.conflict(result.reason!);
  return result.next!;
}

// ---------------------------------------------------------------------------
// Send guard
// ---------------------------------------------------------------------------

export interface CanSendQuoteInput {
  status: QuoteDocumentStatus;
  lineItems: QuoteLineItemInput[];
  taxRatePercent?: string | number;
}
export type CanSendQuoteResult =
  | { ok: true; totals: QuoteTotals }
  | { ok: false; reason: string };

/**
 * A document may be sent only when its status permits SEND (currently:
 * DRAFT) and its would-be current revision has at least one valid line
 * item with computable totals. Entitlement checking (QUOTES_ESTIMATES)
 * is explicitly OUT of scope here — that belongs at the future service/
 * route boundary, alongside tenant/authorization checks, not in this pure
 * function.
 */
export function canSendQuote(input: CanSendQuoteInput): CanSendQuoteResult {
  if (!isLegalQuoteTransition(input.status, "SEND")) {
    return { ok: false, reason: `Cannot send a document in ${input.status} status` };
  }
  if (!input.lineItems.length) {
    return { ok: false, reason: "A document cannot be sent with zero line items" };
  }
  try {
    const totals = calculateQuoteTotals({ lineItems: input.lineItems, taxRatePercent: input.taxRatePercent });
    return { ok: true, totals };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Invalid line items" };
  }
}

// ---------------------------------------------------------------------------
// Document numbering — pure formatting only. Counter allocation is
// database-authoritative (see prisma/schema.prisma's
// CommercialDocumentCounter) and is NOT performed here.
// ---------------------------------------------------------------------------

const DOCUMENT_TYPE_PREFIX: Record<DocumentNumberInput["documentType"], string> = {
  QUOTE: "Q",
  ESTIMATE: "E",
};
const COUNTER_PAD_WIDTH = 4;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

/**
 * Formats an already-allocated counter value into the customer/business-
 * facing document number, e.g. (QUOTE, 2026, 42) -> "Q-2026-0042". Never
 * allocates a counter value itself — that is exclusively the database
 * counter's job, to stay collision-safe under concurrency.
 */
export function formatDocumentNumber(input: DocumentNumberInput): string {
  if (!Number.isInteger(input.year) || input.year < MIN_YEAR || input.year > MAX_YEAR) {
    throw ApiError.badRequest(`year must be an integer between ${MIN_YEAR} and ${MAX_YEAR}`);
  }
  if (!Number.isInteger(input.counterValue) || input.counterValue <= 0) {
    throw ApiError.badRequest("counterValue must be a positive integer");
  }
  const prefix = DOCUMENT_TYPE_PREFIX[input.documentType];
  const padded = String(input.counterValue).padStart(COUNTER_PAD_WIDTH, "0");
  return `${prefix}-${input.year}-${padded}`;
}
