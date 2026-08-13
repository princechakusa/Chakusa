import { prisma } from "../prisma.js";
import { isAutomationEntitled } from "../entitlements.js";
import { LEAD_SOURCE_MISSED_CALL } from "../leadSources.js";
import { parsePhoneNumber } from "../phone.js";
import { renderMissedCallFollowUp } from "../messageRendering.js";
import { sendOutboundMessage } from "../messaging/messagingService.js";
import type { MessagingProvider } from "../messaging/messagingProvider.js";
import type { AutomationRun } from "@prisma/client";

/** Total send attempts allowed for one run before giving up (bounded, not unlimited). */
export const MAX_SEND_ATTEMPTS = 3;
/** Exponential backoff base — attempt 1 waits 60s, attempt 2 waits 120s, etc. */
const BASE_BACKOFF_SECONDS = 60;
/**
 * How long a worker's claim on a run is valid before another worker may
 * presume it dead and recover the run. Must comfortably exceed how long a
 * single execution (a handful of DB reads + one provider HTTP call + one
 * write) ever legitimately takes — recovering a run whose worker is merely
 * slow, not dead, would itself cause a duplicate send. 5 minutes is a
 * generous multiple of expected execution time for this phase's single
 * outbound SMS call.
 */
export const LEASE_DURATION_SECONDS = 300;

/**
 * This module intentionally does NOT go through automation.service.ts's
 * transitionRun/ALLOWED_TRANSITIONS state machine — that machine governs
 * API-driven transitions a business owner triggers explicitly (e.g. a
 * future "cancel this pending run" endpoint), where PENDING is the only
 * cancellable state. The worker's transitions below are engine-internal:
 * it holds an exclusive lease on a RUNNING run (see claimDueAutomationRuns)
 * and moves it to its final state directly, via the same
 * `updateMany({ where: { status: "RUNNING" } })` claim-guard pattern used
 * throughout this codebase (markReviewRequestReviewed, transitionRun
 * itself) — safe without reusing that function's allow-list, which was
 * never designed for RUNNING -> CANCELLED or RUNNING -> PENDING (retry /
 * stale-run recovery).
 */

/**
 * Polls for due PENDING runs and atomically claims each one, establishing
 * a fresh execution lease. Two workers (or two ticks of the same worker)
 * racing on the same run: both may see it in their `findMany` snapshot,
 * but only one's `updateMany` — a single conditional UPDATE, atomic in
 * Postgres — actually flips PENDING -> RUNNING; the loser's `count` is 0
 * and it moves on. The database is the only authority here, not any
 * in-memory tracking.
 */
export async function claimDueAutomationRuns(limit = 20, now: Date = new Date()): Promise<AutomationRun[]> {
  const due = await prisma.automationRun.findMany({
    where: { status: "PENDING", scheduledFor: { lte: now } },
    orderBy: { scheduledFor: "asc" },
    take: limit,
  });

  const claimed: AutomationRun[] = [];
  for (const run of due) {
    const startedAt = new Date();
    const leaseExpiresAt = new Date(startedAt.getTime() + LEASE_DURATION_SECONDS * 1000);
    const result = await prisma.automationRun.updateMany({
      where: { id: run.id, status: "PENDING" },
      data: { status: "RUNNING", startedAt, leaseExpiresAt },
    });
    if (result.count === 1) {
      claimed.push({ ...run, status: "RUNNING", startedAt, leaseExpiresAt });
    }
  }
  return claimed;
}

/**
 * Finds RUNNING runs whose lease has *definitely* expired — never merely
 * old — and returns them to PENDING so a live worker can reclaim them
 * through the normal claim path above (which establishes a fresh lease).
 * This is the crash-recovery mechanism: a worker that claimed a run and
 * then crashed/was killed never got the chance to move it to a terminal
 * status, so it would otherwise stay RUNNING forever.
 *
 * Race-safe and idempotent the same way claiming is: the WHERE clause
 * (status RUNNING AND lease actually expired) is re-checked at UPDATE
 * time, so two workers concurrently recovering the same stale run produce
 * exactly one successful demotion to PENDING — the other's `count` is 0.
 * Recovering an already-recovered (now PENDING or since-reclaimed RUNNING)
 * run is a safe no-op.
 */
export async function recoverStaleAutomationRuns(limit = 20, now: Date = new Date()): Promise<number> {
  const stale = await prisma.automationRun.findMany({
    where: { status: "RUNNING", leaseExpiresAt: { not: null, lte: now } },
    orderBy: { leaseExpiresAt: "asc" },
    take: limit,
    select: { id: true },
  });

  let recovered = 0;
  for (const run of stale) {
    const result = await prisma.automationRun.updateMany({
      where: { id: run.id, status: "RUNNING", leaseExpiresAt: { lte: now } },
      data: { status: "PENDING", leaseExpiresAt: null },
    });
    recovered += result.count;
  }
  return recovered;
}

