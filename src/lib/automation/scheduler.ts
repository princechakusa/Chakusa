import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { ApiError } from "../errors.js";
import { isEntitled } from "../entitlements.js";
import { supportsLeadCreatedAutomation } from "../leadSources.js";
import { createAutomationRun } from "../../modules/automation/automation.service.js";
import { buildCustomerRetentionDedupeKey, buildLeadCreatedDedupeKey, buildLeadFollowUpDedupeKey, buildReviewRequestFollowUpDedupeKey } from "./dedupeKey.js";
import type { Lead, LeadStatus } from "@prisma/client";

/**
 * Called synchronously from leads.service.ts's createLead, immediately
 * after the lead exists — but this only ever *schedules* (creates a
 * PENDING AutomationRun row). It never sends anything and never blocks or
 * fails lead creation; every exit path below is either a silent "nothing
 * to do" or a caught-and-logged error, mirroring the exact discipline
 * notifyLeadCreated (src/lib/notifications/notificationTriggers.ts) already
 * uses for the same reason: secondary work must never break the primary
 * business action.
 *
 * Deliberately re-resolves plan+status from the database rather than
 * trusting any caller-supplied plan — createLead's own `plan` parameter is
 * only used for the Free lead-count limit and is not treated as
 * automation-authoritative here (see entitlements.ts's isEntitled for why
 * plan alone isn't enough: an EXPIRED PRO business must not have
 * automation scheduled just because Subscription.plan still reads "PRO").
 */
export async function scheduleMissedCallFollowUp(businessId: string, lead: Lead): Promise<void> {
  try {
    if (!supportsLeadCreatedAutomation(lead.source)) return;
    if (!lead.customerId) return; // nothing to eventually send to — no point scheduling.

    const subscription = await prisma.subscription.findUnique({
      where: { businessId },
      select: { plan: true, status: true },
    });
    if (!subscription || !isEntitled(subscription.plan, subscription.status, "AUTOMATION")) return;

    const rule = await prisma.automationRule.findFirst({
      where: { businessId, triggerType: "LEAD_CREATED", enabled: true, channel: "SMS" },
    });
    if (!rule) return;

    const dedupeKey = buildLeadCreatedDedupeKey(rule.id, lead.id);
    const scheduledFor = new Date(Date.now() + rule.delaySeconds * 1000);

    await createAutomationRun(businessId, {
      automationRuleId: rule.id,
      customerId: lead.customerId,
      leadId: lead.id,
      dedupeKey,
      scheduledFor,
    });
  } catch (error) {
    if (error instanceof ApiError && error.code === "CONFLICT") {
      // A run for this exact (rule, lead) already exists — the unique
      // constraint on (businessId, dedupeKey) is what actually prevents
      // the duplicate; this is the expected, idempotent outcome of the
      // same event being processed more than once, not a failure.
      return;
    }
    console.error("[automation] failed to schedule missed-call follow-up", error);
  }
}

// ---------------------------------------------------------------------------
// Customer Lifecycle Automation Engine — LEAD_FOLLOW_UP and
// CUSTOMER_RETENTION triggers. Unlike LEAD_CREATED above (fired
// synchronously the instant a lead exists), both of these are time-elapsed
// conditions ("this lead has sat too long," "this customer has gone
// quiet") that nothing single event can announce — they need a periodic
// sweep across every business with an enabled rule. See
// worker/automationWorker.ts for where these are actually called on their
// own slower interval; this remains the SAME worker process and the SAME
// AutomationRun/executor pipeline, just two additional entry points that
// feed it, not a second engine.
// ---------------------------------------------------------------------------

/** Also reused by executor.ts to re-check, at execution time, that a lead's status hasn't since moved out of the set this rule cares about. */
export const DEFAULT_LEAD_FOLLOW_UP_STATUSES: readonly LeadStatus[] = ["new", "contacted", "booked"];
/** Bounds how many runs one sweep can schedule per rule per tick — the same "never load/act on an unbounded amount of data" discipline as insights.service.ts's CUSTOMER_CANDIDATE_LIMIT. A backlog larger than this is simply picked up across the next few sweeps. */
const SWEEP_BATCH_LIMIT = 100;
/** Falls back to this only if a business somehow has no reminderDays value — Business.reminderDays itself defaults to 42 at the schema level, so this should be unreachable in practice. */
const DEFAULT_MIN_DAYS_SINCE_VISIT = 42;

function leadFollowUpTimestampFilter(status: LeadStatus, cutoff: Date): Prisma.LeadWhereInput {
  if (status === "contacted") return { contactedAt: { not: null, lte: cutoff } };
  if (status === "booked") return { bookedAt: { not: null, lte: cutoff } };
  return { createdAt: { lte: cutoff } };
}

/**
 * A lead that has sat in a non-terminal status (new/contacted/booked, or
 * whichever subset config.leadStatuses specifies) for at least
 * delaySeconds gets a single "still interested?" nudge. Measured from the
 * timestamp that actually corresponds to entering that status — createdAt
 * for "new", contactedAt for "contacted", bookedAt for "booked" — not a
 * blunt "last updated" proxy, since Lead already records these precisely.
 */
