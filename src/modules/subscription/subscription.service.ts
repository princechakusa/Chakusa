import { prisma } from "../../lib/prisma.js";
import { getPlanLimits, hasFeature, startOfCurrentUtcMonth, startOfNextUtcMonth } from "../../lib/entitlements.js";
import { verifyAppleTransaction, verifyGoogleSubscription, type ReconcileOutcome } from "../../lib/billing/subscriptionReconciliation.js";
import { realAppleStoreClient, type AppleStoreClient } from "../../lib/billing/appleAppStoreClient.js";
import { realGooglePlayClient, type GooglePlayClient } from "../../lib/billing/googlePlayClient.js";
import type { MessageType, Plan, SubscriptionProvider, SubscriptionStatus } from "@prisma/client";

const TEMPLATE_TYPES: readonly MessageType[] = [
  "missed_call",
  "booking_confirmation",
  "review_request",
  "private_feedback",
  "comeback_reminder",
  "custom",
  "public_profile_inquiry",
  "lead_follow_up",
];

interface MonthlyUsage {
  current: number;
  limit: number | null;
  period: "month";
  resetsAt: string;
}

interface StandingUsage {
  current: number;
  limit: number | null;
  period: null;
  resetsAt: null;
}

export interface SubscriptionStatusResponse {
  plan: Plan;
  status: SubscriptionStatus;
  // Safe billing-UX additions only — see the Phase report's "subscription
  // status changes" section for the exclusion list this deliberately
  // respects: never a purchase token, transaction identifier, or raw
  // provider payload. All additive/nullable, so existing mobile clients
  // that don't read them are unaffected.
  provider: SubscriptionProvider | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: string | null;
  features: {
    automation: boolean;
    outboundMessaging: boolean;
    advancedAnalytics: boolean;
    extendedHistory: boolean;
    unlimitedTemplates: boolean;
    teamManagement: boolean;
  };
  usage: {
    leads: MonthlyUsage;
    reviewRequests: MonthlyUsage;
    customers: StandingUsage;
    openReminders: StandingUsage;
    customTemplates: {
      limitPerType: number | null;
      usageByType: Record<MessageType, number>;
    };
  };
  value: { recoveredRevenueThisMonth: number; completedAppointmentsThisMonth: number; scheduledAppointmentValue: number };
}

/**
 * Read-only product-state snapshot for mobile — every value here mirrors an
 * existing enforcement definition (getPlanLimits, startOfCurrentUtcMonth,
 * hasFeature, and the exact count queries used by leads/reviews/customers/
 * reminders/templates .service.ts) rather than reinterpreting any of them.
 * This function must never gain its own idea of what "current" or "limit"
 * means — if enforcement's definition changes, this should change only
 * because it calls the same shared helper, not because someone edited two
 * places.
 *
 * A missing Subscription row is not expected (every business gets one at
 * creation — see business.routes.ts's POST / and auth.service.ts's
 * registration path) but is handled the same least-privilege way
 * tenant.ts's request.plan resolution already does: default to FREE/ACTIVE
 * rather than throwing, logging it as a data-integrity signal since it
 * should never actually happen.
 */
