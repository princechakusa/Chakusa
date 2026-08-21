import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { recordActivity } from "../../lib/activity.js";
import { renderMissedCallFollowUp } from "../../lib/messageRendering.js";
import { notifyLeadCreated } from "../../lib/notifications/notificationTriggers.js";
import { scheduleMissedCallFollowUp } from "../../lib/automation/scheduler.js";
import { LEAD_SOURCE_MISSED_CALL } from "../../lib/leadSources.js";
import { assertUnderLimit, getPlanLimits, startOfCurrentUtcMonth, startOfNextUtcMonth, withLimitCheck } from "../../lib/entitlements.js";
import { findOrCreateCustomerByPhone } from "../customers/customers.service.js";
import { toApiLead } from "./leads.serialization.js";
import type { CreateLeadInput, ReportMissedCallInput, UpdateLeadInput, UpdateLeadPaymentInput } from "./leads.schemas.js";
import type { Lead, Plan } from "@prisma/client";
import type { PushProvider } from "../../lib/push/pushProvider.js";

export async function listLeads(
  businessId: string,
  opts: { status?: string; page: number; pageSize: number },
) {
  const where = { businessId, ...(opts.status ? { status: opts.status as Lead["status"] } : {}) };

  const [items, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
      include: { customer: true },
    }),
    prisma.lead.count({ where }),
  ]);

  return { items: items.map(withResponseTime), total, page: opts.page, pageSize: opts.pageSize };
}

function withResponseTime<T extends Lead>(lead: T) {
  const responseTimeSeconds =
    lead.missedCallTime && lead.contactedAt
      ? Math.max(0, Math.floor((lead.contactedAt.getTime() - lead.missedCallTime.getTime()) / 1000))
      : null;
  return { ...toApiLead(lead), responseTimeSeconds };
}

export async function createLead(
  businessId: string,
  actorId: string,
  input: CreateLeadInput,
  plan: Plan,
  pushProvider?: PushProvider,
  opts?: { clientEventId?: string },
) {
  if (input.customerId) {
    await assertCustomerInBusiness(businessId, input.customerId);
  }

  const limit = getPlanLimits(plan).leadsPerMonth;
  const periodStart = startOfCurrentUtcMonth();

  const lead = await withLimitCheck(async (tx) => {
    if (limit !== null) {
      const current = await tx.lead.count({ where: { businessId, createdAt: { gte: periodStart } } });
      assertUnderLimit({ plan, resource: "leads", limit, current, periodResetsAt: startOfNextUtcMonth() });
    }

    return tx.lead.create({
      data: {
        businessId,
        customerId: input.customerId,
        source: input.source,
        clientEventId: opts?.clientEventId,
        missedCallTime: input.missedCallTime,
        serviceRequested: input.serviceRequested,
        urgency: input.urgency,
        estimatedValue: input.estimatedValue,
        notes: input.notes,
      },
    });
  });

  await recordActivity({
    businessId,
    actorId,
    eventType: "LEAD_CREATED",
    entityType: "lead",
    entityId: lead.id,
  });

  await notifyLeadCreated(businessId, lead, pushProvider);

  // Fire-and-forget-but-never-fails-the-caller, same discipline as
  // notifyLeadCreated above: scheduling a follow-up (or deciding not to)
  // must never affect whether lead creation itself succeeds. This never
  // sends anything — it only ever creates a PENDING AutomationRun row for
  // the (separate, not-yet-started-here) worker to pick up later.
  await scheduleMissedCallFollowUp(businessId, lead);

  return withResponseTime(lead);
}

/**
 * Entry point for an automated recovery-source connector (currently: the
 * Android missed-call detector). Unlike createLead above, this is
 * idempotent on `input.clientEventId` — the connector is expected to retry
 * the exact same event after a network failure or offline-queue replay, and
 * that retry must return the lead that already exists rather than erroring
 * or creating a second one. This is a deliberate departure from this
 * codebase's usual P2002-to-409-conflict convention (see
 * automation.service.ts's createAutomationRule): those constraints guard
 * against two *different* human actions colliding, where surfacing a
 * conflict is the right answer. Here the "duplicate" is the same real-world
 * event being reported more than once by design — the correct answer is to
 * hand back the lead that was already created for it, not an error.
 */
