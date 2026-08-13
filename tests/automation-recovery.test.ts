import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, resetDatabase, registerAccount, setPlan, setSubscriptionStatus } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { createAutomationRule } from "../src/modules/automation/automation.service.js";
import { buildLeadCreatedDedupeKey } from "../src/lib/automation/dedupeKey.js";
import {
  claimDueAutomationRuns,
  recoverStaleAutomationRuns,
  executeAutomationRun,
  LEASE_DURATION_SECONDS,
} from "../src/lib/automation/executor.js";
import { LEAD_SOURCE_MISSED_CALL } from "../src/lib/leadSources.js";
import type { MessagingProvider, OutboundMessage, SendResult } from "../src/lib/messaging/messagingProvider.js";

function makeFakeProvider(sendImpl?: (message: OutboundMessage) => Promise<SendResult>) {
  const calls: OutboundMessage[] = [];
  const provider: MessagingProvider = {
    id: "fake-test-provider",
    supportsChannel: () => true,
    send: async (message) => {
      calls.push(message);
      return sendImpl ? sendImpl(message) : { accepted: true, providerMessageId: "fake-msg-1", permanentFailure: false };
    },
    parseDeliveryWebhook: () => null,
    parseInboundWebhook: () => null,
    verifyWebhookSignature: () => false,
  };
  return { provider, calls };
}

async function makeEnabledRule(businessId: string) {
  return createAutomationRule(businessId, "PRO", {
    name: "Missed call recovery",
    enabled: true,
    triggerType: "LEAD_CREATED",
    channel: "SMS",
    delaySeconds: 0,
    config: {},
  });
}

async function makeRunningRun(
  businessId: string,
  options: { leaseAgeSeconds?: number; attemptCount?: number; customerPhone?: string | null } = {},
) {
  const rule = await makeEnabledRule(businessId);
  const phone = "customerPhone" in options ? (options.customerPhone ?? null) : "+263771234567";
  const customer = await prisma.customer.create({ data: { businessId, name: "Recovery Customer", phoneE164: phone } });
  const lead = await prisma.lead.create({
    data: { businessId, customerId: customer.id, source: LEAD_SOURCE_MISSED_CALL, status: "new" },
  });

  const startedAt = new Date(Date.now() - (options.leaseAgeSeconds ?? 0) * 1000);
  const leaseExpiresAt = new Date(startedAt.getTime() + LEASE_DURATION_SECONDS * 1000);

  const run = await prisma.automationRun.create({
    data: {
      businessId,
      automationRuleId: rule.id,
      customerId: customer.id,
      leadId: lead.id,
      dedupeKey: buildLeadCreatedDedupeKey(rule.id, lead.id),
      scheduledFor: startedAt,
      status: "RUNNING",
      startedAt,
      leaseExpiresAt,
      attemptCount: options.attemptCount ?? 0,
    },
  });
  return { rule, customer, lead, run };
}

