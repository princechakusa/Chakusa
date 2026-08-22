import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, resetDatabase, registerAccount, authHeader, setPlan, setSubscriptionStatus } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { LEAD_SOURCE_MISSED_CALL, LEAD_SOURCE_PUBLIC_PROFILE } from "../src/lib/leadSources.js";
import { createAutomationRule } from "../src/modules/automation/automation.service.js";
import { scheduleMissedCallFollowUp } from "../src/lib/automation/scheduler.js";
import { buildLeadCreatedDedupeKey } from "../src/lib/automation/dedupeKey.js";
import { claimDueAutomationRuns, executeAutomationRun, processDueAutomationRuns, MAX_SEND_ATTEMPTS } from "../src/lib/automation/executor.js";
import type { MessagingProvider, OutboundMessage, SendResult } from "../src/lib/messaging/messagingProvider.js";
import type { AutomationRun } from "@prisma/client";

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

async function makeEnabledRule(businessId: string, delaySeconds = 0) {
  return createAutomationRule(businessId, "PRO", "ACTIVE", {
    name: "Missed call recovery",
    enabled: true,
    triggerType: "LEAD_CREATED",
    channel: "SMS",
    delaySeconds,
    config: {},
  });
}

async function makeCustomer(businessId: string, phoneE164: string | null = "+263771234567") {
  return prisma.customer.create({ data: { businessId, name: "Test Customer", phoneE164 } });
}

async function makeMissedCallLead(businessId: string, customerId: string | null, status: "new" | "contacted" = "new") {
  return prisma.lead.create({
    data: { businessId, customerId, source: LEAD_SOURCE_MISSED_CALL, status },
  });
}

/** Force a run back into RUNNING as if a worker had just claimed it — used to test multi-attempt sequences without waiting on real backoff timers. */
async function forceRunning(runId: string) {
  return prisma.automationRun.update({ where: { id: runId }, data: { status: "RUNNING" } });
}

