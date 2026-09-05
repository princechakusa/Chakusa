import type { QuoteDocumentStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { parseOpaqueToken, tokenHashMatches } from "../../lib/authTokens.js";

// PROGRAM 3 LOOP 3D: account-less customer access to a sent quote via the
// revision-bound bearer token issued by POST /quotes/:id/send (Loop 3C).
//
// Security model (mirrors publicReviews.service.ts / PublicBookingAccess):
//   - the raw token is NEVER used in a query; its uuid prefix is parsed
//     out, the row is fetched by that id, then the full raw token is
//     constant-time compared against the stored SHA-256 hash;
//   - a malformed token, an unknown id, a hash mismatch and a
//     Chakusa-suspended business are ALL indistinguishable to the caller
//     (generic null -> 404), so a client can never enumerate tokens or
//     learn why one failed to resolve;
//   - the token resolves ONLY the immutable revision it was bound to at
//     send time - never "the document's current revision", so a future
//     SENT->SENT revision (Loop 3F) can issue a new token without this
//     one ever exposing newer commercial content;
//   - the response is a minimal read model: no internal ids, no business/
//     customer/lead/appointment/member ids, no other revisions, no token
//     metadata.

export type PublicQuoteState = "open" | "accepted" | "declined" | "canceled" | "expired";

type ResolvedToken = NonNullable<Awaited<ReturnType<typeof loadTokenRow>>>;

export interface ResolvedPublicQuote {
  state: PublicQuoteState;
  token: ResolvedToken;
}

function loadTokenRow(tokenId: string) {
  return prisma.quoteAcceptanceToken.findUnique({
    where: { id: tokenId },
    select: {
      tokenHash: true,
      expiresAt: true,
      revokedAt: true,
      quoteRevision: {
        select: {
          notes: true,
          terms: true,
          subtotal: true,
          discountTotal: true,
          taxTotal: true,
          total: true,
          lineItems: {
            orderBy: { sortOrder: "asc" },
            select: {
              description: true,
              quantity: true,
              unitPrice: true,
              discountAmount: true,
              taxable: true,
              lineTotal: true,
            },
          },
          quoteDocument: {
            select: {
              documentType: true,
              documentNumber: true,
              currency: true,
              status: true,
              expiresAt: true,
              business: { select: { name: true, platformStatus: true } },
            },
          },
        },
      },
    },
  });
}

function deriveState(documentStatus: QuoteDocumentStatus, tokenExpiresAt: Date, tokenRevokedAt: Date | null, now: Date): PublicQuoteState | null {
  // Terminal document states win over token expiry for display purposes -
  // an accepted quote should read "accepted" even if its token has since
  // lapsed.
  switch (documentStatus) {
    case "ACCEPTED":
      return "accepted";
    case "DECLINED":
      return "declined";
    case "CANCELED":
      return "canceled";
    case "EXPIRED":
      return "expired";
    case "SENT":
      if (tokenRevokedAt || tokenExpiresAt.getTime() <= now.getTime()) return "expired";
      return "open";
    case "DRAFT":
    default:
      // A token only ever exists for a document that reached SENT; a DRAFT
      // here would be a corrupted state. Fail closed as "not available".
      return null;
  }
}

/**
 * Resolves a raw bearer token to its bound quote revision, or null for
 * anything that is not a real, resolvable token (see the security-model
 * note above). A resolvable-but-terminal quote still resolves and carries
 * the matching `state`.
 */
export async function resolvePublicQuoteToken(rawToken: string, now: Date = new Date()): Promise<ResolvedPublicQuote | null> {
  const tokenId = parseOpaqueToken(rawToken);
  if (!tokenId) return null;

  const token = await loadTokenRow(tokenId);
  if (!token) return null;
  if (!tokenHashMatches(rawToken, token.tokenHash)) return null;

  const business = token.quoteRevision.quoteDocument.business;
  if (business.platformStatus !== "ACTIVE") return null;

  const state = deriveState(token.quoteRevision.quoteDocument.status, token.expiresAt, token.revokedAt, now);
  if (!state) return null;

  return { state, token };
}

/**
 * Minimal customer-facing view of the bound revision. Deliberately omits
 * every internal identifier and all token metadata - a bearer of the link
 * sees the commercial content and nothing that would let them pivot to
 * other tenants, customers or quotes.
 */
export function serializePublicQuote(resolved: ResolvedPublicQuote) {
  const { state, token } = resolved;
  const revision = token.quoteRevision;
  const document = revision.quoteDocument;

  return {
    state,
    documentType: document.documentType,
    documentNumber: document.documentNumber,
    currency: document.currency,
    expiresAt: document.expiresAt,
    business: { name: document.business.name },
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