describe("automation worker crash recovery (Phase 4 hardening)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------------
  // Lease claiming
  // ---------------------------------------------------------------------

  it("8. sets a fresh lease when a PENDING run is claimed", async () => {
    const { businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const rule = await makeEnabledRule(businessId);
    const customer = await prisma.customer.create({ data: { businessId, name: "C", phoneE164: "+263771234567" } });
    const lead = await prisma.lead.create({ data: { businessId, customerId: customer.id, source: LEAD_SOURCE_MISSED_CALL } });
    await prisma.automationRun.create({
      data: {
        businessId,
        automationRuleId: rule.id,
        customerId: customer.id,
        leadId: lead.id,
        dedupeKey: buildLeadCreatedDedupeKey(rule.id, lead.id),
        scheduledFor: new Date(Date.now() - 1000),
      },
    });

    const before = Date.now();
    const claimed = await claimDueAutomationRuns();
    expect(claimed).toHaveLength(1);

    const fresh = await prisma.automationRun.findUniqueOrThrow({ where: { id: claimed[0]!.id } });
    expect(fresh.status).toBe("RUNNING");
    expect(fresh.leaseExpiresAt).not.toBeNull();
    expect(fresh.leaseExpiresAt!.getTime()).toBeGreaterThanOrEqual(before + LEASE_DURATION_SECONDS * 1000);
  });

  // ---------------------------------------------------------------------
  // Recovery eligibility
  // ---------------------------------------------------------------------

  it("1. does not recover a RUNNING run whose lease is still valid", async () => {
    const { businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const { run } = await makeRunningRun(businessId, { leaseAgeSeconds: 5 }); // claimed 5s ago, lease good for LEASE_DURATION_SECONDS

    const recoveredCount = await recoverStaleAutomationRuns();

    expect(recoveredCount).toBe(0);
    const fresh = await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(fresh.status).toBe("RUNNING");
  });

  it("2. recovers a RUNNING run whose lease has expired", async () => {
    const { businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const { run } = await makeRunningRun(businessId, { leaseAgeSeconds: LEASE_DURATION_SECONDS + 60 }); // claimed well past the lease window

    const recoveredCount = await recoverStaleAutomationRuns();

    expect(recoveredCount).toBe(1);
    const fresh = await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(fresh.status).toBe("PENDING");
    expect(fresh.leaseExpiresAt).toBeNull();
  });

  it("2b. does not recover a run merely because it is old, absent an expired lease", async () => {
    // A run created a long time ago but never actually claimed (still
    // PENDING, no lease at all) must never be touched by recovery — only
    // RUNNING rows with a genuinely expired lease qualify.
    const { businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const rule = await makeEnabledRule(businessId);
    const customer = await prisma.customer.create({ data: { businessId, name: "Old pending", phoneE164: "+263771234567" } });
    const lead = await prisma.lead.create({ data: { businessId, customerId: customer.id, source: LEAD_SOURCE_MISSED_CALL } });
    await prisma.automationRun.create({
      data: {
        businessId,
        automationRuleId: rule.id,
        customerId: customer.id,
        leadId: lead.id,
        dedupeKey: buildLeadCreatedDedupeKey(rule.id, lead.id),
        scheduledFor: new Date(Date.now() - 999_999_999),
        status: "PENDING",
      },
    });

    const recoveredCount = await recoverStaleAutomationRuns();
    expect(recoveredCount).toBe(0);
  });

  it("3. lets only one of two concurrent recovery attempts win the same stale run", async () => {
    const { businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    await makeRunningRun(businessId, { leaseAgeSeconds: LEASE_DURATION_SECONDS + 60 });

    const [countA, countB] = await Promise.all([recoverStaleAutomationRuns(), recoverStaleAutomationRuns()]);

    expect(countA + countB).toBe(1);
  });

  // ---------------------------------------------------------------------
  // Recovered runs execute normally
  // ---------------------------------------------------------------------

  it("4. executes normally once a recovered run is reclaimed", async () => {
    const { businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const { run } = await makeRunningRun(businessId, { leaseAgeSeconds: LEASE_DURATION_SECONDS + 60 });

    await recoverStaleAutomationRuns();
    const reclaimed = await claimDueAutomationRuns();
    expect(reclaimed.map((r) => r.id)).toContain(run.id);

    const { provider, calls } = makeFakeProvider();
    const target = reclaimed.find((r) => r.id === run.id)!;
    await executeAutomationRun(target, provider);

    expect(calls).toHaveLength(1);
    const fresh = await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(fresh.status).toBe("COMPLETED");
  });

  it("5. leaves attemptCount unchanged by recovery itself — only a real send attempt increments it", async () => {
    const { businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const { run } = await makeRunningRun(businessId, { leaseAgeSeconds: LEASE_DURATION_SECONDS + 60, attemptCount: 1 });

    await recoverStaleAutomationRuns();
    const afterRecovery = await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(afterRecovery.attemptCount).toBe(1); // untouched by recovery

    const reclaimed = await claimDueAutomationRuns();
    const target = reclaimed.find((r) => r.id === run.id)!;
    const { provider } = makeFakeProvider(async () => ({ accepted: false, errorCode: "20500", permanentFailure: false }));
    await executeAutomationRun(target, provider);

    const afterAttempt = await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(afterAttempt.attemptCount).toBe(2); // incremented once, by the actual send attempt
  });

  it("6. still cancels a recovered run when the subscription has expired", async () => {
    const { businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const { run } = await makeRunningRun(businessId, { leaseAgeSeconds: LEASE_DURATION_SECONDS + 60 });
    await setSubscriptionStatus(businessId, "EXPIRED");

    await recoverStaleAutomationRuns();
    const reclaimed = await claimDueAutomationRuns();
    const target = reclaimed.find((r) => r.id === run.id)!;
    const { provider, calls } = makeFakeProvider();
    await executeAutomationRun(target, provider);

    expect(calls).toHaveLength(0);
    const fresh = await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(fresh.status).toBe("CANCELLED");
  });

  it("7. still cancels a recovered run when the customer has opted out", async () => {
    const { businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const { run, customer } = await makeRunningRun(businessId, { leaseAgeSeconds: LEASE_DURATION_SECONDS + 60 });
    await prisma.customerOptOut.create({
      data: { businessId, customerId: customer.id, phone: customer.phoneE164!, channel: "ALL", source: "manual" },
    });

    await recoverStaleAutomationRuns();
    const reclaimed = await claimDueAutomationRuns();
    const target = reclaimed.find((r) => r.id === run.id)!;
    const { provider, calls } = makeFakeProvider();
    await executeAutomationRun(target, provider);

    expect(calls).toHaveLength(0);
    const fresh = await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(fresh.status).toBe("CANCELLED");
  });

  // ---------------------------------------------------------------------
  // Duplicate-send safety net (Message.automationRunId idempotency guard)
  // ---------------------------------------------------------------------

  it("9a. does not call the provider again when a Message already exists for this run (simulated post-send crash)", async () => {
    // Simulates crash window 3/4 from the executor's documentation: the
    // provider already accepted the message and it was durably recorded,
    // but the run itself never got marked COMPLETED before the process
    // died — exactly the state stale-run recovery would hand back to a
    // worker.
    const { businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const { run, customer, lead } = await makeRunningRun(businessId, { leaseAgeSeconds: LEASE_DURATION_SECONDS + 60 });
    await prisma.message.create({
      data: {
        businessId,
        customerId: customer.id,
        leadId: lead.id,
        automationRunId: run.id,
        messageType: "missed_call",
        channel: "sms",
        body: "Already sent before the crash",
        status: "sent",
        sentAt: new Date(),
        provider: "twilio",
        providerMessageId: "SM-already-sent",
      },
    });

    await recoverStaleAutomationRuns();
    const reclaimed = await claimDueAutomationRuns();
    const target = reclaimed.find((r) => r.id === run.id)!;
    const { provider, calls } = makeFakeProvider();

    await executeAutomationRun(target, provider);

    expect(calls).toHaveLength(0); // never sent again
    expect(await prisma.message.count({ where: { businessId } })).toBe(1); // still exactly one Message
    const fresh = await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(fresh.status).toBe("COMPLETED"); // reconciled from the existing Message's outcome
  });

  it("9b. reconciles to FAILED when the pre-existing Message for this run recorded a failure", async () => {
    const { businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const { run, customer, lead } = await makeRunningRun(businessId, { leaseAgeSeconds: LEASE_DURATION_SECONDS + 60 });
    await prisma.message.create({
      data: {
        businessId,
        customerId: customer.id,
        leadId: lead.id,
        automationRunId: run.id,
        messageType: "missed_call",
        channel: "sms",
        body: "Failed before the crash",
        status: "failed",
        provider: "twilio",
      },
    });

    await recoverStaleAutomationRuns();
    const reclaimed = await claimDueAutomationRuns();
    const target = reclaimed.find((r) => r.id === run.id)!;
    const { provider, calls } = makeFakeProvider();

    await executeAutomationRun(target, provider);

    expect(calls).toHaveLength(0);
    const fresh = await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(fresh.status).toBe("FAILED");
  });

  it("9. normal (non-recovered) successful execution still tags the Message with automationRunId", async () => {
    const { businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const rule = await makeEnabledRule(businessId);
    const customer = await prisma.customer.create({ data: { businessId, name: "Normal", phoneE164: "+263771234567" } });
    const lead = await prisma.lead.create({ data: { businessId, customerId: customer.id, source: LEAD_SOURCE_MISSED_CALL, status: "new" } });
    await prisma.automationRun.create({
      data: {
        businessId,
        automationRuleId: rule.id,
        customerId: customer.id,
        leadId: lead.id,
        dedupeKey: buildLeadCreatedDedupeKey(rule.id, lead.id),
        scheduledFor: new Date(Date.now() - 1000),
      },
    });

    const claimed = await claimDueAutomationRuns();
    const { provider } = makeFakeProvider(async () => ({ accepted: true, providerMessageId: "SM-normal", permanentFailure: false }));
    await executeAutomationRun(claimed[0]!, provider);

    const message = await prisma.message.findFirstOrThrow({ where: { businessId } });
    expect(message.automationRunId).toBe(claimed[0]!.id);
    expect(message.status).toBe("sent");
    const run = await prisma.automationRun.findUniqueOrThrow({ where: { id: claimed[0]!.id } });
    expect(run.status).toBe("COMPLETED");
    expect(run.leaseExpiresAt).toBeNull(); // lease cleared on terminal status
  });
});
