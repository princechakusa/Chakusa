import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { recordActivity } from "../../lib/activity.js";
import type { CreateFeedbackInput, UpdateFeedbackStatusInput } from "./feedback.schemas.js";
import type { FeedbackSentiment } from "@prisma/client";

function deriveSentiment(rating: number): FeedbackSentiment {
  if (rating >= 4) return "positive";
  if (rating === 3) return "neutral";
  return "negative";
}

async function assertCustomerInBusiness(businessId: string, customerId: string) {
  const customer = await prisma.customer.findFirst({ where: { id: customerId, businessId } });
  if (!customer) {
    throw ApiError.badRequest("customerId does not belong to this business");
  }
}

async function assertReviewRequestInBusiness(businessId: string, reviewRequestId: string) {
  const reviewRequest = await prisma.reviewRequest.findFirst({
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
  actorId: string,
  input: CreateFeedbackInput,
) {
  if (input.customerId) {
    await assertCustomerInBusiness(businessId, input.customerId);
  }
  if (input.reviewRequestId) {
    await assertReviewRequestInBusiness(businessId, input.reviewRequestId);
  }

  const feedback = await prisma.feedback.create({
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
    await prisma.reviewRequest.update({
      where: { id: input.reviewRequestId },
      data: { status: "feedback_received" },
    });
  }

  await recordActivity({
    businessId,
    actorId,
    eventType: "FEEDBACK_RECEIVED",
    entityType: "feedback",
    entityId: feedback.id,
  });

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
