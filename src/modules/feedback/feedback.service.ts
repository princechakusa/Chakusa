import { prisma } from "../../lib/prisma.js";
import { recordActivity } from "../../lib/activity.js";
import type { CreateFeedbackInput } from "./feedback.schemas.js";
import type { FeedbackSentiment } from "@prisma/client";

function deriveSentiment(rating: number): FeedbackSentiment {
  if (rating >= 4) return "positive";
  if (rating === 3) return "neutral";
  return "negative";
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
