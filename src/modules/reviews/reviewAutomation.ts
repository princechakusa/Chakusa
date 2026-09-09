import { prisma } from "../../lib/prisma.js";
import { isEntitled } from "../../lib/entitlements.js";
import { messagingBudgetAvailable } from "../../lib/messaging/messagingBudget.js";
import { sendOutboundMessage } from "../../lib/messaging/messagingService.js";
import { parsePhoneNumber } from "../../lib/phone.js";
import { renderTemplate } from "../../lib/templateEngine.js";
import { getDefaultTemplateBody } from "../../lib/defaultTemplates.js";
import { buildPublicReviewUrl } from "../../lib/publicReviewLinks.js";
import { recordActivity } from "../../lib/activity.js";
import { captureUnexpectedError } from "../../lib/sentry.js";
import { generatePublicReviewLink } from "./reviews.service.js";
import type { MessagingProvider } from "../../lib/messaging/messagingProvider.js";

// #20 Reputation & Review Growth — the automatic, business-controlled review
// request after an eligible completed appointment.
//
// Idempotency: an atomic claim on `appointment.reviewRequestSentAt` plus the
// unique `ReviewRequest.appointmentId`. A "policy" skip (opt-out, outside the
// per-customer window, over the monthly plan limit) also claims the column so
// the sweep is O(new completions), not O(all recent completions) — the column
// is the "review-request decision has been made for this appointment" boundary,
// not merely "a message was sent". A *transient* failure (no budget, provider
// soft-fail, unexpected error) releases the claim and deletes the half-created
// request so the next sweep retries cleanly.
//
// Never sentiment-gated: eligibility is completion + consent + contactability +
// window only. There is no rating anywhere in the query.

const MAX_COMPLETION_AGE_MS = 30 * 86_400_000; // don't chase very old completions
const MIN_COMPLETION_AGE_MS = 60 * 60_000; // never within the hour

export async function sendDueReviewRequests(provider?: MessagingProvider, batchSize = 50, now = new Date()) {
  const candidates = await prisma.appointment.findMany({
    where: {
      status: "COMPLETED",
      reviewRequestSentAt: null,
      endsAt: { gte: new Date(now.getTime() - MAX_COMPLETION_AGE_MS), lte: new Date(now.getTime() - MIN_COMPLETION_AGE_MS) },
      customerId: { not: null },
      customer: { phoneE164: { not: null } },
      business: { platformStatus: "ACTIVE", reviewRequestAutoEnabled: true, messagingConsentConfirmedAt: { not: null } },
    },
    include: { business: { include: { subscription: true } }, customer: true },
    orderBy: { endsAt: "asc" },
    take: batchSize,
  });

  const claim = (appointmentId: string) =>
    prisma.appointment.updateMany({ where: { id: appointmentId, reviewRequestSentAt: null }, data: { reviewRequestSentAt: now } });
  const releaseClaim = (appointmentId: string) =>
    prisma.appointment.updateMany({ where: { id: appointmentId, reviewRequestSentAt: now }, data: { reviewRequestSentAt: null } });

  let sent = 0;
  for (const appointment of candidates) {
    const business = appointment.business;
    const customer = appointment.customer;
    if (!customer?.phoneE164) continue;
    if (!business.subscription || !isEntitled(business.subscription.plan, business.subscription.status, "OUTBOUND_MESSAGING")) continue;

    // Due only once the business's configured delay has elapsed since the end.
    if (appointment.endsAt.getTime() + business.reviewRequestDelayHours * 3_600_000 > now.getTime()) continue;

    // Per-customer window — one ask per `reviewRequestMinIntervalDays`, counted
    // across every review request for this customer (manual, campaign or auto).
    const windowStart = new Date(now.getTime() - business.reviewRequestMinIntervalDays * 86_400_000);
    const recentlyAsked = await prisma.reviewRequest.findFirst({
      where: { businessId: business.id, customerId: customer.id, createdAt: { gte: windowStart } },
      select: { id: true },
    });
    const optedOut = await prisma.customerOptOut.findFirst({
      where: { businessId: business.id, phone: customer.phoneE164, channel: { in: ["SMS", "ALL"] } },
      select: { id: true },
    });
    if (recentlyAsked || optedOut) {
      await claim(appointment.id); // terminal policy skip for this appointment
      continue;
    }

    const claimed = await claim(appointment.id);
    if (claimed.count !== 1) continue; // another worker took it

    let reviewRequestId: string | null = null;
    try {
      const reviewRequest = await prisma.reviewRequest.create({
        data: {
          businessId: business.id,
          customerId: customer.id,
          appointmentId: appointment.id,
          serviceName: appointment.serviceName,
          googleReviewLink: business.googleReviewLink,
        },
      });
      reviewRequestId = reviewRequest.id;

      const template = await prisma.messageTemplate.findFirst({
        where: { businessId: business.id, templateType: "review_request" },
        orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }, { id: "asc" }],
      });
      const link = buildPublicReviewUrl((await generatePublicReviewLink(business.id, reviewRequest.id)).token);
      const body = renderTemplate(template?.body ?? getDefaultTemplateBody("review_request", business.industry), {
        customer_name: customer.name ?? "there",
        business_name: business.name,
        service_name: appointment.serviceName ?? "your service",
        review_link: link,
      });

      if (!(await messagingBudgetAvailable(business.id)).available) {
        await prisma.reviewRequest.delete({ where: { id: reviewRequest.id } }).catch(() => undefined);
        await releaseClaim(appointment.id);
        continue;
      }

      const result = await sendOutboundMessage(
        { to: customer.phoneE164, channel: "sms", body, countryCode: parsePhoneNumber(customer.phoneE164).country ?? "ZZ", idempotencyKey: `review-request:auto:${appointment.id}` },
        provider,
      );
      await prisma.message.create({
        data: {
          businessId: business.id,
          customerId: customer.id,
          messageType: "review_request",
          channel: "sms",
          body,
          status: result.accepted ? "sent" : "failed",
          sentAt: result.accepted ? new Date() : null,
          provider: provider?.id ?? "twilio",
          providerMessageId: result.providerMessageId,
        },
      });

      if (!result.accepted) {
        await prisma.reviewRequest.delete({ where: { id: reviewRequest.id } }).catch(() => undefined);
        await releaseClaim(appointment.id);
        continue;
      }

      await prisma.reviewRequest.update({ where: { id: reviewRequest.id }, data: { status: "sent", sentAt: new Date() } });
      await recordActivity({ businessId: business.id, actorId: null, eventType: "REVIEW_REQUEST_SENT", entityType: "review_request", entityId: reviewRequest.id });
      sent += 1;
    } catch (error) {
      if (reviewRequestId) await prisma.reviewRequest.delete({ where: { id: reviewRequestId } }).catch(() => undefined);
      await releaseClaim(appointment.id).catch(() => undefined);
      captureUnexpectedError(error);
    }
  }

  return sent;
}

