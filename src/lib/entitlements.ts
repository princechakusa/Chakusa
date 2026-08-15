import { Prisma, type Plan, type SubscriptionStatus } from "@prisma/client";
import { ApiError } from "./errors.js";
import { prisma } from "./prisma.js";
import { config } from "./config.js";

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
 * own to send a message" (Phase 3/4 — AutomationRule/AutomationRun/worker).
 * Both happen to be PRO-only today, which made reusing AUTOMATION for the
 * manual send path tempting, but that would conflate two capabilities that
 * must be able to diverge later (e.g. a future plan tier with manual
 * Chakusa-sent SMS but no automation, or vice versa) — see the Phase 2
 * report for the full reasoning.
 */
export type Feature =
  | "AUTOMATION"
  | "OUTBOUND_MESSAGING"
  | "ADVANCED_ANALYTICS"
  | "EXTENDED_HISTORY"
  | "UNLIMITED_TEMPLATES"
  // Business v1's one new capability: multiple staff seats, invitations,
  // and role management (see src/modules/team/*). Deliberately its own
  // feature, not folded into an existing one, since it's the thing that
  // actually justifies BUSINESS as a distinct tier rather than "Pro with a
  // higher price" — see the Business Phase 1 report's "product goal"
  // section.
  | "TEAM_MANAGEMENT";

const FEATURE_LABELS: Record<Feature, string> = {
  AUTOMATION: "Automation",
  OUTBOUND_MESSAGING: "Sending messages through Chakusa",
  ADVANCED_ANALYTICS: "Advanced analytics",
  EXTENDED_HISTORY: "Extended activity history",
  UNLIMITED_TEMPLATES: "Unlimited custom templates",
  TEAM_MANAGEMENT: "Team management",
};

/**
 * PRO's feature set is defined once and spread into BUSINESS's, rather than
 * BUSINESS listing all five PRO features again — this is what makes "add a
 * new PRO feature" a one-line change instead of a two-place edit that can
 * silently drift (see the Business Phase 1 report's "entitlement
 * architecture" section, which audited this file specifically for that
 * risk before writing BUSINESS's entry).
 */
const PRO_FEATURES = new Set<Feature>(["AUTOMATION", "OUTBOUND_MESSAGING", "ADVANCED_ANALYTICS", "EXTENDED_HISTORY", "UNLIMITED_TEMPLATES"]);

const PLAN_FEATURES: Record<Plan, ReadonlySet<Feature>> = {
  FREE: new Set(),
  PRO: PRO_FEATURES,
  BUSINESS: new Set<Feature>([...PRO_FEATURES, "TEAM_MANAGEMENT"]),
};

/**
 * Every Feature gates on plan alone EXCEPT this set, which additionally
 * requires the subscription to currently be in an entitled status. This is
 * the P0 fix for a defect where plan-only checks (assertFeatureAvailable
 * called with just `plan`) kept granting Pro capabilities to a business
 * whose Subscription.status had moved to EXPIRED/CANCELED — `plan` only
 * flips to FREE via an explicit downgrade, which nothing in this codebase
 * does automatically on expiry, so `plan` alone is not a safe signal for
 * anything that costs money or acts on the business's behalf (sending a
 * real message, running automation). Every feature in this set MUST be
 * checked via the status-aware overloads below (hasFeature/
 * assertFeatureAvailable's second overload), not the plan-only one.
 */
const STATUS_SENSITIVE_FEATURES: ReadonlySet<Feature> = new Set(["AUTOMATION", "OUTBOUND_MESSAGING", "TEAM_MANAGEMENT"]);

/**
 * TRIALING/ACTIVE/GRACE_PERIOD are all "currently paying or about to be
 * given the benefit of the doubt" — GRACE_PERIOD exists specifically so a
 * failed renewal doesn't instantly cut off service. EXPIRED/CANCELED must
 * never retain Pro entitlements regardless of what `plan` still reads.
 */
const ENTITLED_STATUSES: ReadonlySet<SubscriptionStatus> = new Set(["ACTIVE", "TRIALING", "GRACE_PERIOD"]);

/**
 * Single authoritative entitlement check — every other function in this
 * module (hasFeature, assertFeatureAvailable) delegates to this one so
 * there is exactly one place that decides plan-only vs status-sensitive
 * features, rather than two parallel systems that can drift out of sync
 * (see the P0 audit finding this replaces: isAutomationEntitled/
 * assertAutomationEntitled duplicated this exact logic for AUTOMATION only,
 * while OUTBOUND_MESSAGING kept using the plan-only path unnoticed).
 */
export function isEntitled(plan: Plan, status: SubscriptionStatus, feature: Feature): boolean {
  if (!PLAN_FEATURES[plan].has(feature)) return false;
  if (STATUS_SENSITIVE_FEATURES.has(feature)) return ENTITLED_STATUSES.has(status);
  return true;
}