export async function createLeadFromMissedCall(
  businessId: string,
  actorId: string,
  input: ReportMissedCallInput,
  plan: Plan,
  pushProvider?: PushProvider,
) {
  const existing = await prisma.lead.findFirst({
    where: { businessId, clientEventId: input.clientEventId },
  });
  if (existing) return withResponseTime(existing);

  const customer = await findOrCreateCustomerByPhone(businessId, actorId, input.phone, plan);

  try {
    return await createLead(
      businessId,
      actorId,
      {
        customerId: customer.id,
        source: LEAD_SOURCE_MISSED_CALL,
        missedCallTime: input.occurredAt,
        urgency: "medium",
      },
      plan,
      pushProvider,
      { clientEventId: input.clientEventId },
    );
  } catch (error) {
    // Lost the race: another concurrent replay of the exact same event
    // committed first. The unique (businessId, clientEventId) index is the
    // real guarantee; this just hands back what the winner created instead
    // of surfacing a conflict for a retry that was always going to be safe.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await prisma.lead.findFirst({ where: { businessId, clientEventId: input.clientEventId } });
      if (winner) return withResponseTime(winner);
    }
    throw error;
  }
}

async function assertCustomerInBusiness(businessId: string, customerId: string) {
  const customer = await prisma.customer.findFirst({ where: { id: customerId, businessId } });
  if (!customer) {
    throw ApiError.badRequest("customerId does not belong to this business");
  }
}

async function getOwnedLead(businessId: string, leadId: string) {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, businessId } });
  if (!lead) {
    throw ApiError.notFound("Lead not found");
  }
  return lead;
}

export async function getLead(businessId: string, leadId: string) {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, businessId },
    include: { customer: true, messages: { orderBy: { createdAt: "desc" } } },
  });
  if (!lead) {
    throw ApiError.notFound("Lead not found");
  }
  return withResponseTime(lead);
}

export async function updateLead(
  businessId: string,
  leadId: string,
  input: UpdateLeadInput,
) {
  await getOwnedLead(businessId, leadId);
  if (input.customerId) {
    await assertCustomerInBusiness(businessId, input.customerId);
  }

  const lead = await prisma.lead.update({
    where: { id: leadId },
    data: {
      customerId: input.customerId,
      source: input.source,
      serviceRequested: input.serviceRequested,
      urgency: input.urgency,
      estimatedValue: input.estimatedValue,
      notes: input.notes,
    },
  });

  return withResponseTime(lead);
}

/**
 * Payment tracking only — never a payment rail. Restricted to won leads:
 * paid/unpaid is meaningless before the business has actually closed the
 * sale, and allowing it earlier would let paymentStatus and the lead
 * pipeline's own status disagree about whether the job happened at all.
 */
export async function updateLeadPayment(
  businessId: string,
  leadId: string,
  input: UpdateLeadPaymentInput,
) {
  const existing = await getOwnedLead(businessId, leadId);
  if (existing.status !== "won") {
    throw ApiError.conflict("Payment status can only be set on a won lead");
  }

  const lead = await prisma.lead.update({
    where: { id: leadId },
    data: {
      paymentStatus: input.paymentStatus,
      paidAmount: input.paymentStatus === "unpaid" ? null : input.paidAmount,
    },
  });

  return withResponseTime(lead);
}

export async function generateLeadMessage(businessId: string, leadId: string) {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, businessId },
    include: { customer: true },
  });
  if (!lead) {
    throw ApiError.notFound("Lead not found");
  }

  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });

  const rendered = await renderMissedCallFollowUp(business, lead, lead.customer);

  await prisma.lead.update({ where: { id: leadId }, data: { generatedReply: rendered } });

  return { message: rendered };
}

