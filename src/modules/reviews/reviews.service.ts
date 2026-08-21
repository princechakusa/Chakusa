import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { recordActivity } from "../../lib/activity.js";
import { renderTemplate } from "../../lib/templateEngine.js";
import { getDefaultTemplateBody } from "../../lib/defaultTemplates.js";
import { notifyReviewReceived } from "../../lib/notifications/notificationTriggers.js";
import { assertFeatureAvailable, assertUnderLimit, getPlanLimits, startOfCurrentUtcMonth, startOfNextUtcMonth, withLimitCheck } from "../../lib/entitlements.js";
import { generateOpaqueToken } from "../../lib/authTokens.js";
import { config } from "../../lib/config.js";
import { buildPublicReviewUrl } from "../../lib/publicReviewLinks.js";
import { sendMessage } from "../messages/messages.service.js";
import type { CreateReviewRequestInput, UpdateReviewRequestInput } from "./reviews.schemas.js";
import type { Prisma, Plan, SubscriptionStatus } from "@prisma/client";
import type { PushProvider } from "../../lib/push/pushProvider.js";
import type { MessagingProvider } from "../../lib/messaging/messagingProvider.js";

type DatabaseClient = typeof prisma | Prisma.TransactionClient;

// Internal public-token bookkeeping (see generatePublicReviewLink) — never
// part of any authenticated ReviewRequest response. The hash is a one-way
// digest of the customer's link, not itself a working credential, but it's
// still purely internal state with no client use; stripping it (and its
// sibling fields) keeps "the token" from ever surfacing outside the two
// dedicated issuance paths (generatePublicReviewLink, generateReviewMessage)
// that return the raw value once, on purpose. Plain destructuring rather
// than Prisma's `omit` query option, which this generated client doesn't
// expose.
function stripPublicTokenFields<T extends {
  publicTokenId: string | null;
  publicTokenHash: string | null;
  publicTokenExpiresAt: Date | null;
  publicTokenConsumedAt: Date | null;
}>(reviewRequest: T): Omit<T, "publicTokenId" | "publicTokenHash" | "publicTokenExpiresAt" | "publicTokenConsumedAt"> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- deliberately dropped, not reused
  const { publicTokenId, publicTokenHash, publicTokenExpiresAt, publicTokenConsumedAt, ...rest } = reviewRequest;
  return rest;
}

export async function listReviewRequests(businessId: string) {
  const reviewRequests = await prisma.reviewRequest.findMany({
    where: { businessId },
    orderBy: { createdAt: "desc" },
    include: { customer: true },
  });
  return reviewRequests.map(stripPublicTokenFields);
}

async function assertCustomerInBusiness(businessId: string, customerId: string) {
  const customer = await prisma.customer.findFirst({ where: { id: customerId, businessId } });
  if (!customer) {
    throw ApiError.badRequest("customerId does not belong to this business");
  }
}

export async function createReviewRequest(
  businessId: string,
  actorId: string,
  input: CreateReviewRequestInput,
  plan: Plan,
) {
  if (input.customerId) {
    await assertCustomerInBusiness(businessId, input.customerId);
  }

  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });

  const limit = getPlanLimits(plan).reviewRequestsPerMonth;
  const periodStart = startOfCurrentUtcMonth();

  const reviewRequest = await withLimitCheck(async (tx) => {
    if (limit !== null) {
      const current = await tx.reviewRequest.count({ where: { businessId, createdAt: { gte: periodStart } } });
      assertUnderLimit({ plan, resource: "reviewRequests", limit, current, periodResetsAt: startOfNextUtcMonth() });
    }

    return tx.reviewRequest.create({
      data: {
        businessId,
        customerId: input.customerId,
        serviceName: input.serviceName,
        message: input.message,
        googleReviewLink: business.googleReviewLink,
      },
    });
  });

  await recordActivity({
    businessId,
    actorId,
    eventType: "REVIEW_REQUEST_CREATED",
    entityType: "review_request",
    entityId: reviewRequest.id,
  });

  return stripPublicTokenFields(reviewRequest);
}

/**
 * Marketing module's "Review campaign" target audience: customers with at
 * least one won lead who have never once been sent a review request for
 * this business — deliberately "ever," not "since their last won lead," so
 * a customer already mid-flow on an existing request isn't asked twice in
 * the same campaign.
 */