export async function sweepLeadFollowUps(now: Date = new Date()): Promise<void> {
  const rules = await prisma.automationRule.findMany({ where: { triggerType: "LEAD_FOLLOW_UP", enabled: true, channel: "SMS" } });

  for (const rule of rules) {
    try {
      const subscription = await prisma.subscription.findUnique({ where: { businessId: rule.businessId }, select: { plan: true, status: true } });
      if (!subscription || !isEntitled(subscription.plan, subscription.status, "AUTOMATION")) continue;

      const config = rule.config as { leadStatuses?: LeadStatus[] } | null;
      const statuses = config?.leadStatuses && config.leadStatuses.length > 0 ? config.leadStatuses : DEFAULT_LEAD_FOLLOW_UP_STATUSES;
      const cutoff = new Date(now.getTime() - rule.delaySeconds * 1000);

      for (const status of statuses) {
        const leads = await prisma.lead.findMany({
          where: { businessId: rule.businessId, status, customerId: { not: null }, ...leadFollowUpTimestampFilter(status, cutoff) },
          take: SWEEP_BATCH_LIMIT,
        });

        for (const lead of leads) {
          try {
            await createAutomationRun(rule.businessId, {
              automationRuleId: rule.id,
              customerId: lead.customerId,
              leadId: lead.id,
              dedupeKey: buildLeadFollowUpDedupeKey(rule.id, lead.id),
              scheduledFor: now,
            });
          } catch (error) {
            if (error instanceof ApiError && error.code === "CONFLICT") continue;
            console.error("[automation] failed to schedule a lead follow-up run", error);
          }
        }
      }
    } catch (error) {
      console.error("[automation] lead-follow-up sweep failed for a rule", error);
    }
  }
}

/**
 * A customer who has won at least one job but hasn't had any lead
 * recorded in `config.minDaysSinceVisit` days (falling back to the
 * business's own reminderDays — the same setting the existing Reminder
 * feature uses, not an invented default) gets a single automated win-back
 * message. No leadId on the resulting run — this is about the customer
 * relationship as a whole, not any one lead.
 */
export async function sweepCustomerRetention(now: Date = new Date()): Promise<void> {
  const rules = await prisma.automationRule.findMany({ where: { triggerType: "CUSTOMER_RETENTION", enabled: true, channel: "SMS" } });

  for (const rule of rules) {
    try {
      const subscription = await prisma.subscription.findUnique({ where: { businessId: rule.businessId }, select: { plan: true, status: true } });
      if (!subscription || !isEntitled(subscription.plan, subscription.status, "AUTOMATION")) continue;

      const business = await prisma.business.findUnique({ where: { id: rule.businessId }, select: { reminderDays: true } });
      const config = rule.config as { minDaysSinceVisit?: number } | null;
      const minDays = config?.minDaysSinceVisit ?? business?.reminderDays ?? DEFAULT_MIN_DAYS_SINCE_VISIT;
      const cutoff = new Date(now.getTime() - minDays * 86_400_000);

      const dormantCustomers = await prisma.$queryRaw<{ customer_id: string }[]>(Prisma.sql`
        SELECT customer_id
        FROM leads
        WHERE business_id = ${rule.businessId} AND customer_id IS NOT NULL
        GROUP BY customer_id
        HAVING MAX(created_at) <= ${cutoff} AND COUNT(*) FILTER (WHERE status = 'won') > 0
        LIMIT ${SWEEP_BATCH_LIMIT}
      `);

      for (const row of dormantCustomers) {
        try {
          await createAutomationRun(rule.businessId, {
            automationRuleId: rule.id,
            customerId: row.customer_id,
            leadId: null,
            dedupeKey: buildCustomerRetentionDedupeKey(rule.id, row.customer_id),
            scheduledFor: now,
          });
        } catch (error) {
          if (error instanceof ApiError && error.code === "CONFLICT") continue;
          console.error("[automation] failed to schedule a customer retention run", error);
        }
      }
    } catch (error) {
      console.error("[automation] customer-retention sweep failed for a rule", error);
    }
  }
}

/** Schedules one reminder for a sent/opened review request that remains unfinished. */
export async function sweepReviewRequestFollowUps(now: Date = new Date()): Promise<void> {
  const rules = await prisma.automationRule.findMany({ where: { triggerType: "REVIEW_REQUEST_FOLLOW_UP", enabled: true, channel: "SMS" } });
  for (const rule of rules) {
    try {
      const subscription = await prisma.subscription.findUnique({ where: { businessId: rule.businessId }, select: { plan: true, status: true } });
      if (!subscription || !isEntitled(subscription.plan, subscription.status, "AUTOMATION")) continue;
      const cutoff = new Date(now.getTime() - rule.delaySeconds * 1000);
      const requests = await prisma.reviewRequest.findMany({
        where: { businessId: rule.businessId, customerId: { not: null }, status: { in: ["sent", "opened"] }, sentAt: { not: null, lte: cutoff }, publicTokenConsumedAt: null },
        orderBy: { sentAt: "asc" },
        take: SWEEP_BATCH_LIMIT,
      });
      for (const request of requests) {
        try {
          await createAutomationRun(rule.businessId, {
            automationRuleId: rule.id,
            customerId: request.customerId,
            reviewRequestId: request.id,
            dedupeKey: buildReviewRequestFollowUpDedupeKey(rule.id, request.id),
            scheduledFor: now,
          });
        } catch (error) {
          if (error instanceof ApiError && error.code === "CONFLICT") continue;
          console.error("[automation] failed to schedule a review-request follow-up run", error);
        }
      }
    } catch (error) {
      console.error("[automation] review-request follow-up sweep failed for a rule", error);
    }
  }
}

/** Runs every lifecycle sweep — the single entry point worker/automationWorker.ts calls on its slower interval. */
export async function sweepLifecycleAutomations(now: Date = new Date()): Promise<void> {
  await sweepLeadFollowUps(now);
  await sweepReviewRequestFollowUps(now);
  await sweepCustomerRetention(now);
}
