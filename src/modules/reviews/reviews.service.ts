import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { recordActivity } from "../../lib/activity.js";
import { renderTemplate } from "../../lib/templateEngine.js";
import { getDefaultTemplateBody } from "../../lib/defaultTemplates.js";
import { notifyReviewReceived } from "../../lib/notifications/notificationTriggers.js";
import { assertUnderLimit, getPlanLimits, startOfCurrentUtcMonth, startOfNextUtcMonth, withLimitCheck } from "../../lib/entitlements.js";
import type { CreateReviewRequestInput, UpdateReviewRequestInput } from "./reviews.schemas.js";
import type { Prisma, Plan } from "@prisma/client";
import type { PushProvider } from "../../lib/push/pushProvider.js";

type DatabaseClient = typeof prisma | Prisma.TransactionClient;

export async function listReviewRequests(businessId: string) {
  return prisma.reviewRequest.findMany({
    where: { businessId },
    orderBy: { createdAt: "desc" },
    include: { customer: true },
  });
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

  return reviewRequest;
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
  return reviewRequest;
}

export async function updateReviewRequest(
  businessId: string,
  id: string,
  input: UpdateReviewRequestInput,
) {
  await getOwnedReviewRequest(businessId, id);
  return prisma.reviewRequest.update({ where: { id }, data: input });
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

  const rendered = renderTemplate(body, {
    customer_name: reviewRequest.customer?.name ?? "there",
    business_name: business.name,
    service_name: reviewRequest.serviceName ?? "your service",
    review_link: reviewRequest.googleReviewLink ?? business.googleReviewLink ?? "",
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

  return reviewRequest;
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

  return reviewRequest;
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

  return prisma.reviewRequest.findFirstOrThrow({ where: { id, businessId } });
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
  actorId: string,
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

  return db.reviewRequest.findFirstOrThrow({ where: { id, businessId } });
}