async function customersDueForReviewRequest(businessId: string) {
  return prisma.customer.findMany({
    where: { businessId, leads: { some: { status: "won" } }, reviewRequests: { none: {} } },
  });
}

// Callers only ever pass a review request freshly created in this same
// bulk flow — always unconsumed — so unlike generateReviewMessage's
// single-request path, there's no "already consumed" case to special-case
// here.
async function renderReviewRequestMessage(
  reviewRequest: { serviceName: string | null; id: string },
  business: { id: string; name: string; industry: string | null },
  template: { body: string } | null,
  customerName: string | undefined,
) {
  const body = template?.body ?? getDefaultTemplateBody("review_request", business.industry);
  const reviewLink = buildPublicReviewUrl((await generatePublicReviewLink(business.id, reviewRequest.id)).token);
  return renderTemplate(body, {
    customer_name: customerName ?? "there",
    business_name: business.name,
    service_name: reviewRequest.serviceName ?? "your service",
    review_link: reviewLink,
  });
}

/**
 * Available on every plan — creates (respecting the same monthly
 * reviewRequestsPerMonth limit as the single-request flow) and prepares a
 * message for every customer due per customersDueForReviewRequest above.
 * A Free business that hits its monthly limit partway through still gets
 * every request it has quota for; the rest are reported back as skipped
 * rather than failing the whole campaign.
 */
export async function bulkCreateReviewRequests(businessId: string, actorId: string, plan: Plan) {
  const [customers, business, template] = await Promise.all([
    customersDueForReviewRequest(businessId),
    prisma.business.findUniqueOrThrow({ where: { id: businessId } }),
    prisma.messageTemplate.findFirst({
      where: { businessId, templateType: "review_request" },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }, { id: "asc" }],
    }),
  ]);

  const results: { id: string; customerName: string; message: string }[] = [];
  const skipped: { customerName: string; reason: string }[] = [];
  for (const customer of customers) {
    try {
      const reviewRequest = await createReviewRequest(businessId, actorId, { customerId: customer.id }, plan);
      const message = await renderReviewRequestMessage(reviewRequest, business, template, customer.name);
      await prisma.reviewRequest.update({ where: { id: reviewRequest.id }, data: { message } });
      results.push({ id: reviewRequest.id, customerName: customer.name, message });
    } catch (error) {
      skipped.push({ customerName: customer.name, reason: error instanceof ApiError ? error.message : "Could not create this review request" });
    }
  }
  return { created: results, skipped };
}

/**
 * Pro+ one-tap version — reuses bulkCreateReviewRequests to prepare (or
 * pick up any already-pending, unsent) review requests, then sends each via
 * the same sendMessage pipeline bulkSendReminders uses. Same
 * per-recipient-isolation reasoning: one bad phone number or opt-out never
 * blocks the rest of the campaign.
 */
export async function bulkSendReviewRequests(
  businessId: string,
  actorId: string,
  plan: Plan,
  status: SubscriptionStatus,
  provider?: MessagingProvider,
) {
  assertFeatureAvailable(plan, status, "OUTBOUND_MESSAGING");

  const prepared = await bulkCreateReviewRequests(businessId, actorId, plan);

  const results: { id: string; customerName: string; outcome: "sent" | "failed"; reason?: string }[] = [];
  for (const item of prepared.created) {
    const reviewRequest = await prisma.reviewRequest.findFirstOrThrow({ where: { id: item.id } });
    if (!reviewRequest.customerId) {
      results.push({ id: item.id, customerName: item.customerName, outcome: "failed", reason: "No customer on this review request" });
      continue;
    }
    try {
      await sendMessage(businessId, { customerId: reviewRequest.customerId, body: item.message, messageType: "review_request" }, plan, status, provider);
      await markReviewRequestSent(businessId, actorId, item.id);
      results.push({ id: item.id, customerName: item.customerName, outcome: "sent" });
    } catch (error) {
      const reason = error instanceof ApiError ? error.message : "Could not send this message";
      results.push({ id: item.id, customerName: item.customerName, outcome: "failed", reason });
    }
  }

  return {
    sentCount: results.filter((r) => r.outcome === "sent").length,
    failedCount: results.filter((r) => r.outcome === "failed").length,
    skippedCount: prepared.skipped.length,
    results,
    skipped: prepared.skipped,
  };
}

