import { Prisma, type Plan, type SubscriptionStatus } from "@prisma/client";
import { ApiError } from "./errors.js";
import { prisma } from "./prisma.js";

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

/**
 * A strongly typed capability gate.
 *
 * OUTBOUND_MESSAGING vs AUTOMATION is a deliberate split, not an oversight:
 * OUTBOUND_MESSAGING is "Chakusa may send a message through a provider when
 * a human explicitly asks it to, right now" (Phase 2 — this file gates the
 * manual-send endpoint with it). AUTOMATION is "Chakusa may decide on its
 * own to send a message" (still unimplemented — no AutomationRule, no
 * worker, nothing triggers a send without a human in the loop yet). Both
 * happen to be PRO-only today, which made reusing AUTOMATION for the manual
 * send path tempting, but that would conflate two capabilities that must be
 * able to diverge later (e.g. a future plan tier with manual Chakusa-sent
 * SMS but no automation, or vice versa) — see the Phase 2 report for the
 * full reasoning.
 */
export type Feature = "AUTOMATION" | "OUTBOUND_MESSAGING" | "ADVANCED_ANALYTICS" | "EXTENDED_HISTORY" | "UNLIMITED_TEMPLATES";

const FEATURE_LABELS: Record<Feature, string> = {
  AUTOMATION: "Automation",
  OUTBOUND_MESSAGING: "Sending messages through Chakusa",
  ADVANCED_ANALYTICS: "Advanced analytics",
  EXTENDED_HISTORY: "Extended activity history",
  UNLIMITED_TEMPLATES: "Unlimited custom templates",
};

const PLAN_FEATURES: Record<Plan, ReadonlySet<Feature>> = {
  FREE: new Set(),
  PRO: new Set<Feature>(["AUTOMATION", "OUTBOUND_MESSAGING", "ADVANCED_ANALYTICS", "EXTENDED_HISTORY", "UNLIMITED_TEMPLATES"]),
};

export function hasFeature(plan: Plan, feature: Feature): boolean {
  return PLAN_FEATURES[plan].has(feature);
}

/** Throws FEATURE_NOT_AVAILABLE (403) when `plan` doesn't include `feature`. */
export function assertFeatureAvailable(plan: Plan, feature: Feature): void {
  if (hasFeature(plan, feature)) return;
  throw ApiError.featureNotAvailable(feature, FEATURE_LABELS[feature], plan);
}

// ---------------------------------------------------------------------------
// Automation entitlement — plan AND subscription status
// ---------------------------------------------------------------------------

/**
 * `request.plan` (resolved in tenant.ts) reflects only `Subscription.plan`,
 * which is sufficient for every plan-tier check elsewhere in this codebase
 * (a business is either FREE or PRO regardless of billing-cycle status).
 * Automation is different: a PRO business whose billing has lapsed
 * (EXPIRED/CANCELED) must not have Chakusa keep sending on their behalf,
 * even though `plan` still reads PRO until something explicitly downgrades
 * it. TRIALING/ACTIVE/GRACE_PERIOD are all "currently paying or about to be
 * given the benefit of the doubt" — GRACE_PERIOD exists specifically so a
 * failed renewal doesn't instantly cut off service.
 */
const AUTOMATION_ENTITLED_STATUSES: ReadonlySet<SubscriptionStatus> = new Set(["ACTIVE", "TRIALING", "GRACE_PERIOD"]);

export function isAutomationEntitled(plan: Plan, status: SubscriptionStatus): boolean {
  return hasFeature(plan, "AUTOMATION") && AUTOMATION_ENTITLED_STATUSES.has(status);
}

/** Throws FEATURE_NOT_AVAILABLE (403) unless both the plan and current subscription status allow automation. */
export function assertAutomationEntitled(plan: Plan, status: SubscriptionStatus): void {
  if (isAutomationEntitled(plan, status)) return;
  throw ApiError.featureNotAvailable("AUTOMATION", FEATURE_LABELS.AUTOMATION, plan);
}

// ---------------------------------------------------------------------------
// Usage limits
// ---------------------------------------------------------------------------

/**
 * Every resource this task enforces a Free-plan cap on. Feedback is
 * deliberately absent — it is not limited, per product decision.
 */
export type LimitedResource = "leads" | "reviewRequests" | "customers" | "reminders" | "templates";

const RESOURCE_LABELS: Record<LimitedResource, string> = {
  leads: "leads",
  reviewRequests: "review requests",
  customers: "customers",
  reminders: "open reminders",
  templates: "custom templates",
};

export interface PlanLimits {
  /** Leads created in the current UTC calendar month. null = unlimited. */
  leadsPerMonth: number | null;
  /** Review requests created in the current UTC calendar month. null = unlimited. */
  reviewRequestsPerMonth: number | null;
  /** Total Customer rows for the business. null = unlimited. */
  customers: number | null;
  /** Reminder rows whose status is not completed/dismissed. null = unlimited. */
  openReminders: number | null;
  /** Non-default MessageTemplate rows per templateType. null = unlimited. */
  customTemplatesPerType: number | null;
}

const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  FREE: {
    leadsPerMonth: 40,
    reviewRequestsPerMonth: 40,
    customers: 200,
    openReminders: 40,
    customTemplatesPerType: 1,
  },
  PRO: {
    leadsPerMonth: null,
    reviewRequestsPerMonth: null,
    customers: null,
    openReminders: null,
    customTemplatesPerType: null,
  },
};

export function getPlanLimits(plan: Plan): PlanLimits {
  return PLAN_LIMITS[plan];
}

export interface LimitCheck {
  plan: Plan;
  resource: LimitedResource;
  /** From getPlanLimits(plan)[...]. null means unlimited — always passes. */
  limit: number | null;
  current: number;
  /** Only pass this for calendar-month limits — it becomes `periodResetsAt`. */
  periodResetsAt?: Date;
}

/** Throws LIMIT_REACHED (403) when `current` has already reached `limit`. */
export function assertUnderLimit({ plan, resource, limit, current, periodResetsAt }: LimitCheck): void {
  if (limit === null || current < limit) return;
  throw ApiError.limitReached(resource, RESOURCE_LABELS[resource], { limit, current, plan, periodResetsAt });
}

// ---------------------------------------------------------------------------
// UTC calendar-month boundaries (for leads/reviewRequests monthly limits)
// ---------------------------------------------------------------------------

export function startOfCurrentUtcMonth(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function startOfNextUtcMonth(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

// ---------------------------------------------------------------------------
// Concurrency-safe "check the limit, then create" transaction
// ---------------------------------------------------------------------------

/**
 * Runs `fn` (a count-check-then-create) inside a Serializable transaction —
 * the same pattern already used by registerDevice
 * (src/modules/devices/devices.service.ts) for the same reason: a plain
 * `count()` then `create()` as two separate operations lets two concurrent
 * requests both read "39 leads, under the limit of 40" and both create,
 * leaving 41. Serializable isolation means Postgres itself detects that
 * conflict and aborts one transaction with a P2034 serialization failure
 * instead of letting it silently overrun the limit; retrying re-runs the
 * count against the now-committed state, so the retried attempt correctly
 * sees the winner's row and enforces the limit against it.
 */
export async function withLimitCheck<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, retries = 0): Promise<T> {
  try {
    return await prisma.$transaction(fn, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && retries < 6) {
      return withLimitCheck(fn, retries + 1);
    }
    throw error;
  }
}
