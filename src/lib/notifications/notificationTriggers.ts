import { prisma } from "../prisma.js";
import { sendPushToUser } from "../push/pushService.js";
import type { PushProvider } from "../push/pushProvider.js";

const COMMENT_PREVIEW_LENGTH = 80;

function truncate(text: string): string {
  return text.length > COMMENT_PREVIEW_LENGTH
    ? `${text.slice(0, COMMENT_PREVIEW_LENGTH - 1)}…`
    : text;
}

async function getBusinessOwnerId(businessId: string): Promise<string> {
  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { ownerId: true },
  });
  return business.ownerId;
}

/**
 * Every notify* function below routes through this: it resolves the
 * recipient server-side from businessId (never trusts a caller-supplied
 * recipient) and swallows any failure so a push problem — missing owner,
 * Expo outage, bad token — can never fail or roll back the business
 * operation that triggered the notification.
 */
async function safeSend(businessId: string, send: (ownerId: string) => Promise<unknown>) {
  try {
    const ownerId = await getBusinessOwnerId(businessId);
    await send(ownerId);
  } catch (err) {
    console.error("[notifications] failed to send push", err);
  }
}

export async function notifyLeadCreated(
  businessId: string,
  lead: { id: string; serviceRequested: string | null; urgency: string },
  provider?: PushProvider,
): Promise<void> {
  await safeSend(businessId, (ownerId) =>
    sendPushToUser(
      ownerId,
      {
        title: "New lead",
        body: lead.serviceRequested
          ? `New missed-call lead: ${lead.serviceRequested}`
          : "New missed-call lead needs a response",
        data: { type: "lead", leadId: lead.id, urgency: lead.urgency },
      },
      provider,
    ),
  );
}

export async function notifyFeedbackReceived(
  businessId: string,
  feedback: { id: string; rating: number; comment: string | null; sentiment: string | null },
  provider?: PushProvider,
): Promise<void> {
  await safeSend(businessId, (ownerId) =>
    sendPushToUser(
      ownerId,
      {
        title: feedback.sentiment === "negative" ? "New feedback needs attention" : "New feedback received",
        body: feedback.comment
          ? `${feedback.rating}/5 — "${truncate(feedback.comment)}"`
          : `${feedback.rating}/5 rating received`,
        data: { type: "feedback", feedbackId: feedback.id },
      },
      provider,
    ),
  );
}

export async function notifyReviewReceived(
  businessId: string,
  reviewRequest: { id: string; serviceName: string | null },
  provider?: PushProvider,
): Promise<void> {
  await safeSend(businessId, (ownerId) =>
    sendPushToUser(
      ownerId,
      {
        title: "New review",
        body: reviewRequest.serviceName
          ? `A customer left a review for ${reviewRequest.serviceName}`
          : "A customer left a review",
        data: { type: "review_request", reviewRequestId: reviewRequest.id },
      },
      provider,
    ),
  );
}