const STATUS_TRANSITIONS: Record<
  "contacted" | "booked" | "won" | "lost",
  { field: "contactedAt" | "bookedAt" | "wonAt" | "lostAt"; eventType: "LEAD_CONTACTED" | "LEAD_BOOKED" | "LEAD_WON" | "LEAD_LOST" }
> = {
  contacted: { field: "contactedAt", eventType: "LEAD_CONTACTED" },
  booked: { field: "bookedAt", eventType: "LEAD_BOOKED" },
  won: { field: "wonAt", eventType: "LEAD_WON" },
  lost: { field: "lostAt", eventType: "LEAD_LOST" },
};

/**
 * Smallest sensible state machine for the existing recovery workflow.
 * `contacted`/`booked` only ever move forward through the natural
 * new -> contacted -> booked progression (skipping straight to "booked"
 * without recording contact first doesn't reflect what happened). `won`
 * and `lost`, however, are reachable from ANY non-terminal stage
 * (new/contacted/booked) — a business often records the outcome after the
 * fact (e.g. "customer called back and booked on the spot, marking this
 * won" without ever separately clicking "contacted" first), and the
 * existing mobile LeadDetailScreen and test suite both already rely on
 * this — see leads.test.ts/dashboard.test.ts/customers.test.ts creating a
 * lead and going straight to mark-won. won/lost are terminal: nothing
 * transitions out of them. Re-requesting the lead's own current status is
 * allowed as a no-op — mobile renders all four "Mark ..." buttons
 * simultaneously regardless of current status, so treating a same-status
 * re-click as an error would turn an accidental double-tap into a visible
 * failure for no product reason. What's actually rejected: any transition
 * out of a terminal state (won -> anything, lost -> anything) and
 * `booked` reached without first passing through `contacted`.
 */
const ALLOWED_LEAD_TRANSITIONS: Record<Lead["status"], ReadonlySet<Lead["status"]>> = {
  new: new Set(["new", "contacted", "won", "lost"]),
  contacted: new Set(["contacted", "booked", "won", "lost"]),
  booked: new Set(["booked", "won", "lost"]),
  won: new Set(["won"]),
  lost: new Set(["lost"]),
};

export async function transitionLead(
  businessId: string,
  actorId: string,
  leadId: string,
  status: "contacted" | "booked" | "won" | "lost",
) {
  const existing = await getOwnedLead(businessId, leadId);

  if (!ALLOWED_LEAD_TRANSITIONS[existing.status].has(status)) {
    throw ApiError.conflict(`Cannot transition lead from ${existing.status} to ${status}`);
  }

  // Re-affirming the current status is a no-op — no new activity event,
  // no timestamp overwrite (the original transition's timestamp is the
  // meaningful one).
  if (existing.status === status) {
    return withResponseTime(existing);
  }

  const transition = STATUS_TRANSITIONS[status];
  const now = new Date();

  // Atomic claim guard: the WHERE clause re-asserts the exact status this
  // decision was made against, so two concurrent transition requests for
  // the same lead (e.g. "mark booked" fired twice, or racing with a
  // different transition) can't both succeed and leave an inconsistent
  // state — the loser's updateMany matches zero rows and gets a
  // deterministic CONFLICT rather than silently overwriting the winner's
  // write. Same pattern as automation.service.ts's transitionRun and
  // reviews.service.ts's markReviewRequestReviewed.
  const claimed = await prisma.lead.updateMany({
    where: { id: leadId, businessId, status: existing.status },
    data: { status, [transition.field]: now },
  });

  if (claimed.count === 0) {
    throw ApiError.conflict(`Cannot transition lead from ${existing.status} to ${status}`);
  }

  await recordActivity({
    businessId,
    actorId,
    eventType: transition.eventType,
    entityType: "lead",
    entityId: leadId,
  });

  const lead = await prisma.lead.findFirstOrThrow({ where: { id: leadId, businessId } });
  return withResponseTime(lead);
}