describe("automation execution engine (Phase 4)", () => {
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
  // Scheduling (trigger)
  // ---------------------------------------------------------------------

  it("1. schedules a run for an enabled PRO missed-call rule, and does not send anything yet", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const rule = await makeEnabledRule(businessId, 300);
    const customer = await makeCustomer(businessId);

    const response = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: { customerId: customer.id, source: LEAD_SOURCE_MISSED_CALL },
    });
    expect(response.statusCode).toBe(201);

    const runs = await prisma.automationRun.findMany({ where: { businessId } });
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("PENDING");
    expect(runs[0]?.automationRuleId).toBe(rule.id);
    expect(runs[0]?.customerId).toBe(customer.id);

    // Nothing sent yet — lead creation must stay fast and side-effect-free
    // for messaging.
    expect(await prisma.message.count({ where: { businessId } })).toBe(0);
  });

  it("2. does not schedule automation for a FREE business", async () => {
    const { token, businessId } = await registerAccount(app);
    // Seed a rule directly (bypassing the PRO-only create endpoint) to
    // simulate a business that downgraded after creating it — the
    // scheduler must re-check current entitlement, not merely "does an
    // enabled rule exist."
    const rule = await prisma.automationRule.create({
      data: { businessId, name: "Stale rule", enabled: true, triggerType: "LEAD_CREATED", channel: "SMS", delaySeconds: 0 },
    });
    const customer = await makeCustomer(businessId);

    await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: { customerId: customer.id, source: LEAD_SOURCE_MISSED_CALL },
    });

    expect(await prisma.automationRun.count({ where: { businessId, automationRuleId: rule.id } })).toBe(0);
  });

  it("3. does not schedule automation for a non-missed-call lead", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    await makeEnabledRule(businessId);
    const customer = await makeCustomer(businessId);

    await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: { customerId: customer.id, source: "referral" },
    });

    expect(await prisma.automationRun.count({ where: { businessId } })).toBe(0);
  });

  it("4. does not schedule automation for a disabled rule", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    await createAutomationRule(businessId, "PRO", "ACTIVE", {
      name: "Disabled rule",
      enabled: false,
      triggerType: "LEAD_CREATED",
      channel: "SMS",
      delaySeconds: 0,
      config: {},
    });
    const customer = await makeCustomer(businessId);

    await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: { customerId: customer.id, source: LEAD_SOURCE_MISSED_CALL },
    });

    expect(await prisma.automationRun.count({ where: { businessId } })).toBe(0);
  });

  it("5. does not create a duplicate run when the same lead event is scheduled twice", async () => {
    const { businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    await makeEnabledRule(businessId);
    const customer = await makeCustomer(businessId);
    const lead = await makeMissedCallLead(businessId, customer.id);

    await scheduleMissedCallFollowUp(businessId, lead);
    await scheduleMissedCallFollowUp(businessId, lead); // simulated duplicate processing of the same event

    expect(await prisma.automationRun.count({ where: { businessId } })).toBe(1);
  });

  it("6. builds a deterministic dedupe key", () => {
    const keyA1 = buildLeadCreatedDedupeKey("rule-1", "lead-1");
    const keyA2 = buildLeadCreatedDedupeKey("rule-1", "lead-1");
    const keyDifferentLead = buildLeadCreatedDedupeKey("rule-1", "lead-2");
    const keyDifferentRule = buildLeadCreatedDedupeKey("rule-2", "lead-1");

    expect(keyA1).toBe(keyA2);
    expect(keyA1).not.toBe(keyDifferentLead);
    expect(keyA1).not.toBe(keyDifferentRule);
  });

  it("6b. concurrent processing of the same event produces exactly one AutomationRun", async () => {
    const { businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    await makeEnabledRule(businessId);
    const customer = await makeCustomer(businessId);
    const lead = await makeMissedCallLead(businessId, customer.id);

    await Promise.all([
      scheduleMissedCallFollowUp(businessId, lead),
      scheduleMissedCallFollowUp(businessId, lead),
      scheduleMissedCallFollowUp(businessId, lead),
    ]);

    expect(await prisma.automationRun.count({ where: { businessId } })).toBe(1);
  });

  it("7. applies the rule's delaySeconds to scheduledFor", async () => {
    const { businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    await makeEnabledRule(businessId, 900);
    const customer = await makeCustomer(businessId);
    const lead = await makeMissedCallLead(businessId, customer.id);

    const before = Date.now();
    await scheduleMissedCallFollowUp(businessId, lead);
    const after = Date.now();

    const run = await prisma.automationRun.findFirstOrThrow({ where: { businessId } });
    const scheduledOffsetMs = run.scheduledFor.getTime() - before;
    expect(scheduledOffsetMs).toBeGreaterThanOrEqual(900_000);
    expect(run.scheduledFor.getTime()).toBeLessThanOrEqual(after + 900_000 + 1000);
  });

  // ---------------------------------------------------------------------
  // Claiming / concurrency
  // ---------------------------------------------------------------------

  it("8. atomically claims a due PENDING run", async () => {
    const { businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const rule = await makeEnabledRule(businessId);
    const customer = await makeCustomer(businessId);
    const lead = await makeMissedCallLead(businessId, customer.id);
    const run = await prisma.automationRun.create({
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

    expect(claimed.map((r) => r.id)).toContain(run.id);
    const fresh = await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(fresh.status).toBe("RUNNING");
    expect(fresh.startedAt).not.toBeNull();
  });

  it("9. does not let two concurrent claim attempts both claim the same run", async () => {
    const { businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const rule = await makeEnabledRule(businessId);
    const customer = await makeCustomer(businessId);
    const lead = await makeMissedCallLead(businessId, customer.id);
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

    const [claimedA, claimedB] = await Promise.all([claimDueAutomationRuns(), claimDueAutomationRuns()]);

    const totalClaimed = claimedA.length + claimedB.length;
    expect(totalClaimed).toBe(1);
  });

  // ---------------------------------------------------------------------
  // Execute-time entitlement recheck
  // ---------------------------------------------------------------------

  async function scheduleAndClaimRun(businessId: string, options: { customerPhone?: string | null; leadStatus?: "new" | "contacted" } = {}) {
    const rule = await makeEnabledRule(businessId);
    // "customerPhone" in options distinguishes "not provided" (use the
    // default) from "explicitly null" (test wants no usable phone) — `??`
    // alone can't, since it treats null and undefined identically.
    const phone: string | null = "customerPhone" in options ? (options.customerPhone ?? null) : "+263771234567";
    const customer = await makeCustomer(businessId, phone);
    const lead = await makeMissedCallLead(businessId, customer.id, options.leadStatus ?? "new");
    const run = await prisma.automationRun.create({
      data: {
        businessId,
        automationRuleId: rule.id,
        customerId: customer.id,
        leadId: lead.id,
        dedupeKey: buildLeadCreatedDedupeKey(rule.id, lead.id),
        scheduledFor: new Date(Date.now() - 1000),
        status: "RUNNING",
        startedAt: new Date(),
      },
    });
    return { rule, customer, lead, run };
  }

  it("10. cancels the run instead of sending when the subscription has expired", async () => {
    const { businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const { run } = await scheduleAndClaimRun(businessId);
    await setSubscriptionStatus(businessId, "EXPIRED");
    const { provider, calls } = makeFakeProvider();

    await executeAutomationRun(run, provider);

    expect(calls).toHaveLength(0);
    const fresh = await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(fresh.status).toBe("CANCELLED");
  });

  it("11. cancels the run instead of sending when the subscription is canceled", async () => {
    const { businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const { run } = await scheduleAndClaimRun(businessId);
    await setSubscriptionStatus(businessId, "CANCELED");
    const { provider, calls } = makeFakeProvider();

    await executeAutomationRun(run, provider);

    expect(calls).toHaveLength(0);
    const fresh = await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(fresh.status).toBe("CANCELLED");
  });

  it("12. allows sending when the subscription is trialing", async () => {
    const { businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const { run } = await scheduleAndClaimRun(businessId);
    await setSubscriptionStatus(businessId, "TRIALING");
    const { provider, calls } = makeFakeProvider();

    await executeAutomationRun(run, provider);

    expect(calls).toHaveLength(1);
    const fresh = await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(fresh.status).toBe("COMPLETED");
  });

  it("13. allows sending when the subscription is in its grace period", async () => {
    const { businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const { run } = await scheduleAndClaimRun(businessId);
    await setSubscriptionStatus(businessId, "GRACE_PERIOD");
    const { provider, calls } = makeFakeProvider();

    await executeAutomationRun(run, provider);

    expect(calls).toHaveLength(1);
    const fresh = await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(fresh.status).toBe("COMPLETED");
  });

  // ---------------------------------------------------------------------
  // Execute-time lead/customer/opt-out rechecks
  // ---------------------------------------------------------------------

  it("14. cancels the run when the lead has already been contacted before execution", async () => {
    const { businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const { run, lead } = await scheduleAndClaimRun(businessId);
    await prisma.lead.update({ where: { id: lead.id }, data: { status: "contacted" } });
    const { provider, calls } = makeFakeProvider();

    await executeAutomationRun(run, provider);

    expect(calls).toHaveLength(0);
    const fresh = await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(fresh.status).toBe("CANCELLED");
  });

  it("15. cancels the run when the customer has opted out of SMS", async () => {
    const { businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const { run, customer } = await scheduleAndClaimRun(businessId);
    await prisma.customerOptOut.create({
      data: { businessId, customerId: customer.id, phone: customer.phoneE164!, channel: "SMS", source: "manual" },
    });
    const { provider, calls } = makeFakeProvider();

    await executeAutomationRun(run, provider);

    expect(calls).toHaveLength(0);
    const fresh = await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(fresh.status).toBe("CANCELLED");
  });

  it("16. cancels the run when the customer has no valid E.164 phone", async () => {
    const { businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const { run } = await scheduleAndClaimRun(businessId, { customerPhone: null });
    const { provider, calls } = makeFakeProvider();

    await executeAutomationRun(run, provider);

    expect(calls).toHaveLength(0);
    const fresh = await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(fresh.status).toBe("CANCELLED");
  });

  // ---------------------------------------------------------------------
  // Send outcomes
  // ---------------------------------------------------------------------

  it("17. creates the correct Message record on a successful send", async () => {
    const { businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const { run, customer, lead } = await scheduleAndClaimRun(businessId);
    const { provider } = makeFakeProvider(async () => ({ accepted: true, providerMessageId: "SM-auto-1", permanentFailure: false }));

    await executeAutomationRun(run, provider);

    const message = await prisma.message.findFirstOrThrow({ where: { businessId } });
    expect(message).toMatchObject({
      businessId,
      customerId: customer.id,
      leadId: lead.id,
      messageType: "missed_call",
      channel: "sms",
      status: "sent",
      provider: "twilio",
      providerMessageId: "SM-auto-1",
    });
    expect(message.sentAt).not.toBeNull();
  });

  it("17b. schedules automation for a public_profile lead and sends public_profile_inquiry wording, not missed-call wording", async () => {
    const { token, businessId } = await registerAccount(app, { businessName: "Fresh Cuts" });
    await setPlan(businessId, "PRO");
    await makeEnabledRule(businessId, 0);

    const customerResponse = await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(token),
      payload: { name: "Sam", phone: "+263771234567" },
    });
    const customerId = customerResponse.json().id;

    const leadResponse = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: { customerId, source: LEAD_SOURCE_PUBLIC_PROFILE, serviceRequested: "hair coloring" },
    });

    const run = await prisma.automationRun.findFirstOrThrow({ where: { businessId, leadId: leadResponse.json().id } });
    await forceRunning(run.id);
    const { provider, calls } = makeFakeProvider(async () => ({ accepted: true, providerMessageId: "SM-public-profile-1", permanentFailure: false }));

    await executeAutomationRun({ ...run, status: "RUNNING" }, provider);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toContain("thanks for reaching out");
    expect(calls[0]!.body).not.toContain("missed your call");

    const message = await prisma.message.findFirstOrThrow({ where: { businessId } });
    expect(message.messageType).toBe("public_profile_inquiry");
  });

  it("18. completes the AutomationRun on a successful send", async () => {
    const { businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const { run } = await scheduleAndClaimRun(businessId);
    const { provider } = makeFakeProvider();

    await executeAutomationRun(run, provider);

    const fresh = await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(fresh.status).toBe("COMPLETED");
    expect(fresh.completedAt).not.toBeNull();
  });

  it("19. does not retry a permanent provider failure", async () => {
    const { businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const { run } = await scheduleAndClaimRun(businessId);
    const { provider } = makeFakeProvider(async () => ({ accepted: false, errorCode: "21211", permanentFailure: true }));

    await executeAutomationRun(run, provider);

    const fresh = await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(fresh.status).toBe("FAILED");
    expect(fresh.attemptCount).toBe(1);
    const message = await prisma.message.findFirstOrThrow({ where: { businessId } });
    expect(message.status).toBe("failed");
  });

  it("20. requeues a transient provider failure with bounded backoff instead of failing immediately", async () => {
    const { businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const { run } = await scheduleAndClaimRun(businessId);
    const { provider } = makeFakeProvider(async () => ({ accepted: false, errorCode: "20500", permanentFailure: false }));

    const before = Date.now();
    await executeAutomationRun(run, provider);

    const fresh = await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(fresh.status).toBe("PENDING");
    expect(fresh.attemptCount).toBe(1);
    expect(fresh.scheduledFor.getTime()).toBeGreaterThan(before);
    // No Message row yet — only a terminal outcome logs one.
    expect(await prisma.message.count({ where: { businessId } })).toBe(0);
  });

  it("21. marks FAILED once the maximum attempt count is reached", async () => {
    const { businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const { run } = await scheduleAndClaimRun(businessId);
    const { provider } = makeFakeProvider(async () => ({ accepted: false, errorCode: "20500", permanentFailure: false }));

    let current: AutomationRun = run;
    for (let attempt = 0; attempt < MAX_SEND_ATTEMPTS; attempt += 1) {
      await forceRunning(current.id);
      current = await prisma.automationRun.findUniqueOrThrow({ where: { id: current.id } });
      await executeAutomationRun(current, provider);
      current = await prisma.automationRun.findUniqueOrThrow({ where: { id: current.id } });
    }

    expect(current.status).toBe("FAILED");
    expect(current.attemptCount).toBe(MAX_SEND_ATTEMPTS);
    expect(current.errorMessage).toContain("Max attempts reached");
    expect(await prisma.message.count({ where: { businessId } })).toBe(1);
  });

  it("22. creates exactly one Message when two concurrent poll cycles race the same due run", async () => {
    const { businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const rule = await makeEnabledRule(businessId);
    const customer = await makeCustomer(businessId);
    const lead = await makeMissedCallLead(businessId, customer.id);
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

    const providerA = makeFakeProvider();
    const providerB = makeFakeProvider();

    await Promise.all([processDueAutomationRuns(providerA.provider), processDueAutomationRuns(providerB.provider)]);

    expect(providerA.calls.length + providerB.calls.length).toBe(1);
    expect(await prisma.message.count({ where: { businessId } })).toBe(1);
  });

  // ---------------------------------------------------------------------
  // Tenant isolation
  // ---------------------------------------------------------------------

  it("23. never touches another business's data while executing a run", async () => {
    const businessA = await registerAccount(app, { email: "worker-a@example.com" });
    const businessB = await registerAccount(app, { email: "worker-b@example.com" });
    await setPlan(businessA.businessId, "PRO");
    await setPlan(businessB.businessId, "PRO");

    const { run: runA } = await scheduleAndClaimRun(businessA.businessId);
    const { run: runB } = await scheduleAndClaimRun(businessB.businessId);

    const { provider } = makeFakeProvider();
    await executeAutomationRun(runA, provider);

    const freshA = await prisma.automationRun.findUniqueOrThrow({ where: { id: runA.id } });
    const freshB = await prisma.automationRun.findUniqueOrThrow({ where: { id: runB.id } });
    expect(freshA.status).toBe("COMPLETED");
    expect(freshB.status).toBe("RUNNING"); // untouched by A's execution

    expect(await prisma.message.count({ where: { businessId: businessB.businessId } })).toBe(0);
  });

  // ---------------------------------------------------------------------
  // Regression
  // ---------------------------------------------------------------------

  it("24. leaves the Free manual workflow fully functional", async () => {
    const { token } = await registerAccount(app);

    const customer = await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(token),
      payload: { name: "Manual Flow", phone: "+263771234567" },
    });
    expect(customer.statusCode).toBe(201);

    const lead = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: { customerId: customer.json().id, serviceRequested: "haircut" },
    });
    expect(lead.statusCode).toBe(201);

    const generated = await app.inject({
      method: "POST",
      url: `/leads/${lead.json().id}/generate-message`,
      headers: authHeader(token),
    });
    expect(generated.statusCode).toBe(200);
    expect(typeof generated.json().message).toBe("string");
  });

  it("25. still delivers push notifications alongside automation scheduling", async () => {
    const { token, userId, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    await makeEnabledRule(businessId);
    const customer = await makeCustomer(businessId);
    const deviceToken = "ExponentPushToken[automation-phase4-aaaaaaaaaa]";
    await app.inject({
      method: "POST",
      url: "/devices",
      headers: authHeader(token),
      payload: { token: deviceToken, platform: "ios" },
    });

    const { provider: pushProvider, calls: pushCalls } = (() => {
      const calls: { tokens: string[] }[] = [];
      return {
        provider: {
          isValidToken: () => true,
          sendToDevice: async (t: string) => { calls.push({ tokens: [t] }); return { token: t, accepted: true, invalidToken: false }; },
          sendToDevices: async (tokens: string[]) => { calls.push({ tokens }); return tokens.map((t) => ({ token: t, accepted: true, invalidToken: false })); },
        },
        calls,
      };
    })();

    const { createLead } = await import("../src/modules/leads/leads.service.js");
    await createLead(
      businessId,
      userId,
      { customerId: customer.id, source: LEAD_SOURCE_MISSED_CALL, urgency: "medium" } as never,
      "PRO",
      pushProvider,
    );

    expect(pushCalls).toHaveLength(1); // existing push notification still fires
    expect(await prisma.automationRun.count({ where: { businessId } })).toBe(1); // and automation still schedules
  });
});
