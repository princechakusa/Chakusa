import type { InvoiceStatus } from "@prisma/client";
import { ApiError } from "../errors.js";
import { calculateQuoteTotals } from "../quotes/quotes.domain.js";
import type {
  InvoiceNumberInput,
  InvoiceTotals,
  InvoiceTotalsInput,
  InvoiceTransitionAction,
} from "./invoices.types.js";

// PROGRAM 3 / Invoicing I1: pure invoice domain logic. No Prisma, no
// Fastify, no I/O - every function is a deterministic transformation of
// its inputs, matching src/lib/quotes/quotes.domain.ts's discipline.
// Money is never a JS float: values are parsed to Prisma.Decimal
// (decimal.js) and rounded exactly once with ROUND_HALF_UP.

// ---------------------------------------------------------------------------
// Totals - server-authoritative. A client-submitted total is NEVER
// trusted. The line-then-round-then-sum arithmetic is byte-identical to a
// quote's (same commercial-document math), so this deliberately delegates
// to the single, battle-tested calculateQuoteTotals rather than keeping a
// second copy that could silently drift. Extracting a channel-neutral
// `src/lib/money` module is a safe follow-up refactor.
// ---------------------------------------------------------------------------

export function calculateInvoiceTotals(input: InvoiceTotalsInput): InvoiceTotals {
  return calculateQuoteTotals({ lineItems: input.lineItems, taxRatePercent: input.taxRatePercent });
}

// ---------------------------------------------------------------------------
// Lifecycle - the invoice transition graph.
//   DRAFT --SEND--> SENT
//   DRAFT --VOID--> VOID
//   SENT  --VOID--> VOID
// VOID is terminal. (A DRAFT is normally deleted rather than voided, but
// voiding one is still legal and leaves an audit trail.)
// ---------------------------------------------------------------------------

const LEGAL_INVOICE_TRANSITIONS: Record<InvoiceStatus, Partial<Record<InvoiceTransitionAction, InvoiceStatus>>> = {
  DRAFT: { SEND: "SENT", VOID: "VOID" },
  SENT: { VOID: "VOID" },
  VOID: {},
};

export function isLegalInvoiceTransition(current: InvoiceStatus, action: InvoiceTransitionAction): boolean {
  return LEGAL_INVOICE_TRANSITIONS[current]?.[action] !== undefined;
}

export interface InvoiceTransitionResult {
  ok: boolean;
  next?: InvoiceStatus;
  reason?: string;
}

/** Never throws - a service layer decides whether to convert ok:false into a 409. */
export function validateInvoiceTransition(current: InvoiceStatus, action: InvoiceTransitionAction): InvoiceTransitionResult {
  const next = LEGAL_INVOICE_TRANSITIONS[current]?.[action];
  if (next === undefined) return { ok: false, reason: `Cannot ${action.toLowerCase()} an invoice in ${current} status` };
  return { ok: true, next };
}

/** Throws ApiError.conflict for an illegal transition. */
export function assertLegalInvoiceTransition(current: InvoiceStatus, action: InvoiceTransitionAction): InvoiceStatus {
  const result = validateInvoiceTransition(current, action);
  if (!result.ok) throw ApiError.conflict(result.reason!);
  return result.next!;
}

// ---------------------------------------------------------------------------
// Send guard - an invoice may be sent only from DRAFT and only with at
// least one valid line item (empty invoices are never customer-visible).
// ---------------------------------------------------------------------------

export interface CanSendInvoiceInput {
  status: InvoiceStatus;
  lineItems: InvoiceTotalsInput["lineItems"];
  taxRatePercent?: string | number;
}
export type CanSendInvoiceResult = { ok: true; totals: InvoiceTotals } | { ok: false; reason: string };

export function canSendInvoice(input: CanSendInvoiceInput): CanSendInvoiceResult {
  if (!isLegalInvoiceTransition(input.status, "SEND")) {
    return { ok: false, reason: `Cannot send an invoice in ${input.status} status` };
  }
  if (!input.lineItems.length) {
    return { ok: false, reason: "An invoice cannot be sent with zero line items" };
  }
  try {
    const totals = calculateInvoiceTotals({ lineItems: input.lineItems, taxRatePercent: input.taxRatePercent });
    return { ok: true, totals };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Invalid line items" };
  }
}

// ---------------------------------------------------------------------------
// Numbering - pure formatting only. Counter allocation is database-
// authoritative (InvoiceCounter, one sequence per business per year).
// ---------------------------------------------------------------------------

const INVOICE_NUMBER_PREFIX = "INV";
const COUNTER_PAD_WIDTH = 4;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

/** (2026, 42) -> "INV-2026-0042". Never allocates - that is the DB counter's job. */
export function formatInvoiceNumber(input: InvoiceNumberInput): string {
  if (!Number.isInteger(input.year) || input.year < MIN_YEAR || input.year > MAX_YEAR) {
    throw ApiError.badRequest(`year must be an integer between ${MIN_YEAR} and ${MAX_YEAR}`);
  }
  if (!Number.isInteger(input.counterValue) || input.counterValue <= 0) {
    throw ApiError.badRequest("counterValue must be a positive integer");
  }
  const padded = String(input.counterValue).padStart(COUNTER_PAD_WIDTH, "0");
  return `${INVOICE_NUMBER_PREFIX}-${input.year}-${padded}`;
}