async function cancelRun(runId: string, reason: string): Promise<void> {
  await prisma.automationRun.updateMany({
    where: { id: runId, status: "RUNNING" },
    data: { status: "CANCELLED", cancelledAt: new Date(), leaseExpiresAt: null, errorMessage: reason },
  });
}

/**
 * Re-validates every condition from scratch — never trusts anything about
 * the world as it was when this run was scheduled, nor (critically for
 * stale-run recovery) anything about what a *previous* execution attempt
 * for this exact run may have already done. This is the complete
 * execute-time recheck: prior-outcome, rule, entitlement, lead, lead
 * state, customer, phone, opt-out — in that order, cheapest and
 * least-ambiguous checks first.
 *
 * SEND-DUPLICATION SAFETY (read before changing this function):
 *
 * A worker can crash at any of four points relative to the provider call:
 *   1. before calling the provider — safe, nothing happened, recovery just
 *      re-attempts normally.
 *   2. during the provider HTTP call — ambiguous from Chakusa's side (did
 *      Twilio receive it or not?), but nothing was ever recorded as sent,
 *      so recovery re-attempting is the same bet a human retry would make.
 *   3. immediately after the provider *accepts* the message but before the
 *      Message row / AutomationRun status commit — the SMS has now
 *      genuinely been dispatched to the carrier, and Chakusa has no record
 *      of it yet.
 *   4. between committing the Message row and committing the AutomationRun
 *      status update — narrowed to effectively zero by wrapping both in a
 *      single `prisma.$transaction` below, but not eliminated (the process
 *      can still die between Postgres acknowledging the COMMIT and the
 *      Node process observing it).
 *
 * Window 3 is the one genuinely unavoidable duplicate-send risk in this
 * architecture: Twilio's standard SMS API has no server-side idempotency
 * key (see the Phase 2 report), so there is no way to ask "did you already
 * receive this exact send" before retrying. This function does not — and
 * cannot — close that window. What it does do is shrink the *blast
 * radius*: the `Message.automationRunId` link (checked first, below)
 * makes re-execution of the *same* run idempotent from Chakusa's own
 * bookkeeping perspective once *any* outcome has been durably recorded —
 * so the only remaining exposure is the narrow gap between "Twilio
 * returned 'accepted'" and "the transaction below commits," not the full
 * lease duration. A crash inside that specific gap is the one scenario
 * that can still produce a real second SMS to the customer; there is no
 * further mitigation available without provider-side idempotency support,
 * which does not exist for standard Twilio SMS.
 */
