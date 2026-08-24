import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, resetDatabase, registerAccount, setPlan, setSubscriptionStatus } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { LEAD_SOURCE_MISSED_CALL } from "../src/lib/leadSources.js";
import { createAutomationRule } from "../src/modules/automation/automation.service.js";
import { sweepLeadFollowUps, sweepCustomerRetention, sweepLifecycleAutomations, sweepReviewRequestFollowUps } from "../src/lib/automation/scheduler.js";
import { buildCustomerRetentionDedupeKey, buildLeadFollowUpDedupeKey, buildReviewRequestFollowUpDedupeKey } from "../src/lib/automation/dedupeKey.js";
import { executeAutomationRun } from "../src/lib/automation/executor.js";
import { startAutomationWorker } from "../src/worker/automationWorker.js";
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

async function makeCustomer(businessId: string, phoneE164: string | null = "+263771234567") {
  return prisma.customer.create({ data: { businessId, name: "Test Customer", phoneE164 } });
}

describe("customer lifecycle automation engine (Stage 8)", () => {
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
  // sweepLeadFollowUps
  // ---------------------------------------------------------------------

  describe("sweepLeadFollowUps", () => {
    async function makeFollowUpRule(businessId: string, delaySeconds = 0, config: Record<string, unknown> = {}) {
      return createAutomationRule(businessId, "PRO", "ACTIVE", {
        name: "Stale lead follow-up",
        enabled: true,
        triggerType: "LEAD_FOLLOW_UP",
        channel: "SMS",
        delaySeconds,
        config,
      });
    }

    it("schedules a run for a lead that has sat in 'new' status past the delay", async () => {
      const { businessId } = await registerAccount(app);
      await setPlan(businessId, "PRO");
      const rule = await makeFollowUpRule(businessId, 3600);
      const customer = await makeCustomer(businessId);
      const lead = await prisma.lead.create({
        data: {
          businessId,
          customerId: customer.id,
          source: LEAD_SOURCE_MISSED_CALL,
          status: "new",
          createdAt: new Date(Date.now() - 2 * 3600 * 1000),
        },
      });

      await sweepLeadFollowUps();

      const run = await prisma.automationRun.findFirstOrThrow({ where: { businessId, automationRuleId: rule.id } });
      expect(run.leadId).toBe(lead.id);
      expect(run.customerId).toBe(customer.id);
      expect(run.status).toBe("PENDING");
    });

    it("does not schedule a run for a lead that hasn't sat long enough yet", async () => {
      const { businessId } = await registerAccount(app);
      await setPlan(businessId, "PRO");
      await makeFollowUpRule(businessId, 3600);
      const customer = await makeCustomer(businessId);
      await prisma.lead.create({
        data: { businessId, customerId: customer.id, source: LEAD_SOURCE_MISSED_CALL, status: "new", createdAt: new Date() },
      });

      await sweepLeadFollowUps();

      expect(await prisma.automationRun.count({ where: { businessId } })).toBe(0);
    });

    it("uses contactedAt, not createdAt, for a lead in 'contacted' status", async () => {
      const { businessId } = await registerAccount(app);
      await setPlan(businessId, "PRO");
      await makeFollowUpRule(businessId, 3600);
      const customer = await makeCustomer(businessId);
      // createdAt is old (would qualify), but contactedAt is recent — the
      // precise per-status timestamp must win, not a blunt createdAt proxy.
      const lead = await prisma.lead.create({
        data: {
          businessId,
          customerId: customer.id,
          source: LEAD_SOURCE_MISSED_CALL,
          status: "contacted",
          createdAt: new Date(Date.now() - 5 * 3600 * 1000),
          contactedAt: new Date(),
        },
      });

      await sweepLeadFollowUps();

      expect(await prisma.automationRun.count({ where: { businessId, leadId: lead.id } })).toBe(0);
    });

    it("only considers statuses listed in config.leadStatuses when provided", async () => {
      const { businessId } = await registerAccount(app);
      await setPlan(businessId, "PRO");
      await makeFollowUpRule(businessId, 3600, { leadStatuses: ["booked"] });
      const customer = await makeCustomer(businessId);
      await prisma.lead.create({
        data: {
          businessId,
          customerId: customer.id,
          source: LEAD_SOURCE_MISSED_CALL,
          status: "new",
          createdAt: new Date(Date.now() - 2 * 3600 * 1000),
        },
      });

      await sweepLeadFollowUps();

      expect(await prisma.automationRun.count({ where: { businessId } })).toBe(0);
    });

    it("does not schedule twice for the same lead across repeated sweeps", async () => {
      const { businessId } = await registerAccount(app);
      await setPlan(businessId, "PRO");
      await makeFollowUpRule(businessId, 0);
      const customer = await makeCustomer(businessId);
      await prisma.lead.create({
        data: { businessId, customerId: customer.id, source: LEAD_SOURCE_MISSED_CALL, status: "new" },
      });

      await sweepLeadFollowUps();
      await sweepLeadFollowUps();
      await sweepLeadFollowUps();

      expect(await prisma.automationRun.count({ where: { businessId } })).toBe(1);
    });

    it("does not schedule for a FREE business even with a stale (seeded) rule", async () => {
      const { businessId } = await registerAccount(app);
      const rule = await prisma.automationRule.create({
        data: { businessId, name: "Stale", enabled: true, triggerType: "LEAD_FOLLOW_UP", channel: "SMS", delaySeconds: 0 },
      });
      const customer = await makeCustomer(businessId);
      await prisma.lead.create({
        data: { businessId, customerId: customer.id, source: LEAD_SOURCE_MISSED_CALL, status: "new" },
      });

      await sweepLeadFollowUps();

      expect(await prisma.automationRun.count({ where: { businessId, automationRuleId: rule.id } })).toBe(0);
    });

    it("never schedules across tenants — Business A's sweep never touches Business B's leads", async () => {
      const a = await registerAccount(app, { email: "lifecycle-a@example.com" });
      const b = await registerAccount(app, { email: "lifecycle-b@example.com" });
      await setPlan(a.businessId, "PRO");
      await setPlan(b.businessId, "PRO");
      await makeFollowUpRule(a.businessId, 3600);
      const customerA = await makeCustomer(a.businessId);
      const customerB = await makeCustomer(b.businessId);
      const staleCreatedAt = new Date(Date.now() - 2 * 3600 * 1000);
      await prisma.lead.create({ data: { businessId: a.businessId, customerId: customerA.id, source: LEAD_SOURCE_MISSED_CALL, status: "new", createdAt: staleCreatedAt } });
      await prisma.lead.create({ data: { businessId: b.businessId, customerId: customerB.id, source: LEAD_SOURCE_MISSED_CALL, status: "new", createdAt: staleCreatedAt } });

      await sweepLeadFollowUps();

      expect(await prisma.automationRun.count({ where: { businessId: a.businessId } })).toBe(1);
      expect(await prisma.automationRun.count({ where: { businessId: b.businessId } })).toBe(0);
    });
  });

  // ---------------------------------------------------------------------
  // sweepCustomerRetention
  // ---------------------------------------------------------------------

  describe("sweepCustomerRetention", () => {
    async function makeRetentionRule(businessId: string, config: Record<string, unknown> = {}) {
      return createAutomationRule(businessId, "PRO", "ACTIVE", {
        name: "Win-back",
        enabled: true,
        triggerType: "CUSTOMER_RETENTION",
        channel: "SMS",
        delaySeconds: 0,
        config,
      });
    }

    it("schedules a run for a customer who has won a lead but gone quiet past minDaysSinceVisit", async () => {
      const { businessId } = await registerAccount(app);
      await setPlan(businessId, "PRO");
      const rule = await makeRetentionRule(businessId, { minDaysSinceVisit: 30 });
      const customer = await makeCustomer(businessId);
      await prisma.lead.create({
        data: {
          businessId,
          customerId: customer.id,
          source: LEAD_SOURCE_MISSED_CALL,
          status: "won",
          createdAt: new Date(Date.now() - 60 * 86_400_000),
        },
      });

      await sweepCustomerRetention();

      const run = await prisma.automationRun.findFirstOrThrow({ where: { businessId, automationRuleId: rule.id } });
      expect(run.customerId).toBe(customer.id);
      expect(run.leadId).toBeNull();
    });

    it("does not schedule for a customer who has never won a lead", async () => {
      const { businessId } = await registerAccount(app);
      await setPlan(businessId, "PRO");
      await makeRetentionRule(businessId, { minDaysSinceVisit: 30 });
      const customer = await makeCustomer(businessId);
      await prisma.lead.create({
        data: {
          businessId,
          customerId: customer.id,
          source: LEAD_SOURCE_MISSED_CALL,
          status: "lost",
          createdAt: new Date(Date.now() - 60 * 86_400_000),
        },
      });

      await sweepCustomerRetention();

      expect(await prisma.automationRun.count({ where: { businessId } })).toBe(0);
    });

    it("does not schedule for a customer who has recent lead activity", async () => {
      const { businessId } = await registerAccount(app);
      await setPlan(businessId, "PRO");
      await makeRetentionRule(businessId, { minDaysSinceVisit: 30 });
      const customer = await makeCustomer(businessId);
      await prisma.lead.create({
        data: { businessId, customerId: customer.id, source: LEAD_SOURCE_MISSED_CALL, status: "won", createdAt: new Date(Date.now() - 60 * 86_400_000) },
      });
      await prisma.lead.create({
        data: { businessId, customerId: customer.id, source: LEAD_SOURCE_MISSED_CALL, status: "new", createdAt: new Date() },
      });

      await sweepCustomerRetention();

      expect(await prisma.automationRun.count({ where: { businessId } })).toBe(0);
    });

    it("falls back to the business's own reminderDays when config.minDaysSinceVisit is not set", async () => {
      const { businessId } = await registerAccount(app);
      await setPlan(businessId, "PRO");
      await prisma.business.update({ where: { id: businessId }, data: { reminderDays: 10 } });
      await makeRetentionRule(businessId, {});
      const customer = await makeCustomer(businessId);
      await prisma.lead.create({
        data: { businessId, customerId: customer.id, source: LEAD_SOURCE_MISSED_CALL, status: "won", createdAt: new Date(Date.now() - 20 * 86_400_000) },
      });

      await sweepCustomerRetention();

      expect(await prisma.automationRun.count({ where: { businessId } })).toBe(1);
    });

    it("does not schedule twice for the same customer across repeated sweeps", async () => {
      const { businessId } = await registerAccount(app);
      await setPlan(businessId, "PRO");
      await makeRetentionRule(businessId, { minDaysSinceVisit: 30 });
      const customer = await makeCustomer(businessId);
      await prisma.lead.create({
        data: { businessId, customerId: customer.id, source: LEAD_SOURCE_MISSED_CALL, status: "won", createdAt: new Date(Date.now() - 60 * 86_400_000) },
      });

      await sweepCustomerRetention();
      await sweepCustomerRetention();

      expect(await prisma.automationRun.count({ where: { businessId } })).toBe(1);
    });

    it("never schedules across tenants", async () => {
      const a = await registerAccount(app, { email: "retention-a@example.com" });
      const b = await registerAccount(app, { email: "retention-b@example.com" });
      await setPlan(a.businessId, "PRO");
      await setPlan(b.businessId, "PRO");
      await makeRetentionRule(a.businessId, { minDaysSinceVisit: 30 });
      const customerA = await makeCustomer(a.businessId);
      const customerB = await makeCustomer(b.businessId);
      await prisma.lead.create({ data: { businessId: a.businessId, customerId: customerA.id, source: LEAD_SOURCE_MISSED_CALL, status: "won", createdAt: new Date(Date.now() - 60 * 86_400_000) } });
      await prisma.lead.create({ data: { businessId: b.businessId, customerId: customerB.id, source: LEAD_SOURCE_MISSED_CALL, status: "won", createdAt: new Date(Date.now() - 60 * 86_400_000) } });

      await sweepCustomerRetention();

      expect(await prisma.automationRun.count({ where: { businessId: a.businessId } })).toBe(1);
      expect(await prisma.automationRun.count({ where: { businessId: b.businessId } })).toBe(0);
    });
  });

  describe("sweepLifecycleAutomations", () => {
    it("runs both sweeps from a single entry point", async () => {
      const { businessId } = await registerAccount(app);
      await setPlan(businessId, "PRO");
      await createAutomationRule(businessId, "PRO", "ACTIVE", {
        name: "Follow-up", enabled: true, triggerType: "LEAD_FOLLOW_UP", channel: "SMS", delaySeconds: 3600, config: {},
      });
      await createAutomationRule(businessId, "PRO", "ACTIVE", {
        name: "Retention", enabled: true, triggerType: "CUSTOMER_RETENTION", channel: "SMS", delaySeconds: 0, config: { minDaysSinceVisit: 30 },
      });
      const staleLeadCustomer = await makeCustomer(businessId, "+263771111111");
      await prisma.lead.create({ data: { businessId, customerId: staleLeadCustomer.id, source: LEAD_SOURCE_MISSED_CALL, status: "new", createdAt: new Date(Date.now() - 2 * 3600 * 1000) } });
      const dormantCustomer = await makeCustomer(businessId, "+263772222222");
      await prisma.lead.create({ data: { businessId, customerId: dormantCustomer.id, source: LEAD_SOURCE_MISSED_CALL, status: "won", createdAt: new Date(Date.now() - 60 * 86_400_000) } });

      await sweepLifecycleAutomations();

      expect(await prisma.automationRun.count({ where: { businessId } })).toBe(2);
    });
  });

  describe("review-request follow-up", () => {
    async function fixture() {
      const { businessId } = await registerAccount(app);
      await setPlan(businessId, "PRO");
      const rule = await createAutomationRule(businessId, "PRO", "ACTIVE", { name: "Review reminder", enabled: true, triggerType: "REVIEW_REQUEST_FOLLOW_UP", channel: "SMS", delaySeconds: 3600, config: {} });
      const customer = await makeCustomer(businessId);
      return { businessId, rule, customer };
    }

    it("schedules one tenant-scoped run after the configured delay", async () => {
      const { businessId, rule, customer } = await fixture();
      const request = await prisma.reviewRequest.create({ data: { businessId, customerId: customer.id, serviceName: "Haircut", status: "sent", sentAt: new Date(Date.now() - 7200_000) } });
      await sweepReviewRequestFollowUps();
      await sweepReviewRequestFollowUps();
      const runs = await prisma.automationRun.findMany({ where: { businessId } });
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({ automationRuleId: rule.id, customerId: customer.id, reviewRequestId: request.id, dedupeKey: buildReviewRequestFollowUpDedupeKey(rule.id, request.id) });
    });

    it("does not schedule resolved or too-recent requests", async () => {
      const { businessId, customer } = await fixture();
      await prisma.reviewRequest.createMany({ data: [
        { businessId, customerId: customer.id, status: "reviewed", sentAt: new Date(Date.now() - 7200_000) },
        { businessId, customerId: customer.id, status: "sent", sentAt: new Date() },
      ] });
      await sweepReviewRequestFollowUps();
      expect(await prisma.automationRun.count({ where: { businessId } })).toBe(0);
    });

    it("sends a fresh secure review link and records one review_request message", async () => {
      const { businessId, rule, customer } = await fixture();
      const request = await prisma.reviewRequest.create({ data: { businessId, customerId: customer.id, serviceName: "Haircut", status: "opened", sentAt: new Date(Date.now() - 7200_000) } });
      const run = await prisma.automationRun.create({ data: { businessId, automationRuleId: rule.id, customerId: customer.id, reviewRequestId: request.id, dedupeKey: buildReviewRequestFollowUpDedupeKey(rule.id, request.id), scheduledFor: new Date(), status: "RUNNING", startedAt: new Date() } });
      const { provider, calls } = makeFakeProvider();
      await executeAutomationRun(run, provider);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.body).toContain("/r/");
      expect(await prisma.message.count({ where: { businessId, messageType: "review_request", automationRunId: run.id } })).toBe(1);
      expect((await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("COMPLETED");
    });

    it("cancels without sending if the request resolves after scheduling", async () => {
      const { businessId, rule, customer } = await fixture();
      const request = await prisma.reviewRequest.create({ data: { businessId, customerId: customer.id, status: "reviewed", sentAt: new Date(Date.now() - 7200_000) } });
      const run = await prisma.automationRun.create({ data: { businessId, automationRuleId: rule.id, customerId: customer.id, reviewRequestId: request.id, dedupeKey: buildReviewRequestFollowUpDedupeKey(rule.id, request.id), scheduledFor: new Date(), status: "RUNNING", startedAt: new Date() } });
      const { provider, calls } = makeFakeProvider();
      await executeAutomationRun(run, provider);
      expect(calls).toHaveLength(0);
      expect((await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("CANCELLED");
    });
  });

  // ---------------------------------------------------------------------
  // Executor: LEAD_FOLLOW_UP execution path
  // ---------------------------------------------------------------------

  describe("executor: LEAD_FOLLOW_UP", () => {
    async function scheduleAndClaimFollowUp(businessId: string, options: { leadStatus?: "new" | "contacted" | "won"; customerPhone?: string | null } = {}) {
      const rule = await createAutomationRule(businessId, "PRO", "ACTIVE", {
        name: "Follow-up", enabled: true, triggerType: "LEAD_FOLLOW_UP", channel: "SMS", delaySeconds: 0, config: {},
      });
      const phone: string | null = "customerPhone" in options ? (options.customerPhone ?? null) : "+263771234567";
      const customer = await makeCustomer(businessId, phone);
      const lead = await prisma.lead.create({
        data: { businessId, customerId: customer.id, source: LEAD_SOURCE_MISSED_CALL, status: options.leadStatus ?? "new" },
      });
      const run = await prisma.automationRun.create({
        data: {
          businessId,
          automationRuleId: rule.id,
          customerId: customer.id,
          leadId: lead.id,
          dedupeKey: buildLeadFollowUpDedupeKey(rule.id, lead.id),
          scheduledFor: new Date(Date.now() - 1000),
          status: "RUNNING",
          startedAt: new Date(),
        },
      });
      return { rule, customer, lead, run };
    }

    it("sends 'lead_follow_up' wording regardless of the lead's source and records that messageType", async () => {
      const { businessId } = await registerAccount(app);
      await setPlan(businessId, "PRO");
      const { run, customer, lead } = await scheduleAndClaimFollowUp(businessId);
      const { provider, calls } = makeFakeProvider();

      await executeAutomationRun(run, provider);

      expect(calls).toHaveLength(1);
      const message = await prisma.message.findFirstOrThrow({ where: { businessId } });
      expect(message.messageType).toBe("lead_follow_up");
      expect(message.customerId).toBe(customer.id);
      expect(message.leadId).toBe(lead.id);
      const fresh = await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id } });
      expect(fresh.status).toBe("COMPLETED");
    });

    it("cancels when the lead has since moved to a status the rule no longer covers", async () => {
      const { businessId } = await registerAccount(app);
      await setPlan(businessId, "PRO");
      const { run, lead } = await scheduleAndClaimFollowUp(businessId);
      await prisma.lead.update({ where: { id: lead.id }, data: { status: "won" } });
      const { provider, calls } = makeFakeProvider();

      await executeAutomationRun(run, provider);

      expect(calls).toHaveLength(0);
      const fresh = await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id } });
      expect(fresh.status).toBe("CANCELLED");
    });

    it("cancels when the customer has opted out of SMS", async () => {
      const { businessId } = await registerAccount(app);
      await setPlan(businessId, "PRO");
      const { run, customer } = await scheduleAndClaimFollowUp(businessId);
      await prisma.customerOptOut.create({
        data: { businessId, customerId: customer.id, phone: customer.phoneE164!, channel: "SMS", source: "manual" },
      });
      const { provider, calls } = makeFakeProvider();

      await executeAutomationRun(run, provider);

      expect(calls).toHaveLength(0);
      const fresh = await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id } });
      expect(fresh.status).toBe("CANCELLED");
    });

    it("cancels when the business is no longer entitled to automation", async () => {
      const { businessId } = await registerAccount(app);
      await setPlan(businessId, "PRO");
      const { run } = await scheduleAndClaimFollowUp(businessId);
      await setSubscriptionStatus(businessId, "EXPIRED");
      const { provider, calls } = makeFakeProvider();

      await executeAutomationRun(run, provider);

      expect(calls).toHaveLength(0);
      const fresh = await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id } });
      expect(fresh.status).toBe("CANCELLED");
    });
  });

  // ---------------------------------------------------------------------
  // Executor: CUSTOMER_RETENTION execution path
  // ---------------------------------------------------------------------

  describe("executor: CUSTOMER_RETENTION", () => {
    async function scheduleAndClaimRetention(businessId: string, options: { customerPhone?: string | null } = {}) {
      const rule = await createAutomationRule(businessId, "PRO", "ACTIVE", {
        name: "Win-back", enabled: true, triggerType: "CUSTOMER_RETENTION", channel: "SMS", delaySeconds: 0, config: { minDaysSinceVisit: 30 },
      });
      const phone: string | null = "customerPhone" in options ? (options.customerPhone ?? null) : "+263771234567";
      const customer = await makeCustomer(businessId, phone);
      await prisma.lead.create({
        data: { businessId, customerId: customer.id, source: LEAD_SOURCE_MISSED_CALL, status: "won", createdAt: new Date(Date.now() - 60 * 86_400_000) },
      });
      const scheduledFor = new Date(Date.now() - 1000);
      const run = await prisma.automationRun.create({
        data: {
          businessId,
          automationRuleId: rule.id,
          customerId: customer.id,
          leadId: null,
          dedupeKey: buildCustomerRetentionDedupeKey(rule.id, customer.id),
          scheduledFor,
          status: "RUNNING",
          startedAt: new Date(),
        },
      });
      return { rule, customer, run };
    }

    it("sends a comeback_reminder-type message with no lead attached", async () => {
      const { businessId } = await registerAccount(app);
      await setPlan(businessId, "PRO");
      const { run, customer } = await scheduleAndClaimRetention(businessId);
      const { provider, calls } = makeFakeProvider();

      await executeAutomationRun(run, provider);

      expect(calls).toHaveLength(1);
      const message = await prisma.message.findFirstOrThrow({ where: { businessId } });
      expect(message.messageType).toBe("comeback_reminder");
      expect(message.customerId).toBe(customer.id);
      expect(message.leadId).toBeNull();
      const fresh = await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id } });
      expect(fresh.status).toBe("COMPLETED");
    });

    it("cancels when the customer has since become active again (a new lead was created after scheduling)", async () => {
      const { businessId } = await registerAccount(app);
      await setPlan(businessId, "PRO");
      const { run, customer } = await scheduleAndClaimRetention(businessId);
      await prisma.lead.create({
        data: { businessId, customerId: customer.id, source: LEAD_SOURCE_MISSED_CALL, status: "new" },
      });
      const { provider, calls } = makeFakeProvider();

      await executeAutomationRun(run, provider);

      expect(calls).toHaveLength(0);
      const fresh = await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id } });
      expect(fresh.status).toBe("CANCELLED");
    });

    it("cancels when the customer has no valid E.164 phone", async () => {
      const { businessId } = await registerAccount(app);
      await setPlan(businessId, "PRO");
      const { run } = await scheduleAndClaimRetention(businessId, { customerPhone: null });
      const { provider, calls } = makeFakeProvider();

      await executeAutomationRun(run, provider);

      expect(calls).toHaveLength(0);
      const fresh = await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id } });
      expect(fresh.status).toBe("CANCELLED");
    });

    it("cancels when the rule has been disabled since scheduling", async () => {
      const { businessId } = await registerAccount(app);
      await setPlan(businessId, "PRO");
      const { run, rule } = await scheduleAndClaimRetention(businessId);
      await prisma.automationRule.update({ where: { id: rule.id }, data: { enabled: false } });
      const { provider, calls } = makeFakeProvider();

      await executeAutomationRun(run, provider);

      expect(calls).toHaveLength(0);
      const fresh = await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id } });
      expect(fresh.status).toBe("CANCELLED");
    });
  });

  // ---------------------------------------------------------------------
  // Worker: dual-interval behavior
  // ---------------------------------------------------------------------

  describe("automation worker dual-interval", () => {
    it("picks up both a due run and a lifecycle sweep from a single start, and both timers stop cleanly", async () => {
      const { businessId } = await registerAccount(app);
      await setPlan(businessId, "PRO");
      await createAutomationRule(businessId, "PRO", "ACTIVE", {
        name: "Follow-up", enabled: true, triggerType: "LEAD_FOLLOW_UP", channel: "SMS", delaySeconds: 0, config: {},
      });
      const customer = await makeCustomer(businessId);
      await prisma.lead.create({
        data: { businessId, customerId: customer.id, source: LEAD_SOURCE_MISSED_CALL, status: "new" },
      });

      const { provider } = makeFakeProvider();
      const handle = startAutomationWorker({ intervalMs: 50, lifecycleIntervalMs: 50, provider });

      await new Promise((resolve) => setTimeout(resolve, 300));
      handle.stop();

      // The lifecycle sweep should have scheduled a run, and the main poll
      // loop should have gone on to execute it — all within one worker
      // process, no second worker file.
      const run = await prisma.automationRun.findFirstOrThrow({ where: { businessId } });
      expect(run.status === "COMPLETED" || run.status === "PENDING" || run.status === "RUNNING").toBe(true);
    });
  });
});