async function getOwnedReviewRequest(businessId: string, id: string) {
  const reviewRequest = await prisma.reviewRequest.findFirst({ where: { id, businessId } });
  if (!reviewRequest) {
    throw ApiError.notFound("Review request not found");
  }
  return reviewRequest;
}

export async function getReviewRequest(businessId: string, id: string) {
  const reviewRequest = await prisma.reviewRequest.findFirst({
    where: { id, businessId },
    include: { customer: true, feedback: true },
  });
  if (!reviewRequest) {
    throw ApiError.notFound("Review request not found");
  }
  return stripPublicTokenFields(reviewRequest);
}

/**
 * Mints (or re-mints) the token for this review request's public,
 * unauthenticated link — see src/modules/public/publicReviews.service.ts
 * for the customer-facing side. Deliberately lazy: called only when the
 * business explicitly asks for the link, not automatically at
 * createReviewRequest time. Eagerly minting one for every review request
 * would start each token's expiry clock before the business has actually
 * sent anything — many review requests sit unsent for a while (the
 * existing flow is create -> generate-message -> mark-sent, all separate
 * manual steps), so an eagerly-created token could expire before it's ever
 * used.
 *
 * Always issues a fresh token rather than returning a previously-generated
 * one, even if a still-valid one exists. This isn't "rotate on every read"
 * (GET /review-requests/:id never touches the token) — it's a direct
 * consequence of only ever storing the token's hash: once the raw value
 * has been returned from a prior call, it cannot be recovered to return
 * again, so the only sane response to "give me the link" a second time is
 * a new one. Any previously-issued token for this request stops working
 * the moment a new one is minted (its hash is overwritten), which is safe
 * since only the same authenticated business member who receives this
 * response could have had the old raw value in the first place.
 */
export async function generatePublicReviewLink(businessId: string, id: string) {
  await getOwnedReviewRequest(businessId, id);

  const { id: tokenId, raw, hash } = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + config.PUBLIC_REVIEW_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.reviewRequest.update({
    where: { id },
    data: {
      publicTokenId: tokenId,
      publicTokenHash: hash,
      publicTokenExpiresAt: expiresAt,
      // A fresh token is always usable, even if the previous one had
      // already been consumed by a customer submission.
      publicTokenConsumedAt: null,
    },
  });

  // The raw token is returned here and NEVER persisted or logged anywhere
  // — this is the only moment it exists outside the caller's response.
  return { token: raw, expiresAt };
}

export async function updateReviewRequest(
  businessId: string,
  id: string,
  input: UpdateReviewRequestInput,
) {
  await getOwnedReviewRequest(businessId, id);
  const reviewRequest = await prisma.reviewRequest.update({ where: { id }, data: input });
  return stripPublicTokenFields(reviewRequest);
}

export async function generateReviewMessage(businessId: string, id: string) {
  const reviewRequest = await prisma.reviewRequest.findFirst({
    where: { id, businessId },
    include: { customer: true },
  });
  if (!reviewRequest) {
    throw ApiError.notFound("Review request not found");
  }

  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });

  const template = await prisma.messageTemplate.findFirst({
    where: { businessId, templateType: "review_request" },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }, { id: "asc" }],
  });

  const body = template?.body ?? getDefaultTemplateBody("review_request", business.industry);

  // {{review_link}} is Chakusa's own public review/feedback page, never the
  // business's Google review link directly — the public page itself is what
  // offers the Google review choice (GET /public/reviews/:token already
  // returns googleReviewLink unconditionally), so the message always routes
  // through Chakusa first rather than sending customers straight to Google.
  //
  // A fresh token is minted on every call rather than reusing a prior one:
  // the token architecture stores only a hash (see generatePublicReviewLink
  // above), so a previously-issued raw token can never be recovered to
  // reuse — regenerating the message necessarily invalidates any
  // not-yet-used link from an earlier generation, the same accepted
  // trade-off generatePublicReviewLink already documents. The one exception
  // is a review request whose token has already been consumed (the
  // customer already submitted feedback): minting a fresh token there would
  // hand out a new, working one-time submission link and defeat the
  // one-submission guarantee, so that case renders with no link at all
  // instead of rotating.
  const reviewLink = reviewRequest.publicTokenConsumedAt
    ? ""
    : buildPublicReviewUrl((await generatePublicReviewLink(businessId, id)).token);

  const rendered = renderTemplate(body, {
    customer_name: reviewRequest.customer?.name ?? "there",
    business_name: business.name,
    service_name: reviewRequest.serviceName ?? "your service",
    review_link: reviewLink,
  });

  await prisma.reviewRequest.update({ where: { id }, data: { message: rendered } });

  return { message: rendered };
}