/**
 * Plan-only overload — for callers (e.g. read-only summaries where a
 * Subscription row wasn't already fetched) that genuinely cannot regress a
 * status-sensitive feature to "entitled" incorrectly. Throws if called with
 * a status-sensitive feature, since silently ignoring status for
 * AUTOMATION/OUTBOUND_MESSAGING is exactly the defect being fixed — any
 * call site that reaches this branch for one of those two features is a
 * bug, not a legitimate simplification.
 */
export function hasFeature(plan: Plan, feature: Feature): boolean;
export function hasFeature(plan: Plan, status: SubscriptionStatus, feature: Feature): boolean;
export function hasFeature(plan: Plan, statusOrFeature: SubscriptionStatus | Feature, maybeFeature?: Feature): boolean {
  if (maybeFeature) return isEntitled(plan, statusOrFeature as SubscriptionStatus, maybeFeature);
  const feature = statusOrFeature as Feature;
  if (STATUS_SENSITIVE_FEATURES.has(feature)) {
    throw new Error(`hasFeature(plan, "${feature}") called without a status — ${feature} is status-sensitive, use hasFeature(plan, status, "${feature}")`);
  }
  return PLAN_FEATURES[plan].has(feature);
}

/** Throws FEATURE_NOT_AVAILABLE (403) when `plan`/`status` don't entitle `feature`. Plan-only overload rejects status-sensitive features — see hasFeature. */
export function assertFeatureAvailable(plan: Plan, feature: Feature): void;
export function assertFeatureAvailable(plan: Plan, status: SubscriptionStatus, feature: Feature): void;
export function assertFeatureAvailable(plan: Plan, statusOrFeature: SubscriptionStatus | Feature, maybeFeature?: Feature): void {
  const feature = maybeFeature ?? (statusOrFeature as Feature);
  const entitled = maybeFeature ? hasFeature(plan, statusOrFeature as SubscriptionStatus, maybeFeature) : hasFeature(plan, statusOrFeature as Feature);
  if (entitled) return;
  throw ApiError.featureNotAvailable(feature, FEATURE_LABELS[feature], plan);
}

// ---------------------------------------------------------------------------
// Usage limits
// ---------------------------------------------------------------------------

/**
 * Every resource this task enforces a Free-plan cap on. Feedback is
 * deliberately absent — it is not limited, per product decision.
 */
export type LimitedResource = "leads" | "reviewRequests" | "customers" | "reminders" | "templates" | "staffSeats";

const RESOURCE_LABELS: Record<LimitedResource, string> = {
  leads: "leads",
  reviewRequests: "review requests",
  customers: "customers",
  reminders: "open reminders",
  templates: "custom templates",
  staffSeats: "team seats",
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
  /**
   * Total ACTIVE BusinessMember rows (owner included — see the Business
   * Phase 1 report's "seat-counting rule" section for why counting the
   * owner is the simpler, unambiguous choice over excluding them). FREE/PRO
   * are both 1 (owner only) not because they're "limited" in the usual
   * sense but because TEAM_MANAGEMENT being false already blocks any
   * invite attempt — this number exists mainly for consistent display and
   * as a second, defense-in-depth check inside the seat-limit transaction
   * (see teamInvitations.service.ts).
   */
  staffSeats: number | null;
}

// PRO's core-resource limits (everything except staffSeats, which BUSINESS
// alone varies) are spread into BUSINESS the same way PRO_FEATURES is
// spread above — BUSINESS must never accidentally inherit FREE's numeric
// caps just because it's a new Record key someone forgot to fill in.
const PRO_CORE_LIMITS = {
  leadsPerMonth: null,
  reviewRequestsPerMonth: null,
  customers: null,
  openReminders: null,
  customTemplatesPerType: null,
} as const;

const PLAN_LIMITS: Record<Exclude<Plan, "BUSINESS">, PlanLimits> = {
  FREE: {
    leadsPerMonth: 40,
    reviewRequestsPerMonth: 40,
    customers: 200,
    openReminders: 40,
    customTemplatesPerType: 1,
    staffSeats: 1,
  },
  PRO: {
    ...PRO_CORE_LIMITS,
    staffSeats: 1,
  },
};

/**
 * BUSINESS's staffSeats is read from config on every call rather than baked
 * into the PLAN_LIMITS table at module-load time, deliberately: it's the
 * one limit in this whole module that's meant to be tunable via
 * BUSINESS_SEAT_LIMIT without a redeploy (see config.ts's doc comment) —
 * baking it into a static object would silently freeze whatever value was
 * read once at process start.
 */
export function getPlanLimits(plan: Plan): PlanLimits {
  if (plan === "BUSINESS") {
    return {
      ...PRO_CORE_LIMITS,
      // Placeholder default pending a real commercial decision — see the
      // Business Phase 1 report's "seat limit design" section.
      staffSeats: config.BUSINESS_SEAT_LIMIT,
    };
  }
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