export async function getSubscriptionStatus(businessId: string): Promise<SubscriptionStatusResponse> {
  const subscription = await prisma.subscription.findUnique({
    where: { businessId },
    select: { plan: true, status: true, provider: true, currentPeriodEnd: true, cancelAtPeriodEnd: true, trialEndsAt: true },
  });

  if (!subscription) {
    console.error(`[subscription] business ${businessId} has no Subscription row — defaulting to FREE/ACTIVE`);
  }

  const plan = subscription?.plan ?? "FREE";
  const status = subscription?.status ?? "ACTIVE";

  const limits = getPlanLimits(plan);
  const periodStart = startOfCurrentUtcMonth();
  const resetsAt = startOfNextUtcMonth().toISOString();

  const [leadsCurrent, reviewRequestsCurrent, customersCurrent, openRemindersCurrent, templateCounts, recovered, completedAppointments, scheduledAppointments] = await Promise.all([
    prisma.lead.count({ where: { businessId, createdAt: { gte: periodStart } } }),
    prisma.reviewRequest.count({ where: { businessId, createdAt: { gte: periodStart } } }),
    prisma.customer.count({ where: { businessId } }),
    prisma.reminder.count({ where: { businessId, status: { notIn: ["completed", "dismissed"] } } }),
    // Matches templates.service.ts's createTemplate limit check exactly:
    // every row counts regardless of isDefault (see the P0 template-quota
    // fix — a system default never creates a row, so any row is custom).
    prisma.messageTemplate.groupBy({
      by: ["templateType"],
      where: { businessId },
      _count: { _all: true },
    }),
    prisma.lead.aggregate({ where: { businessId, status: "won", wonAt: { gte: periodStart } }, _sum: { estimatedValue: true } }),
    prisma.appointment.count({ where: { businessId, status: "COMPLETED", startsAt: { gte: periodStart } } }),
    prisma.appointment.aggregate({ where: { businessId, status: { in: ["SCHEDULED", "CONFIRMED"] }, startsAt: { gte: new Date() } }, _sum: { price: true } }),
  ]);

  const usageByType = Object.fromEntries(TEMPLATE_TYPES.map((type) => [type, 0])) as Record<MessageType, number>;
  for (const row of templateCounts) {
    usageByType[row.templateType] = row._count._all;
  }

  return {
    plan,
    status,
    provider: subscription?.provider ?? null,
    currentPeriodEnd: subscription?.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
    trialEndsAt: subscription?.trialEndsAt?.toISOString() ?? null,
    features: {
      // AUTOMATION/OUTBOUND_MESSAGING are status-sensitive — pass `status`
      // so an EXPIRED/CANCELED Pro business correctly reports these as
      // false instead of stale-true, matching what the write paths
      // (automation.service.ts, messages.service.ts) actually enforce.
      automation: hasFeature(plan, status, "AUTOMATION"),
      outboundMessaging: hasFeature(plan, status, "OUTBOUND_MESSAGING"),
      advancedAnalytics: hasFeature(plan, "ADVANCED_ANALYTICS"),
      extendedHistory: hasFeature(plan, "EXTENDED_HISTORY"),
      unlimitedTemplates: hasFeature(plan, "UNLIMITED_TEMPLATES"),
      // TEAM_MANAGEMENT is status-sensitive like AUTOMATION/OUTBOUND_MESSAGING
      // above — a downgraded/expired Business account must report false here.
      teamManagement: hasFeature(plan, status, "TEAM_MANAGEMENT"),
    },
    usage: {
      leads: { current: leadsCurrent, limit: limits.leadsPerMonth, period: "month", resetsAt },
      reviewRequests: { current: reviewRequestsCurrent, limit: limits.reviewRequestsPerMonth, period: "month", resetsAt },
      customers: { current: customersCurrent, limit: limits.customers, period: null, resetsAt: null },
      openReminders: { current: openRemindersCurrent, limit: limits.openReminders, period: null, resetsAt: null },
      customTemplates: { limitPerType: limits.customTemplatesPerType, usageByType },
    },
    value: { recoveredRevenueThisMonth: Number(recovered._sum.estimatedValue ?? 0), completedAppointmentsThisMonth: completedAppointments, scheduledAppointmentValue: Number(scheduledAppointments._sum.price ?? 0) },
  };
}

// ---------------------------------------------------------------------------
// Purchase/restore verification — the only two paths that can ever move a
// Subscription toward Plan.PRO. `businessId` always comes from the
// authenticated tenant context (request.businessId in the route), never
// from the request body — see subscriptionReconciliation.ts's doc comments
// for the full "server is the source of truth" reasoning.
//
// The same functions serve both "first purchase" and "restore purchases":
// restoring is not a distinct code path — mobile re-submits whatever
// transaction/purchase proof the store itself reports it owns, and this
// re-verifies it exactly like a fresh purchase, reconciling into the
// authenticated business's Subscription row. There is no separate
// "POST /restore" that trusts a plan/status directly.
// ---------------------------------------------------------------------------

export async function verifySubscriptionWithApple(
  businessId: string,
  transactionId: string,
  client: AppleStoreClient = realAppleStoreClient,
): Promise<ReconcileOutcome> {
  return verifyAppleTransaction(businessId, transactionId, client);
}

export async function verifySubscriptionWithGoogle(
  businessId: string,
  purchaseToken: string,
  client: GooglePlayClient = realGooglePlayClient,
): Promise<ReconcileOutcome> {
  return verifyGoogleSubscription(businessId, purchaseToken, client);
}