export async function markReviewRequestOpened(businessId: string, actorId: string, id: string) {
  await getOwnedReviewRequest(businessId, id);

  const reviewRequest = await prisma.reviewRequest.update({
    where: { id },
    data: { status: "opened" },
  });

  await recordActivity({
    businessId,
    actorId,
    eventType: "REVIEW_OPENED",
    entityType: "review_request",
    entityId: id,
  });

  return stripPublicTokenFields(reviewRequest);
}

export async function markReviewRequestSent(businessId: string, actorId: string, id: string) {
  await getOwnedReviewRequest(businessId, id);

  const reviewRequest = await prisma.reviewRequest.update({
    where: { id },
    data: { status: "sent", sentAt: new Date() },
  });

  await recordActivity({
    businessId,
    actorId,
    eventType: "REVIEW_REQUEST_SENT",
    entityType: "review_request",
    entityId: id,
  });

  return stripPublicTokenFields(reviewRequest);
}

/**
 * Uses the same claim-guard pattern as markReviewRequestFeedbackReceived:
 * the updateMany's WHERE clause (status not already "reviewed") makes the
 * claim atomic via Postgres row-level locking, so at most one of any number
 * of concurrent or repeated calls records the activity event and sends the
 * "new review" notification — a retried or double-tapped mark-reviewed call
 * is a harmless no-op instead of a duplicate push.
 */
export async function markReviewRequestReviewed(
  businessId: string,
  actorId: string,
  id: string,
  pushProvider?: PushProvider,
) {
  const existing = await getOwnedReviewRequest(businessId, id);

  const claimed = await prisma.reviewRequest.updateMany({
    where: { id, businessId, status: { not: "reviewed" } },
    data: { status: "reviewed" },
  });

  if (claimed.count > 0) {
    await recordActivity({
      businessId,
      actorId,
      eventType: "REVIEW_RECEIVED",
      entityType: "review_request",
      entityId: id,
    });

    await notifyReviewReceived(businessId, { id, serviceName: existing.serviceName }, pushProvider);
  }

  const reviewRequest = await prisma.reviewRequest.findFirstOrThrow({ where: { id, businessId } });
  return stripPublicTokenFields(reviewRequest);
}

/**
 * Atomically transitions a review request to feedback_received and logs the
 * FEEDBACK_RECEIVED activity event exactly once, even if two requests race
 * to make the same transition concurrently.
 *
 * The atomicity comes from the updateMany's WHERE clause, not from
 * transaction isolation level: `status: { not: "feedback_received" }` acts
 * as a claim guard, so Postgres row-level locking on the UPDATE guarantees
 * at most one of two concurrent callers can match and flip the status. The
 * loser's updateMany matches zero rows and therefore skips the activity
 * write — both callers still return the (now-identical) up-to-date row, but
 * only the winner logs the transition.
 *
 * Pass `db` (a transaction client) when this needs to be part of a larger
 * atomic operation, e.g. feedback creation + this transition + both
 * activity events all committing or rolling back together.
 */
export async function markReviewRequestFeedbackReceived(
  businessId: string,
  // null for a public, customer-submitted feedback — see
  // feedback.service.ts's createFeedback and
  // src/modules/public/publicReviews.service.ts.
  actorId: string | null,
  id: string,
  db: DatabaseClient = prisma,
) {
  const existing = await db.reviewRequest.findFirst({ where: { id, businessId } });
  if (!existing) {
    throw ApiError.notFound("Review request not found");
  }

  const claimed = await db.reviewRequest.updateMany({
    where: { id, businessId, status: { not: "feedback_received" } },
    data: { status: "feedback_received" },
  });

  if (claimed.count > 0) {
    await recordActivity(
      {
        businessId,
        actorId,
        eventType: "FEEDBACK_RECEIVED",
        entityType: "review_request",
        entityId: id,
      },
      db,
    );
  }

  const reviewRequest = await db.reviewRequest.findFirstOrThrow({ where: { id, businessId } });
  return stripPublicTokenFields(reviewRequest);
}
