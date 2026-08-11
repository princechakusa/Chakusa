import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { recordActivity } from "../../lib/activity.js";
import { renderTemplate } from "../../lib/templateEngine.js";
import { getDefaultTemplateBody } from "../../lib/defaultTemplates.js";
import type { CreateReviewRequestInput, UpdateReviewRequestInput } from "./reviews.schemas.js";

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
) {
  if (input.customerId) {
    await assertCustomerInBusiness(businessId, input.customerId);
  }

  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });

  const reviewRequest = await prisma.reviewRequest.create({
    data: {
      businessId,
      customerId: input.customerId,
      serviceName: input.serviceName,
      message: input.message,
      googleReviewLink: business.googleReviewLink,
    },
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
    orderBy: { isDefault: "desc" },
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

export async function markReviewRequestReviewed(businessId: string, actorId: string, id: string) {
  await getOwnedReviewRequest(businessId, id);

  const reviewRequest = await prisma.reviewRequest.update({
    where: { id },
    data: { status: "reviewed" },
  });

  await recordActivity({
    businessId,
    actorId,
    eventType: "REVIEW_RECEIVED",
    entityType: "review_request",
    entityId: id,
  });

  return reviewRequest;
}

export async function markReviewRequestFeedbackReceived(
  businessId: string,
  actorId: string,
  id: string,
) {
  await getOwnedReviewRequest(businessId, id);

  const reviewRequest = await prisma.reviewRequest.update({
    where: { id },
    data: { status: "feedback_received" },
  });

  await recordActivity({
    businessId,
    actorId,
    eventType: "FEEDBACK_RECEIVED",
    entityType: "review_request",
    entityId: id,
  });

  return reviewRequest;
}
