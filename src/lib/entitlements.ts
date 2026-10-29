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
  | "TEAM_MANAGEMENT"
  // --- PROGRAM 3 LOOP 1: revenue & entitlement foundation ---------------
  // Placeholder capability gates for roadmap items that do not exist yet
  // (no route, screen, or worker checks these). They exist only so the
  // plans below can declare who WILL get each capability once it ships,
  // without every future loop having to touch this file's Feature union
  // again. Do not wire real behavior to these until the capability itself
  // is actually built — see each loop's own scope for when that happens.
  | "AI_RECEPTIONIST" // AI-answered/triaged calls (ai.receptionist)
  | "QUOTES_ESTIMATES" // customer-facing quotes/estimates (quotes.estimates)
  | "INVOICING" // invoices + payment collection (payments.invoicing)
  | "FINANCIAL_MANAGEMENT" // expense/mileage tracking + money-in/out reporting (financial.management)
  | "MARKETPLACE_DISCOVERY" // paid marketplace visibility/discovery add-on (marketplace.discovery)
  | "ACCOUNTING_INTEGRATIONS" // QuickBooks/Xero-style sync (integrations.accounting)
  | "INVENTORY"; // stock items with an auditable movement ledger (operations.inventory)

const FEATURE_LABELS: Record<Feature, string> = {
  AUTOMATION: "Automation",
  OUTBOUND_MESSAGING: "Sending messages through Chakusa",
  ADVANCED_ANALYTICS: "Advanced analytics",
  EXTENDED_HISTORY: "Extended activity history",
  UNLIMITED_TEMPLATES: "Unlimited custom templates",
  TEAM_MANAGEMENT: "Team management",
  AI_RECEPTIONIST: "AI receptionist",
  QUOTES_ESTIMATES: "Quotes and estimates",
  INVOICING: "Invoicing",
  FINANCIAL_MANAGEMENT: "Financial management",
  MARKETPLACE_DISCOVERY: "Marketplace discovery",
  ACCOUNTING_INTEGRATIONS: "Accounting integrations",
  INVENTORY: "Inventory",
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

// PROGRAM 3 LOOP 1: none of these five are checked by any route yet (see
// the Feature union's doc comment) — this assignment only decides who
// WILL get each capability once it exists. Placed on BUSINESS, the top
// tier, as the reasonable default for capabilities beyond Pro's current
// scope; trivially moved to another plan later since nothing depends on
// it today.
const FUTURE_BUSINESS_FEATURES: readonly Feature[] = ["AI_RECEPTIONIST", "QUOTES_ESTIMATES", "INVOICING", "FINANCIAL_MANAGEMENT", "MARKETPLACE_DISCOVERY", "ACCOUNTING_INTEGRATIONS", "INVENTORY"];

/**
 * Every plan from lowest to highest. The single source of truth for "is this
 * an upgrade or a downgrade" and "which plan is next": nothing else may list
 * the plans in order.
 */
export const PLAN_ORDER: readonly Plan[] = ["FREE", "STARTER", "PRO", "BUSINESS"];
export const planRank = (plan: Plan) => PLAN_ORDER.indexOf(plan);
/** The next plan up, used to tell someone at a limit what to upgrade to. */
export const nextPlan = (plan: Plan): Plan => PLAN_ORDER[Math.min(planRank(plan) + 1, PLAN_ORDER.length - 1)]!;

// Starter is the entry paid tier: Free's tools with roomier limits and the
// full activity history, but none of the features that send messages or act
// on the business's behalf (those cost real money per use and stay on Pro).
const STARTER_FEATURES = new Set<Feature>(["EXTENDED_HISTORY"]);

const PLAN_FEATURES: Record<Plan, ReadonlySet<Feature>> = {
  FREE: new Set(),
  STARTER: STARTER_FEATURES,
  PRO: PRO_FEATURES,
  BUSINESS: new Set<Feature>([...PRO_FEATURES, "TEAM_MANAGEMENT", ...FUTURE_BUSINESS_FEATURES]),
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

/** The Subscription columns resolveSubscription needs; select exactly these wherever a plan gates anything. */
export const SUBSCRIPTION_ENTITLEMENT_SELECT = { plan: true, status: true, provider: true, currentPeriodEnd: true } as const;

// A store-managed period that ended this long ago without a renewal, expiry
// or grace notification is treated as lapsed. The tolerance absorbs late
// store notifications; grace periods get the longest store grace window
// (Google allows up to 30 days) on top.
const STALE_PERIOD_TOLERANCE_MS = 3 * 24 * 60 * 60 * 1000;
const STALE_GRACE_TOLERANCE_MS = 31 * 24 * 60 * 60 * 1000;

export interface SubscriptionEntitlementRow {
  plan: Plan;
  status: SubscriptionStatus;
  provider?: string | null;
  currentPeriodEnd?: Date | null;
}

/**
 * The plan and status that actually entitle this business right now. `plan`
 * on the row is what was last bought and is never rewritten on expiry, so it
 * is NOT a safe gate on its own: a lapsed (EXPIRED/CANCELED) subscription,
 * or a store period that ended with no renewal on record, resolves to FREE.
 * Every limit and feature check must start from this, never from the raw
 * row, or a cancelled trial would keep its paid limits forever. A missing
 * row resolves to FREE/ACTIVE (least privilege).
 */
export function resolveSubscription(row: SubscriptionEntitlementRow | null | undefined, now: Date = new Date()): { plan: Plan; status: SubscriptionStatus } {
  if (!row) return { plan: "FREE", status: "ACTIVE" };
  if (!ENTITLED_STATUSES.has(row.status)) return { plan: "FREE", status: row.status };
  if (row.provider && row.currentPeriodEnd) {
    const tolerance = row.status === "GRACE_PERIOD" ? STALE_GRACE_TOLERANCE_MS : STALE_PERIOD_TOLERANCE_MS;
    if (now.getTime() > row.currentPeriodEnd.getTime() + tolerance) return { plan: "FREE", status: "EXPIRED" };
  }
  return { plan: row.plan, status: row.status };
}

/** isEntitled for a raw Subscription row, through resolveSubscription. A missing row is never entitled. */
export function isSubscriptionEntitled(row: SubscriptionEntitlementRow | null | undefined, feature: Feature, now: Date = new Date()): boolean {
  if (!row) return false;
  const { plan, status } = resolveSubscription(row, now);
  return isEntitled(plan, status, feature);
}

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
  // The cheapest plan that includes the feature (Business-only features name Business).
  throw ApiError.featureNotAvailable(feature, FEATURE_LABELS[feature], plan, PRO_FEATURES.has(feature) ? "PRO" : "BUSINESS");
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
  STARTER: {
    leadsPerMonth: 150,
    reviewRequestsPerMonth: 150,
    customers: 1000,
    openReminders: 150,
    customTemplatesPerType: 3,
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

/**
 * Public description of every plan, built from the same tables that enforce
 * them, so the apps and website never keep their own copy of what a plan
 * includes. Prices are not here: the stores (apps) and app configuration
 * (website) own those.
 */
export function describePlans() {
  return PLAN_ORDER.map((plan) => ({
    plan,
    rank: planRank(plan),
    limits: getPlanLimits(plan),
    features: [...PLAN_FEATURES[plan]].filter((feature) => !FUTURE_BUSINESS_FEATURES.includes(feature)).map((feature) => ({ key: feature, label: FEATURE_LABELS[feature] })),
  }));
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
  throw ApiError.limitReached(resource, RESOURCE_LABELS[resource], { limit, current, plan, requiredPlan: nextPlan(plan), periodResetsAt });
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
