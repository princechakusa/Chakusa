import type { InvoiceStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { parseOpaqueToken, tokenHashMatches } from "../../lib/authTokens.js";
import { deriveInvoicePayment } from "../../lib/invoices/invoicePayments.domain.js";

// PROGRAM 3 / Invoicing I4: account-less customer access to a SENT
// invoice via the bearer token from POST /invoices/:id/send.
//
// Security model (mirrors publicQuotes.service.ts / PublicBookingAccess):
//   - the raw token is NEVER used in a query; its uuid prefix is parsed
//     out, the row fetched by id, then the full raw token constant-time
//     compared against the stored SHA-256 hash;
//   - a malformed token, unknown id, hash mismatch and a
//     Chakusa-suspended business are ALL indistinguishable (generic 404),
//     so a client can never enumerate tokens;
//   - the token resolves ONLY the revision it was bound to at send time;
//   - the response is a minimal read model: no internal ids, no token
//     metadata, no provider secrets, no internal audit fields.

export type PublicInvoiceState = "open" | "expired" | "void";

const TOKEN_ROW_SELECT = {
  id: true,
  tokenHash: true,
  expiresAt: true,
  revokedAt: true,
  invoiceRevisionId: true,
  invoiceRevision: {
    select: {
      notes: true,
      terms: true,
      subtotal: true,
      discountTotal: true,
      taxTotal: true,
      total: true,
      lineItems: {
        orderBy: { sortOrder: "asc" as const },
        select: { description: true, quantity: true, unitPrice: true, discountAmount: true, taxable: true, lineTotal: true },
      },
      invoice: {
        select: {
          id: true,
          businessId: true,
          invoiceNumber: true,
          currency: true,
          status: true,
          issueDate: true,
          dueDate: true,
          currentRevisionId: true,
          business: { select: { name: true, platformStatus: true } },
          payments: { select: { status: true, amount: true, refundedAmount: true } },
        },
      },
    },
  },
};

type ResolvedToken = NonNullable<Awaited<ReturnType<typeof loadTokenRow>>>;

export interface ResolvedPublicInvoice {
  state: PublicInvoiceState;
  token: ResolvedToken;
}

function loadTokenRow(tokenId: string) {
  return prisma.invoiceAccessToken.findUnique({ where: { id: tokenId }, select: TOKEN_ROW_SELECT });
}

export { TOKEN_ROW_SELECT };

export function deriveState(status: InvoiceStatus, tokenExpiresAt: Date, tokenRevokedAt: Date | null, now: Date): PublicInvoiceState | null {
  switch (status) {
    case "VOID":
      return "void";
    case "SENT":
      if (tokenRevokedAt || tokenExpiresAt.getTime() <= now.getTime()) return "expired";
      return "open";
    case "DRAFT":
    default:
      // A token only ever exists for an invoice that reached SENT.
      return null;
  }
}

export async function resolvePublicInvoiceToken(rawToken: string, now: Date = new Date()): Promise<ResolvedPublicInvoice | null> {
  const tokenId = parseOpaqueToken(rawToken);
  if (!tokenId) return null;

  const token = await loadTokenRow(tokenId);
  if (!token) return null;
  if (!tokenHashMatches(rawToken, token.tokenHash)) return null;

  const invoice = token.invoiceRevision.invoice;
  if (invoice.business.platformStatus !== "ACTIVE") return null;

  const state = deriveState(invoice.status, token.expiresAt, token.revokedAt, now);
  if (!state) return null;

  return { state, token };
}

/**
 * Minimal customer-facing view of the sent revision. No internal ids, no
 * token metadata. Payment information is intentionally absent - it will
 * be added only once it is derivable from the authoritative payment
 * ledger (a later stage), never a convenience field.
 */
export function serializePublicInvoice(resolved: ResolvedPublicInvoice) {
  const { state, token } = resolved;
  const revision = token.invoiceRevision;
  const invoice = revision.invoice;

  const payment = deriveInvoicePayment({
    invoiceStatus: invoice.status,
    dueDate: invoice.dueDate,
    currency: invoice.currency,
    invoiceTotal: revision.total,
    transactions: invoice.payments,
  });

  return {
    state,
    invoiceNumber: invoice.invoiceNumber,
    currency: invoice.currency,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    business: { name: invoice.business.name },
    payment: {
      currency: payment.currency,
      invoiceTotal: payment.invoiceTotal,
      amountPaid: payment.amountPaid,
      outstandingBalance: payment.outstandingBalance,
      state: payment.state,
    },
    revision: {
      notes: revision.notes,
      terms: revision.terms,
      totals: {
        subtotal: revision.subtotal.toFixed(2),
        discountTotal: revision.discountTotal.toFixed(2),
        taxTotal: revision.taxTotal.toFixed(2),
        total: revision.total.toFixed(2),
      },
      lineItems: revision.lineItems.map((line) => ({
        description: line.description,
        quantity: line.quantity.toFixed(2),
        unitPrice: line.unitPrice.toFixed(2),
        discountAmount: line.discountAmount.toFixed(2),
        taxable: line.taxable,
        lineTotal: line.lineTotal.toFixed(2),
      })),
    },
  };
}
