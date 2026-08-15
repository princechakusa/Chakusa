import { Prisma, type AutomationRunStatus, type LeadStatus, type Plan, type SubscriptionStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { assertFeatureAvailable } from "../../lib/entitlements.js";
import type { CreateAutomationRuleInput, ListAutomationRunHistoryQuery, UpdateAutomationRuleInput } from "./automation.schemas.js";

type DatabaseClient = typeof prisma | Prisma.TransactionClient;

const LEAD_STATUSES: readonly LeadStatus[] = ["new", "contacted", "booked", "won", "lost"];

/**
 * Validates config's shape against triggerType. This is intentionally the
 * only place trigger-specific config semantics are enforced — the Zod
 * schema keeps config as an open record because the valid shape depends on
 * triggerType, which Zod only knows after parsing the rest of the body.
 * Unknown/malformed config fails now, at rule-creation time, rather than
 * being discovered by a future worker at execution time.
 */
function validateConfigForTrigger(triggerType: string, config: Record<string, unknown>): void {
  switch (triggerType) {
    case "LEAD_CREATED":
      // No required config — "a lead was created" is the entire condition.
      return;
    case "LEAD_FOLLOW_UP": {
      if (config.leadStatuses !== undefined) {
        if (!Array.isArray(config.leadStatuses) || config.leadStatuses.length === 0) {
          throw ApiError.badRequest("config.leadStatuses must be a non-empty array when provided");
        }
        for (const status of config.leadStatuses) {
          if (!LEAD_STATUSES.includes(status as LeadStatus)) {
            throw ApiError.badRequest(`config.leadStatuses contains an invalid lead status: ${String(status)}`);
          }
        }
      }
      return;
    }
    case "REVIEW_REQUEST_FOLLOW_UP":
      // No required config — the future worker's condition ("sent but not
      // reviewed after delaySeconds") is fully expressed by
      // triggerType + delaySeconds already.
      return;
    case "CUSTOMER_RETENTION": {
      if (config.minDaysSinceVisit !== undefined) {
        if (typeof config.minDaysSinceVisit !== "number" || config.minDaysSinceVisit < 1) {
          throw ApiError.badRequest("config.minDaysSinceVisit must be a positive number when provided");
        }
      }
      return;
    }
    default:
      throw ApiError.badRequest(`Unknown triggerType: ${triggerType}`);
  }
}

async function getOwnedRule(businessId: string, id: string, db: DatabaseClient = prisma) {
  const rule = await db.automationRule.findFirst({ where: { id, businessId } });
  if (!rule) {
    throw ApiError.notFound("Automation rule not found");
  }
  return rule;
}

export async function listAutomationRules(businessId: string) {
  return prisma.automationRule.findMany({
    where: { businessId },
    orderBy: { createdAt: "desc" },
  });
}

export async function getAutomationRule(businessId: string, id: string) {
  return getOwnedRule(businessId, id);
}

/**
 * Rejects a duplicate (businessId, triggerType, channel) with 409 Conflict
 * rather than silently returning/upserting the existing rule — the same
 * P2002-to-409 pattern already used for AutomationRun's dedupeKey
 * (createAutomationRun below) and duplicate-email registration
 * (auth.service.ts). Chosen over an idempotent get-or-create because every
 * other unique-constraint violation in this codebase surfaces as a rejected
 * request, not a silent success; a get-or-create here would also make it
 * ambiguous to the caller whether their `name`/`enabled`/`delaySeconds`/
 * `config` were actually applied or silently discarded in favor of the
 * pre-existing row. The mobile client's own preflight (check-then-create)
 * is a UX nicety, not the enforcement mechanism — this constraint plus this
 * 409 is what makes the invariant real under concurrent requests, since two
 * simultaneous creates can both pass a preflight check and only the
 * database's unique index can guarantee only one insert wins.
 */
export async function createAutomationRule(businessId: string, plan: Plan, status: SubscriptionStatus, input: CreateAutomationRuleInput) {
  // Status-aware: a PRO business whose subscription has EXPIRED/CANCELED
  // must not be able to create/enable new automation rules just because
  // Subscription.plan still reads "PRO" — see the P0 audit fix in
  // entitlements.ts. This was previously plan-only here even though the
  // scheduler/executor already correctly checked status before ever
  // acting on a rule, which meant rule management and rule execution
  // silently disagreed about entitlement.
  assertFeatureAvailable(plan, status, "AUTOMATION");
  validateConfigForTrigger(input.triggerType, input.config as Record<string, unknown>);

  try {
    return await prisma.automationRule.create({
      data: {
        businessId,
        name: input.name,
        enabled: input.enabled,
        triggerType: input.triggerType,
        channel: input.channel,
        delaySeconds: input.delaySeconds,
        config: input.config as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw ApiError.conflict(`An automation rule for ${input.triggerType} on ${input.channel} already exists for this business`);
    }
    throw error;
  }
}

export async function updateAutomationRule(
  businessId: string,
  plan: Plan,
  status: SubscriptionStatus,
  id: string,
  input: UpdateAutomationRuleInput,
) {
  assertFeatureAvailable(plan, status, "AUTOMATION");
  const existing = await getOwnedRule(businessId, id);

  if (input.config !== undefined) {
    validateConfigForTrigger(existing.triggerType, input.config as Record<string, unknown>);
  }

  return prisma.automationRule.update({
    where: { id },
    data: {
      name: input.name,
      channel: input.channel,
      delaySeconds: input.delaySeconds,
      config: input.config as Prisma.InputJsonValue | undefined,
    },
  });
}

/**
 * enabled is a dedicated action rather than folded into updateAutomationRule
 * — flipping a rule live is a materially different, higher-stakes operation
 * than editing its config (it is the switch a future worker will check
 * before ever acting on the rule), so it gets its own explicit entry point
 * and its own entitlement check rather than being one field among many in a
 * general PATCH body.
 */
export async function setAutomationRuleEnabled(businessId: string, plan: Plan, status: SubscriptionStatus, id: string, enabled: boolean) {
  assertFeatureAvailable(plan, status, "AUTOMATION");
  await getOwnedRule(businessId, id);

  return prisma.automationRule.update({ where: { id }, data: { enabled } });
}

// ---------------------------------------------------------------------------
// AutomationRun — created only by internal code/tests in this phase. There
// is no route that reaches createAutomationRun; see automation.routes.ts.
// ---------------------------------------------------------------------------

export interface CreateAutomationRunInput {
  automationRuleId: string;
  customerId?: string | null;
  leadId?: string | null;
  dedupeKey: string;
  scheduledFor: Date;
}

async function assertCustomerInBusiness(businessId: string, customerId: string, db: DatabaseClient) {
  const customer = await db.customer.findFirst({ where: { id: customerId, businessId } });
  if (!customer) {
    throw ApiError.badRequest("customerId does not belong to this business");
  }
}

async function assertLeadInBusiness(businessId: string, leadId: string, db: DatabaseClient) {
  const lead = await db.lead.findFirst({ where: { id: leadId, businessId } });
  if (!lead) {
    throw ApiError.badRequest("leadId does not belong to this business");
  }
}

/**
 * Idempotency strategy: the unique constraint on (businessId, dedupeKey) —
 * not an application-level lock — is the source of truth that "this exact
 * automation should only be scheduled once for this event." A future
 * scheduler derives dedupeKey deterministically from
 * (automationRuleId, triggering entity) and calls this inside a try/catch
 * for Prisma's P2002; two concurrent scheduling attempts for the same event
 * race safely because Postgres itself rejects the second insert — there is
 * no read-then-write window to lose, unlike a "check if a run already
 * exists, then create" approach would have.
 */
export async function createAutomationRun(businessId: string, input: CreateAutomationRunInput, db: DatabaseClient = prisma) {
  const rule = await db.automationRule.findFirst({ where: { id: input.automationRuleId, businessId } });
  if (!rule) {
    throw ApiError.badRequest("automationRuleId does not belong to this business");
  }

  if (input.customerId) {
    await assertCustomerInBusiness(businessId, input.customerId, db);
  }
  if (input.leadId) {
    await assertLeadInBusiness(businessId, input.leadId, db);
  }

  try {
    return await db.automationRun.create({
      data: {
        businessId,
        automationRuleId: input.automationRuleId,
        customerId: input.customerId ?? null,
        leadId: input.leadId ?? null,
        dedupeKey: input.dedupeKey,
        scheduledFor: input.scheduledFor,
        status: "PENDING",
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw ApiError.conflict("An automation run already exists for this event");
    }
    throw error;
  }
}

export async function listAutomationRuns(businessId: string, automationRuleId?: string) {
  return prisma.automationRun.findMany({
    where: { businessId, ...(automationRuleId ? { automationRuleId } : {}) },
    orderBy: { createdAt: "desc" },
  });
}

async function getOwnedRun(businessId: string, id: string) {
  const run = await prisma.automationRun.findFirst({ where: { id, businessId } });
  if (!run) {
    throw ApiError.notFound("Automation run not found");
  }
  return run;
}

// Mirrors the codebase's existing state-machine shape (e.g. reminders'
// due/sent/completed/dismissed, review requests' pending→...→reviewed) —
// an explicit allow-list of (from -> to) pairs, checked before any write,
// rather than trusting the caller to only request sane transitions.
const ALLOWED_TRANSITIONS: Record<AutomationRunStatus, readonly AutomationRunStatus[]> = {
  PENDING: ["RUNNING", "CANCELLED"],
  RUNNING: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

async function transitionRun(businessId: string, id: string, to: AutomationRunStatus, extra: Prisma.AutomationRunUpdateInput = {}) {
  const existing = await getOwnedRun(businessId, id);

  if (!ALLOWED_TRANSITIONS[existing.status].includes(to)) {
    throw ApiError.conflict(`Cannot transition automation run from ${existing.status} to ${to}`);
  }

  // updateMany's WHERE clause re-asserts the from-status as a claim guard —
  // the same concurrency-safe pattern used throughout the codebase (e.g.
  // markReviewRequestReviewed) — so two concurrent callers racing to
  // transition the same run can't both succeed; the loser's updateMany
  // matches zero rows.
  const claimed = await prisma.automationRun.updateMany({
    where: { id, businessId, status: existing.status },
    data: { status: to, ...extra },
  });

  if (claimed.count === 0) {
    throw ApiError.conflict(`Cannot transition automation run from ${existing.status} to ${to}`);
  }

  return prisma.automationRun.findFirstOrThrow({ where: { id, businessId } });
}

export const markAutomationRunStarted = (businessId: string, id: string) =>
  transitionRun(businessId, id, "RUNNING", { startedAt: new Date() });

export const markAutomationRunCompleted = (businessId: string, id: string) =>
  transitionRun(businessId, id, "COMPLETED", { completedAt: new Date() });

export const markAutomationRunFailed = (businessId: string, id: string, errorMessage: string) =>
  transitionRun(businessId, id, "FAILED", { completedAt: new Date(), errorMessage });

export const cancelAutomationRun = (businessId: string, id: string) =>
  transitionRun(businessId, id, "CANCELLED", { cancelledAt: new Date() });

// ---------------------------------------------------------------------------
// AutomationRun history — read-only, tenant-scoped, product-facing. See
// GET /automation/runs (automation.routes.ts).
// ---------------------------------------------------------------------------

export type SafeAutomationRunReason =
  | "INVALID_PHONE"
  | "CUSTOMER_OPTED_OUT"
  | "SUBSCRIPTION_INACTIVE"
  | "LEAD_ALREADY_CONTACTED"
  | "RULE_DISABLED"
  | "SEND_FAILED"
  | "UNKNOWN";

/**
 * Maps executor.ts's internal, free-text errorMessage strings (see its
 * cancelRun calls and the FAILED-path writes) to a small closed vocabulary
 * — never returns the raw string. Every branch here corresponds to an
 * exact, current executor.ts message; anything not recognized (including a
 * FAILED run's exhausted-retries/permanent-provider-failure messages, which
 * legitimately vary with whatever the provider returned) falls back to a
 * generic-but-honest category rather than a fabricated specific one. See
 * the Phase report's "safe reason strategy" for the two known gaps this
 * leaves: the executor doesn't distinguish *why* a permanent provider
 * failure happened (e.g. genuinely-invalid destination vs. carrier
 * rejection), and its top-level catch-all (unexpected DB/bug errors) is
 * indistinguishable from a real send failure once sanitized.
 *
 * Only terminal statuses (FAILED, CANCELLED) ever get a non-null reason —
 * PENDING/RUNNING/COMPLETED always return null, even though a PENDING run
 * mid-retry may carry a stale errorMessage from its last transient failure
 * (see executor.ts's requeue branch): that message describes a past
 * attempt, not the run's current state, so surfacing it would be
 * misleading rather than merely imprecise.
 */
function sanitizeAutomationRunReason(status: AutomationRunStatus, errorMessage: string | null): SafeAutomationRunReason | null {
  if (status !== "FAILED" && status !== "CANCELLED") return null;

  switch (errorMessage) {
    case "Customer has no valid E.164 phone number":
      return "INVALID_PHONE";
    case "Customer has opted out of SMS":
      return "CUSTOMER_OPTED_OUT";
    case "Business is no longer entitled to automation":
      return "SUBSCRIPTION_INACTIVE";
    case "Automation rule no longer exists or is disabled":
      return "RULE_DISABLED";
    default:
      break;
  }
  if (errorMessage?.startsWith("Lead has already been actioned")) return "LEAD_ALREADY_CONTACTED";

  // Any other FAILED row is, from the product's perspective, simply "the
  // send failed" — whether that was a permanent provider rejection, an
  // exhausted-retries give-up, or an unexpected internal error, this
  // codebase does not currently persist enough structure to tell those
  // apart safely without risking a raw provider/error string leaking
  // through. See the Phase report.
  if (status === "FAILED") return "SEND_FAILED";

  // Any other CANCELLED row (missing lead/customer/run linkage — states
  // that should be rare and are not product-meaningful on their own).
  return "UNKNOWN";
}

export interface AutomationRunHistoryItemDto {
  id: string;
  status: AutomationRunStatus;
  scheduledFor: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  triggerType: string;
  channel: string;
  customer: { id: string; name: string } | null;
  lead: { id: string; serviceRequested: string | null; status: string } | null;
  reason: SafeAutomationRunReason | null;
}

export interface AutomationRunHistoryDto {
  items: AutomationRunHistoryItemDto[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Tenant-scoped, read-only, product-facing history — deliberately never
 * gated on AUTOMATION entitlement (see the Phase report's "history and
 * subscription status" section): a business that lets Pro lapse, or
 * disables/deletes the rule that produced a run, must still be able to see
 * what already happened. Ordered by createdAt DESC — the moment each run
 * entered the system, which stays stable and monotonic across retries
 * (unlike scheduledFor, which the executor rewrites on every transient
 * retry backoff) — matching this codebase's existing list-endpoint
 * convention (customers, leads) rather than inventing a new one.
 */
export async function listAutomationRunHistory(
  businessId: string,
  opts: ListAutomationRunHistoryQuery,
): Promise<AutomationRunHistoryDto> {
  const where = { businessId, ...(opts.status ? { status: opts.status } : {}) };

  const [rows, total] = await Promise.all([
    prisma.automationRun.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
      include: {
        automationRule: { select: { triggerType: true, channel: true } },
        customer: { select: { id: true, name: true } },
        lead: { select: { id: true, serviceRequested: true, status: true } },
      },
    }),
    prisma.automationRun.count({ where }),
  ]);

  const items: AutomationRunHistoryItemDto[] = rows.map((run) => ({
    id: run.id,
    status: run.status,
    scheduledFor: run.scheduledFor,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    triggerType: run.automationRule.triggerType,
    channel: run.automationRule.channel,
    customer: run.customer ? { id: run.customer.id, name: run.customer.name } : null,
    lead: run.lead ? { id: run.lead.id, serviceRequested: run.lead.serviceRequested, status: run.lead.status } : null,
    reason: sanitizeAutomationRunReason(run.status, run.errorMessage),
  }));

  return { items, total, page: opts.page, pageSize: opts.pageSize };
}