/** Request → send → open → convert funnel plus rating + response coverage. */
export async function reviewMetrics(businessId: string, now = new Date()) {
  const since30 = new Date(now.getTime() - 30 * 86_400_000);
  const [byStatus, sentTotal, converted, sent30, converted30, ratingAgg, feedbackTotal, responded] = await Promise.all([
    prisma.reviewRequest.groupBy({ by: ["status"], where: { businessId }, _count: { _all: true } }),
    prisma.reviewRequest.count({ where: { businessId, sentAt: { not: null } } }),
    prisma.reviewRequest.count({ where: { businessId, status: { in: ["reviewed", "feedback_received"] } } }),
    prisma.reviewRequest.count({ where: { businessId, sentAt: { gte: since30 } } }),
    prisma.reviewRequest.count({ where: { businessId, status: { in: ["reviewed", "feedback_received"] }, updatedAt: { gte: since30 } } }),
    prisma.feedback.aggregate({ where: { businessId }, _avg: { rating: true }, _count: { _all: true } }),
    prisma.feedback.count({ where: { businessId } }),
    prisma.feedback.count({ where: { businessId, response: { not: null } } }),
  ]);

  const statusCounts: Record<string, number> = {};
  for (const row of byStatus) statusCounts[row.status] = row._count._all;

  return {
    requests: { byStatus: statusCounts, total: Object.values(statusCounts).reduce((a, b) => a + b, 0) },
    conversion: {
      sentTotal,
      convertedTotal: converted,
      rateAllTime: sentTotal ? Number((converted / sentTotal).toFixed(3)) : null,
      sentLast30Days: sent30,
      convertedLast30Days: converted30,
      rateLast30Days: sent30 ? Number((converted30 / sent30).toFixed(3)) : null,
    },
    ratings: {
      average: ratingAgg._avg.rating ? Number(ratingAgg._avg.rating.toFixed(2)) : null,
      count: ratingAgg._count._all,
    },
    responses: { total: feedbackTotal, responded, responseRate: feedbackTotal ? Number((responded / feedbackTotal).toFixed(3)) : null },
  };
}
