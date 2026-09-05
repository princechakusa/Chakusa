import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { withLimitCheck } from "../../lib/entitlements.js";
import { parseOpaqueToken, tokenHashMatches } from "../../lib/authTokens.js";
import { assertLegalQuoteTransition } from "../../lib/quotes/quotes.domain.js";
import { TOKEN_ROW_SELECT, deriveState, serializePublicQuote, type PublicQuoteState } from "./publicQuotes.service.js";
import type { PublicQuoteDecisionInput } from "./publicQuotes.schemas.js";

// PROGRAM 3 LOOP 3E: customer accept / decline of a SENT quote via the
// revision-bound bearer token (Loop 3C / 3D). Terminal, atomic,
// single-winner, idempotent-safe.
//
//   SENT --accept--> ACCEPTED   (acceptedRevisionId := the token's bound revision)
//   SENT --decline-> DECLINED
//
// Every check the read path does (parse -> id lookup -> constant-time
// hash compare -> business active -> derived state) is re-done INSIDE the
// Serializable transaction against freshly-read rows - the pre-flight
// resolve in the route is only for shaping the error, never trusted for
// the write.
//
// NOT done here: invoice creation, appointment creation, payment capture,
// notifications, e-signature/legal consent capture. Those are out of
// scope for this stage.

type Decision = "accept" | "decline";

const ACTION_BY_DECISION = { accept: "ACCEPT", decline: "DECLINE" } as const;
const EVENT_BY_DECISION = { accept: "ACCEPTED", decline: "DECLINED" } as const;

export type PublicQuoteDecisionResult =
  | { outcome: "done"; quote: ReturnType<typeof serializePublicQuote> }
  | { outcome: "not_open"; state: Exclude<PublicQuoteState, "open"> };

export async function decidePublicQuote(
  rawToken: string,
  decision: Decision,
  input: PublicQuoteDecisionInput,
): Promise<PublicQuoteDecisionResult | null> {
  const tokenId = parseOpaqueToken(rawToken);
  if (!tokenId) return null;

  try {
    return await withLimitCheck(async (tx) => {
      const now = new Date();
      const token = await tx.quoteAcceptanceToken.findUnique({ where: { id: tokenId }, select: TOKEN_ROW_SELECT });
      if (!token) return null;
      if (!tokenHashMatches(rawToken, token.tokenHash)) return null;

      const revision = token.quoteRevision;
      const document = revision.quoteDocument;
      if (document.business.platformStatus !== "ACTIVE") return null;

      const state = deriveState(document.status, token.expiresAt, token.revokedAt, now);
      if (!state) return null;

      // Only an "open" quote (SENT + a live token) can be acted on. Any
      // other resolvable state is reported back verbatim so the route can
      // 409 with the real reason (already accepted / declined / canceled /
      // expired) - no double-accept, no accept-after-decline.
      if (state !== "open") {
        return { outcome: "not_open" as const, state };
      }

      // Defence in depth alongside the derived state.
      assertLegalQuoteTransition(document.status, ACTION_BY_DECISION[decision]);

      // The offer the customer is acting on is EXACTLY the revision this
      // token was bound to at send time. If the document's current
      // revision has moved on (only possible once Loop 3F revise exists,
      // which will revoke old tokens), this token must not act.
      if (document.currentRevisionId !== token.quoteRevisionId) {
        throw ApiError.conflict("This quote has been revised - please use the latest version");
      }

      const transitioned =
        decision === "accept"
          ? await tx.quoteDocument.updateMany({
              where: { id: document.id, status: "SENT", currentRevisionId: token.quoteRevisionId },
              data: { status: "ACCEPTED", acceptedRevisionId: token.quoteRevisionId },
            })
          : await tx.quoteDocument.updateMany({
              where: { id: document.id, status: "SENT" },
              data: { status: "DECLINED" },
            });
      if (transitioned.count !== 1) {
        // Lost the race to a concurrent decision on the same document.
        throw ApiError.conflict("This quote has already been actioned");
      }

      // Spend the acceptance capability - the link still RESOLVES for the
      // read path (showing the terminal state) but can never act again.
      await tx.quoteAcceptanceToken.updateMany({
        where: { quoteRevisionId: token.quoteRevisionId, revokedAt: null },
        data: { revokedAt: now },
      });

      await tx.quoteEvent.create({
        data: {
          quoteDocumentId: document.id,
          quoteRevisionId: token.quoteRevisionId,
          eventType: EVENT_BY_DECISION[decision],
          actorType: "CUSTOMER",
          actorId: null,
          metadata: input.note ? { note: input.note } : undefined,
        },
      });

      const updatedState = decision === "accept" ? ("accepted" as const) : ("declined" as const);
      return {
        outcome: "done" as const,
        quote: serializePublicQuote({ state: updatedState, token }),
      };
    });
  } catch (error) {
    // A serialization failure that survived withLimitCheck's retries, or a
    // conflict thrown above - surface as-is.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw ApiError.conflict("This quote is being updated - please try again");
    }
    throw error;
  }
}
