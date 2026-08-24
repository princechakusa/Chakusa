import { prisma } from "../../lib/prisma.js";
import { parseOpaqueToken, tokenHashMatches } from "../../lib/authTokens.js";
import { recordActivity } from "../../lib/activity.js";
import { createFeedback } from "../feedback/feedback.service.js";
import type { SubmitPublicFeedbackInput } from "./public.schemas.js";
import type { Business, ReviewRequest } from "@prisma/client";
import type { PushProvider } from "../../lib/push/pushProvider.js";

export type PublicReviewState = "open" | "submitted" | "expired";

interface ResolvedPublicReview {
  state: PublicReviewState;
  reviewRequest: ReviewRequest & { business: Business };
}

/**
 * Resolves a raw public token to its ReviewRequest, or null for anything
 * that isn't a real, currently-valid token — malformed, unknown, or a
 * hash mismatch are all indistinguishable from the caller's perspective
 * (generic not-found), so a client can never learn *why* a token didn't
 * resolve, only that it didn't. Expired/consumed tokens DO resolve (the
 * token is real) but carry a `state` other than "open" — see
 * public.routes.ts for how each state is handled.
 */
export async function resolvePublicReviewToken(rawToken: string): Promise<ResolvedPublicReview | null> {
  const tokenId = parseOpaqueToken(rawToken);
  if (!tokenId) return null;

  const reviewRequest = await prisma.reviewRequest.findUnique({
    where: { publicTokenId: tokenId },
    include: { business: true },
  });
  if (!reviewRequest || !reviewRequest.publicTokenHash) return null;
  if (reviewRequest.business.platformStatus !== "ACTIVE") return null;
  if (!tokenHashMatches(rawToken, reviewRequest.publicTokenHash)) return null;

  if (reviewRequest.publicTokenExpiresAt && reviewRequest.publicTokenExpiresAt <= new Date()) {
    return { state: "expired", reviewRequest };
  }
  if (reviewRequest.publicTokenConsumedAt) {
    return { state: "submitted", reviewRequest };
  }
  return { state: "open", reviewRequest };
}

/**
 * The public GET's only side effect: advances pending/sent -> opened, the
 * same status a business owner could previously only set manually as a
 * guess. This is now the real, customer-triggered signal. A claim-guard
 * updateMany (same pattern as markReviewRequestReviewed) means repeat
 * views of the same link — reloads, a customer reopening it later — never
 * re-fire the transition or its activity event once it's already recorded;
 * it also never regresses a request that's already moved past "opened"
 * (e.g. back from "reviewed").
 */
export async function markPublicReviewOpened(reviewRequest: ReviewRequest): Promise<void> {
  const claimed = await prisma.reviewRequest.updateMany({
    where: { id: reviewRequest.id, status: { in: ["pending", "sent"] } },
    data: { status: "opened" },
  });

  if (claimed.count > 0) {
    await recordActivity({
      businessId: reviewRequest.businessId,
      actorId: null,
      eventType: "REVIEW_OPENED",
      entityType: "review_request",
      entityId: reviewRequest.id,
    });
  }
}

export type SubmitPublicFeedbackResult =
  | { outcome: "expired" }
  | { outcome: "already_submitted" }
  | { outcome: "submitted"; feedback: Awaited<ReturnType<typeof createFeedback>> };

/**
 * The public POST's core logic — resolution, expiry, and idempotent
 * consumption all live here so public.routes.ts stays a thin HTTP layer.
 *
 * Idempotency: the token's one-time consumption (publicTokenConsumedAt) is
 * claimed via the same atomic-updateMany-with-a-WHERE-guard pattern used
 * throughout this codebase (markReviewRequestReviewed,
 * markReviewRequestFeedbackReceived) — a genuine double-tap or two
 * concurrent identical requests can only let ONE of them win the claim;
 * the other observes `count === 0` and returns the same
 * "already_submitted" outcome, never creating a second Feedback row.
 *
 * The claim and the actual createFeedback() call are two sequential
 * writes, not one transaction — see the Phase report for why that's an
 * accepted, documented trade-off rather than an oversight. If
 * createFeedback() throws after the claim succeeded, the claim is released
 * (compensating update) so a transient failure never permanently burns the
 * customer's only token.
 */
export async function submitPublicFeedback(
  rawToken: string,
  input: SubmitPublicFeedbackInput,
  pushProvider?: PushProvider,
): Promise<SubmitPublicFeedbackResult | null> {
  const resolved = await resolvePublicReviewToken(rawToken);
  if (!resolved) return null;

  const { reviewRequest } = resolved;

  if (resolved.state === "expired") return { outcome: "expired" };
  if (resolved.state === "submitted") return { outcome: "already_submitted" };

  const claimed = await prisma.reviewRequest.updateMany({
    where: { id: reviewRequest.id, publicTokenConsumedAt: null },
    data: { publicTokenConsumedAt: new Date() },
  });
  if (claimed.count === 0) {
    // Lost a race to a concurrent submission for the same token.
    return { outcome: "already_submitted" };
  }

  try {
    const feedback = await createFeedback(
      reviewRequest.businessId,
      null,
      {
        customerId: reviewRequest.customerId ?? undefined,
        reviewRequestId: reviewRequest.id,
        rating: input.rating,
        comment: input.comment,
      },
      pushProvider,
    );
    return { outcome: "submitted", feedback };
  } catch (error) {
    await prisma.reviewRequest
      .updateMany({
        where: { id: reviewRequest.id, publicTokenConsumedAt: { not: null } },
        data: { publicTokenConsumedAt: null },
      })
      .catch(() => undefined);
    throw error;
  }
}

/**
 * Only what a customer needs to render the choice screen — see the Phase
 * report's "public data exposure" section for the full audit of what this
 * deliberately omits (businessId, customer PII, internal notes/status,
 * subscription data, provider/credential fields).
 */
export function serializeOpenOrSubmittedReview(reviewRequest: ReviewRequest & { business: Business }, state: "open" | "submitted") {
  return {
    state,
    business: { name: reviewRequest.business.name },
    serviceName: reviewRequest.serviceName,
    googleReviewLink: reviewRequest.googleReviewLink ?? reviewRequest.business.googleReviewLink ?? null,
  };
}
