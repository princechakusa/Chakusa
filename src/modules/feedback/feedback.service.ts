import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { recordActivity } from "../../lib/activity.js";
import { notifyFeedbackReceived } from "../../lib/notifications/notificationTriggers.js";
import { markReviewRequestFeedbackReceived } from "../reviews/reviews.service.js";
import type { CreateFeedbackInput, UpdateFeedbackStatusInput } from "./feedback.schemas.js";
import type { FeedbackSentiment, Prisma } from "@prisma/client";
import type { PushProvider } from "../../lib/push/pushProvider.js";

type DatabaseClient = typeof prisma | Prisma.TransactionClient;

function deriveSentiment(rating: number): FeedbackSentiment {
  if (rating >= 4) return "positive";
  if (rating === 3) return "neutral";
  return "negative";
}

async function assertCustomerInBusiness(businessId: string, customerId: string, db: DatabaseClient) {
  const customer = await db.customer.findFirst({ where: { id: customerId, businessId } });
  if (!customer) {
    throw ApiError.badRequest("customerId does not belong to this business");
  }
}

async function assertReviewRequestInBusiness(businessId: string, reviewRequestId: string, db: DatabaseClient) {
  const reviewRequest = await db.reviewRequest.findFirst({
    where: { id: reviewRequestId, businessId },
  });
  if (!reviewRequest) {
    throw ApiError.badRequest("reviewRequestId does not belong to this business");
  }
}

export async function listFeedback(businessId: string) {
  return prisma.feedback.findMany({
    where: { businessId },
    orderBy: { createdAt: "desc" },
    include: { customer: true },
  });
}

export async function createFeedback(
  businessId: string,
  // null represents a public, customer-submitted feedback — there is no
  // authenticated business member to attribute it to (see
  // src/modules/public/publicReviews.service.ts). recordActivity and
  // markReviewRequestFeedbackReceived both already accept a null actorId.
  actorId: string | null,
  input: CreateFeedbackInput,
  pushProvider?: PushProvider,
) {
  // Everything below is one atomic unit: feedback creation, the linked
  // review request's transition to feedback_received, and both activity
  // events either all commit together or all roll back together. Passing
  // `tx` into the shared helpers (rather than duplicating their logic here)
  // also gives this the same concurrency-safe claim-guard behavior as the
  // dedicated mark-feedback-received endpoint.
  const feedback = await prisma.$transaction(async (tx) => {
    if (input.customerId) {
      await assertCustomerInBusiness(businessId, input.customerId, tx);
    }
    if (input.reviewRequestId) {
      await assertReviewRequestInBusiness(businessId, input.reviewRequestId, tx);
    }

    const feedback = await tx.feedback.create({
      data: {
        businessId,
        customerId: input.customerId,
        reviewRequestId: input.reviewRequestId,
        rating: input.rating,
        comment: input.comment,
        sentiment: deriveSentiment(input.rating),
      },
    });

    if (input.reviewRequestId) {
      await markReviewRequestFeedbackReceived(businessId, actorId, input.reviewRequestId, tx);
    }

    await recordActivity(
      {
        businessId,
        actorId,
        eventType: "FEEDBACK_RECEIVED",
        entityType: "feedback",
        entityId: feedback.id,
      },
      tx,
    );

    return feedback;
  });

  // Notified once per feedback row, outside the transaction (so a push
  // failure can never roll back the write, and we never call out over the
  // network from inside a DB transaction). This is the single call site for
  // "feedback was received" — the review-request-level transition in
  // markReviewRequestFeedbackReceived intentionally does not also notify,
  // since createFeedback already triggers it internally when reviewRequestId
  // is set, and double-notifying for one submission would be a duplicate.
  await notifyFeedbackReceived(businessId, feedback, pushProvider);

  return feedback;
}

export async function updateFeedbackStatus(
  businessId: string,
  actorId: string,
  feedbackId: string,
  input: UpdateFeedbackStatusInput,
) {
  const existing = await prisma.feedback.findFirst({ where: { id: feedbackId, businessId } });
  if (!existing) {
    throw ApiError.notFound("Feedback not found");
  }

  const feedback = await prisma.feedback.update({
    where: { id: feedbackId },
    data: { status: input.status },
  });

  await recordActivity({
    businessId,
    actorId,
    eventType: "FEEDBACK_STATUS_UPDATED",
    entityType: "feedback",
    entityId: feedback.id,
    metadata: { status: input.status },
  });

  return feedback;
}