export async function executeAutomationRun(run: AutomationRun, provider?: MessagingProvider): Promise<void> {
  try {
    // If a Message already exists for this exact run, a previous execution
    // already reached the provider and its outcome was durably recorded —
    // most likely this run was RUNNING when its worker crashed after
    // sending but before updating this row, and stale-run recovery
    // returned it to PENDING for reclaim. Never call the provider again
    // for the same run; reconcile status from what's already known instead.
    const existingMessage = await prisma.message.findFirst({ where: { automationRunId: run.id } });
    if (existingMessage) {
      await prisma.automationRun.updateMany({
        where: { id: run.id, status: "RUNNING" },
        data: {
          status: existingMessage.status === "sent" ? "COMPLETED" : "FAILED",
          completedAt: new Date(),
          leaseExpiresAt: null,
        },
      });
      return;
    }

    const rule = await prisma.automationRule.findFirst({ where: { id: run.automationRuleId, businessId: run.businessId } });
    if (!rule || !rule.enabled) return cancelRun(run.id, "Automation rule no longer exists or is disabled");

    const subscription = await prisma.subscription.findUnique({
      where: { businessId: run.businessId },
      select: { plan: true, status: true },
    });
    if (!subscription || !isAutomationEntitled(subscription.plan, subscription.status)) {
      return cancelRun(run.id, "Business is no longer entitled to automation");
    }

    if (!run.leadId) return cancelRun(run.id, "Run has no associated lead");
    const lead = await prisma.lead.findFirst({ where: { id: run.leadId, businessId: run.businessId } });
    if (!lead) return cancelRun(run.id, "Lead no longer exists");
    if (lead.source !== LEAD_SOURCE_MISSED_CALL) return cancelRun(run.id, "Lead no longer represents a missed-call case");
    if (lead.status !== "new") return cancelRun(run.id, `Lead has already been actioned (status: ${lead.status})`);

    if (!run.customerId) return cancelRun(run.id, "Run has no associated customer");
    const customer = await prisma.customer.findFirst({ where: { id: run.customerId, businessId: run.businessId } });
    if (!customer) return cancelRun(run.id, "Customer no longer exists");
    if (!customer.phoneE164) return cancelRun(run.id, "Customer has no valid E.164 phone number");

    const optOut = await prisma.customerOptOut.findFirst({
      where: { businessId: run.businessId, phone: customer.phoneE164, channel: { in: ["SMS", "ALL"] } },
    });
    if (optOut) return cancelRun(run.id, "Customer has opted out of SMS");

    const business = await prisma.business.findUniqueOrThrow({ where: { id: run.businessId } });
    const body = await renderMissedCallFollowUp(business, lead, customer);
    const countryCode = parsePhoneNumber(customer.phoneE164).country ?? "ZZ";

    const result = await sendOutboundMessage(
      { to: customer.phoneE164, channel: "sms", body, countryCode, idempotencyKey: run.id },
      provider,
    );

    if (result.accepted) {
      // Message row + AutomationRun status committed together — see the
      // "SEND-DUPLICATION SAFETY" note above for exactly what this does
      // and does not guarantee.
      await prisma.$transaction([
        prisma.message.create({
          data: {
            businessId: run.businessId,
            customerId: customer.id,
            leadId: lead.id,
            automationRunId: run.id,
            messageType: "missed_call",
            channel: "sms",
            body,
            status: "sent",
            sentAt: new Date(),
            provider: "twilio",
            providerMessageId: result.providerMessageId,
          },
        }),
        prisma.automationRun.updateMany({
          where: { id: run.id, status: "RUNNING" },
          data: { status: "COMPLETED", completedAt: new Date(), leaseExpiresAt: null },
        }),
      ]);
      return;
    }

    // Not accepted. A Message row is only ever created once there is a
    // final outcome (here, or below on give-up) — an in-progress transient
    // retry never logs a "failed" Message the owner would see, since only
    // one logical send either eventually succeeds or is finally given up
    // on.
    const nextAttempt = run.attemptCount + 1;
    const givingUp = result.permanentFailure || nextAttempt >= MAX_SEND_ATTEMPTS;

    if (givingUp) {
      await prisma.$transaction([
        prisma.message.create({
          data: {
            businessId: run.businessId,
            customerId: customer.id,
            leadId: lead.id,
            automationRunId: run.id,
            messageType: "missed_call",
            channel: "sms",
            body,
            status: "failed",
            provider: "twilio",
            providerMessageId: result.providerMessageId,
          },
        }),
        prisma.automationRun.updateMany({
          where: { id: run.id, status: "RUNNING" },
          data: {
            status: "FAILED",
            completedAt: new Date(),
            leaseExpiresAt: null,
            attemptCount: nextAttempt,
            errorMessage: result.permanentFailure
              ? (result.errorCode ?? "Permanent provider failure")
              : `Max attempts reached: ${result.errorCode ?? "transient provider failure"}`,
          },
        }),
      ]);
      return;
    }

    // Transient, attempts remain — requeue with exponential backoff. The
    // durable AutomationRun row (not an in-memory timer) is what survives
    // a worker crash/restart between now and the retry. attemptCount is
    // only ever incremented here (a real send attempt with a known
    // transient outcome) — stale-run recovery never touches it, since a
    // recovery doesn't know whether a send attempt actually happened.
    const backoffSeconds = BASE_BACKOFF_SECONDS * 2 ** run.attemptCount;
    await prisma.automationRun.updateMany({
      where: { id: run.id, status: "RUNNING" },
      data: {
        status: "PENDING",
        leaseExpiresAt: null,
        attemptCount: nextAttempt,
        scheduledFor: new Date(Date.now() + backoffSeconds * 1000),
        errorMessage: result.errorCode ?? "Transient provider failure",
      },
    });
  } catch (error) {
    // Anything unexpected (DB hiccup, bug) must never crash the worker
    // loop — mark this run FAILED (preserving why) and move on to the
    // next one.
    console.error("[automation-worker] execution error", error);
    await prisma.automationRun
      .updateMany({
        where: { id: run.id, status: "RUNNING" },
        data: { status: "FAILED", completedAt: new Date(), leaseExpiresAt: null, errorMessage: error instanceof Error ? error.message : "Unknown execution error" },
      })
      .catch(() => undefined); // even the failure-marking write must not throw out of here.
  }
}

/** One poll cycle: recover anything stale, claim whatever's newly due, execute each claimed run in turn. */
export async function processDueAutomationRuns(
  provider?: MessagingProvider,
  limit = 20,
): Promise<{ processed: number; recovered: number }> {
  const recovered = await recoverStaleAutomationRuns(limit);
  const claimed = await claimDueAutomationRuns(limit);
  for (const run of claimed) {
    await executeAutomationRun(run, provider);
  }
  return { processed: claimed.length, recovered };
}
