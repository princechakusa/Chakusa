import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, resetDatabase, registerAccount, authHeader, setPlan } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import {
  createAutomationRule,
  createAutomationRun,
  markAutomationRunStarted,
  markAutomationRunCompleted,
  markAutomationRunFailed,
  cancelAutomationRun,
} from "../src/modules/automation/automation.service.js";

describe("automation domain model", () => {
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
  // AutomationRule — entitlement
  // ---------------------------------------------------------------------

  it("1. FREE business cannot create an automation rule", async () => {
    const { token } = await registerAccount(app);

    const response = await app.inject({
      method: "POST",
      url: "/automation/rules",
      headers: authHeader(token),
      payload: { name: "Missed call recovery", triggerType: "LEAD_CREATED" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("FEATURE_NOT_AVAILABLE");
  });

  it("2. PRO business can create an automation rule", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");

    const response = await app.inject({
      method: "POST",
      url: "/automation/rules",
      headers: authHeader(token),
      payload: { name: "Missed call recovery", triggerType: "LEAD_CREATED", delaySeconds: 300 },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.triggerType).toBe("LEAD_CREATED");
    expect(body.enabled).toBe(false);
    expect(body.delaySeconds).toBe(300);
  });

  // ---------------------------------------------------------------------
  // AutomationRule — tenant isolation
  // ---------------------------------------------------------------------

  it("3. Business A cannot access Business B's automation rules", async () => {
    const businessA = await registerAccount(app, { email: "automation-a@example.com" });
    const businessB = await registerAccount(app, { email: "automation-b@example.com" });
    await setPlan(businessA.businessId, "PRO");
    await setPlan(businessB.businessId, "PRO");

    const rule = await createAutomationRule(businessB.businessId, "PRO", "ACTIVE", {
      name: "B's rule",
      enabled: false,
      triggerType: "LEAD_CREATED",
      channel: "SMS",
      delaySeconds: 0,
      config: {},
    });

    const getResponse = await app.inject({
      method: "GET",
      url: `/automation/rules/${rule.id}`,
      headers: authHeader(businessA.token),
    });
    expect(getResponse.statusCode).toBe(404);

    const listResponse = await app.inject({
      method: "GET",
      url: "/automation/rules",
      headers: authHeader(businessA.token),
    });
    expect(listResponse.json()).toEqual([]);

    const patchResponse = await app.inject({
      method: "PATCH",
      url: `/automation/rules/${rule.id}`,
      headers: authHeader(businessA.token),
      payload: { name: "hijacked" },
    });
    expect(patchResponse.statusCode).toBe(404);
  });

  // ---------------------------------------------------------------------
  // AutomationRule — config validation
  // ---------------------------------------------------------------------

  it("4. rejects invalid config for LEAD_FOLLOW_UP (bad lead status)", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");

    const response = await app.inject({
      method: "POST",
      url: "/automation/rules",
      headers: authHeader(token),
      payload: {
        name: "Follow up",
        triggerType: "LEAD_FOLLOW_UP",
        config: { leadStatuses: ["not_a_real_status"] },
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("4b. accepts valid config for LEAD_FOLLOW_UP", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");

    const response = await app.inject({
      method: "POST",
      url: "/automation/rules",
      headers: authHeader(token),
      payload: {
        name: "Follow up",
        triggerType: "LEAD_FOLLOW_UP",
        config: { leadStatuses: ["new", "contacted"] },
      },
    });

    expect(response.statusCode).toBe(201);
  });

  // ---------------------------------------------------------------------
  // AutomationRule — enable/disable
  // ---------------------------------------------------------------------

  it("5. disabled rules cannot be treated as active; enable/disable works", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");

    const createResponse = await app.inject({
      method: "POST",
      url: "/automation/rules",
      headers: authHeader(token),
      payload: { name: "Retention", triggerType: "CUSTOMER_RETENTION" },
    });
    const ruleId = createResponse.json().id;
    expect(createResponse.json().enabled).toBe(false);

    const enableResponse = await app.inject({
      method: "POST",
      url: `/automation/rules/${ruleId}/enable`,
      headers: authHeader(token),
    });
    expect(enableResponse.statusCode).toBe(200);
    expect(enableResponse.json().enabled).toBe(true);

    const disableResponse = await app.inject({
      method: "POST",
      url: `/automation/rules/${ruleId}/disable`,
      headers: authHeader(token),
    });
    expect(disableResponse.statusCode).toBe(200);
    expect(disableResponse.json().enabled).toBe(false);
  });

  // ---------------------------------------------------------------------
  // AutomationRule — no execution endpoint
  // ---------------------------------------------------------------------

  it("6. there is no route that executes an automation", async () => {
    const { token } = await registerAccount(app);

    const response = await app.inject({
      method: "POST",
      url: "/automation/run",
      headers: authHeader(token),
      payload: {},
    });

    expect(response.statusCode).toBe(404);
  });

  // ---------------------------------------------------------------------
  // AutomationRun — internal creation
  // ---------------------------------------------------------------------

  it("7. a valid run can be created internally and belongs to the correct business", async () => {
    const { businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");

    const rule = await createAutomationRule(businessId, "PRO", "ACTIVE", {
      name: "Recovery",
      enabled: true,
      triggerType: "LEAD_CREATED",
      channel: "SMS",
      delaySeconds: 60,
      config: {},
    });

    const run = await createAutomationRun(businessId, {
      automationRuleId: rule.id,
      dedupeKey: `${rule.id}:lead:test-1`,
      scheduledFor: new Date(),
    });

    expect(run.businessId).toBe(businessId);
    expect(run.status).toBe("PENDING");
  });

  it("8. customer ownership is enforced when creating a run", async () => {
    const businessA = await registerAccount(app, { email: "run-a@example.com" });
    const businessB = await registerAccount(app, { email: "run-b@example.com" });
    await setPlan(businessA.businessId, "PRO");

    const rule = await createAutomationRule(businessA.businessId, "PRO", "ACTIVE", {
      name: "Recovery",
      enabled: true,
      triggerType: "CUSTOMER_RETENTION",
      channel: "SMS",
      delaySeconds: 0,
      config: {},
    });

    const foreignCustomer = await prisma.customer.create({
      data: { businessId: businessB.businessId, name: "Foreign customer" },
    });

    await expect(
      createAutomationRun(businessA.businessId, {
        automationRuleId: rule.id,
        customerId: foreignCustomer.id,
        dedupeKey: `${rule.id}:customer:${foreignCustomer.id}`,
        scheduledFor: new Date(),
      }),
    ).rejects.toThrow();
  });

  it("9. lead ownership is enforced when creating a run", async () => {
    const businessA = await registerAccount(app, { email: "run-lead-a@example.com" });
    const businessB = await registerAccount(app, { email: "run-lead-b@example.com" });
    await setPlan(businessA.businessId, "PRO");

    const rule = await createAutomationRule(businessA.businessId, "PRO", "ACTIVE", {
      name: "Recovery",
      enabled: true,
      triggerType: "LEAD_CREATED",
      channel: "SMS",
      delaySeconds: 0,
      config: {},
    });

    const foreignLead = await prisma.lead.create({
      data: { businessId: businessB.businessId },
    });

    await expect(
      createAutomationRun(businessA.businessId, {
        automationRuleId: rule.id,
        leadId: foreignLead.id,
        dedupeKey: `${rule.id}:lead:${foreignLead.id}`,
        scheduledFor: new Date(),
      }),
    ).rejects.toThrow();
  });

  it("10. Business isolation: cannot create a run against another business's rule", async () => {
    const businessA = await registerAccount(app, { email: "run-cross-a@example.com" });
    const businessB = await registerAccount(app, { email: "run-cross-b@example.com" });
    await setPlan(businessB.businessId, "PRO");

    const ruleB = await createAutomationRule(businessB.businessId, "PRO", "ACTIVE", {
      name: "B's rule",
      enabled: true,
      triggerType: "LEAD_CREATED",
      channel: "SMS",
      delaySeconds: 0,
      config: {},
    });

    await expect(
      createAutomationRun(businessA.businessId, {
        automationRuleId: ruleB.id,
        dedupeKey: `${ruleB.id}:lead:x`,
        scheduledFor: new Date(),
      }),
    ).rejects.toThrow();
  });

  // ---------------------------------------------------------------------
  // AutomationRun — idempotency
  // ---------------------------------------------------------------------

  it("11. idempotency: duplicate dedupeKey for the same business is rejected", async () => {
    const { businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");

    const rule = await createAutomationRule(businessId, "PRO", "ACTIVE", {
      name: "Recovery",
      enabled: true,
      triggerType: "LEAD_CREATED",
      channel: "SMS",
      delaySeconds: 0,
      config: {},
    });

    const dedupeKey = `${rule.id}:lead:dup-1`;

    await createAutomationRun(businessId, { automationRuleId: rule.id, dedupeKey, scheduledFor: new Date() });

    await expect(
      createAutomationRun(businessId, { automationRuleId: rule.id, dedupeKey, scheduledFor: new Date() }),
    ).rejects.toThrow();

    const runs = await prisma.automationRun.count({ where: { businessId, dedupeKey } });
    expect(runs).toBe(1);
  });

  it("11b. same dedupeKey is allowed across different businesses", async () => {
    const businessA = await registerAccount(app, { email: "dedupe-a@example.com" });
    const businessB = await registerAccount(app, { email: "dedupe-b@example.com" });
    await setPlan(businessA.businessId, "PRO");
    await setPlan(businessB.businessId, "PRO");

    const ruleA = await createAutomationRule(businessA.businessId, "PRO", "ACTIVE", {
      name: "Recovery A",
      enabled: true,
      triggerType: "LEAD_CREATED",
      channel: "SMS",
      delaySeconds: 0,
      config: {},
    });
    const ruleB = await createAutomationRule(businessB.businessId, "PRO", "ACTIVE", {
      name: "Recovery B",
      enabled: true,
      triggerType: "LEAD_CREATED",
      channel: "SMS",
      delaySeconds: 0,
      config: {},
    });

    const sharedKey = "shared-key-across-tenants";

    const runA = await createAutomationRun(businessA.businessId, {
      automationRuleId: ruleA.id,
      dedupeKey: sharedKey,
      scheduledFor: new Date(),
    });
    const runB = await createAutomationRun(businessB.businessId, {
      automationRuleId: ruleB.id,
      dedupeKey: sharedKey,
      scheduledFor: new Date(),
    });

    expect(runA.id).not.toBe(runB.id);
  });

  // ---------------------------------------------------------------------
  // AutomationRun — state transitions
  // ---------------------------------------------------------------------

  async function makeRun(businessId: string) {
    const rule = await createAutomationRule(businessId, "PRO", "ACTIVE", {
      name: "Recovery",
      enabled: true,
      triggerType: "LEAD_CREATED",
      channel: "SMS",
      delaySeconds: 0,
      config: {},
    });
    return createAutomationRun(businessId, {
      automationRuleId: rule.id,
      dedupeKey: `${rule.id}:lead:${Math.random()}`,
      scheduledFor: new Date(),
    });
  }

  it("12. valid transitions: PENDING -> RUNNING -> COMPLETED", async () => {
    const { businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const run = await makeRun(businessId);

    const running = await markAutomationRunStarted(businessId, run.id);
    expect(running.status).toBe("RUNNING");
    expect(running.startedAt).not.toBeNull();

    const completed = await markAutomationRunCompleted(businessId, run.id);
    expect(completed.status).toBe("COMPLETED");
    expect(completed.completedAt).not.toBeNull();
  });

  it("13. valid transition: RUNNING -> FAILED with error message", async () => {
    const { businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const run = await makeRun(businessId);

    await markAutomationRunStarted(businessId, run.id);
    const failed = await markAutomationRunFailed(businessId, run.id, "provider unreachable");

    expect(failed.status).toBe("FAILED");
    expect(failed.errorMessage).toBe("provider unreachable");
  });

  it("14. valid transition: PENDING -> CANCELLED", async () => {
    const { businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const run = await makeRun(businessId);

    const cancelled = await cancelAutomationRun(businessId, run.id);
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancelledAt).not.toBeNull();
  });

  it("15. invalid transition: COMPLETED -> RUNNING is rejected", async () => {
    const { businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const run = await makeRun(businessId);

    await markAutomationRunStarted(businessId, run.id);
    await markAutomationRunCompleted(businessId, run.id);

    await expect(markAutomationRunStarted(businessId, run.id)).rejects.toThrow();
  });

  it("16. invalid transition: RUNNING -> CANCELLED is rejected", async () => {
    const { businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const run = await makeRun(businessId);

    await markAutomationRunStarted(businessId, run.id);

    await expect(cancelAutomationRun(businessId, run.id)).rejects.toThrow();
  });

  it("17. invalid transition: cannot cancel an already-cancelled run", async () => {
    const { businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const run = await makeRun(businessId);

    await cancelAutomationRun(businessId, run.id);

    await expect(cancelAutomationRun(businessId, run.id)).rejects.toThrow();
  });

  // ---------------------------------------------------------------------
  // Regression — Phase 1/2 behavior must remain unchanged
  // ---------------------------------------------------------------------

  it("18. existing FREE customer creation still works", async () => {
    const { token } = await registerAccount(app);

    const response = await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(token),
      payload: { name: "Jane Doe" },
    });

    expect(response.statusCode).toBe(201);
  });

  it("19. existing FREE lead creation still works", async () => {
    const { token } = await registerAccount(app);

    const response = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: {},
    });

    expect(response.statusCode).toBe(201);
  });

  it("20. no customer creation automatically sends a message or creates a run", async () => {
    const { token, businessId } = await registerAccount(app);

    await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(token),
      payload: { name: "No Auto Message" },
    });

    const runs = await prisma.automationRun.count({ where: { businessId } });
    const messages = await prisma.message.count({ where: { businessId } });
    expect(runs).toBe(0);
    expect(messages).toBe(0);
  });

  it("21. no lead creation automatically sends a message or creates a run", async () => {
    const { token, businessId } = await registerAccount(app);

    await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: {},
    });

    const runs = await prisma.automationRun.count({ where: { businessId } });
    const messages = await prisma.message.count({ where: { businessId } });
    expect(runs).toBe(0);
    expect(messages).toBe(0);
  });

  it("22. no AutomationRule creation automatically sends a message", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");

    await app.inject({
      method: "POST",
      url: "/automation/rules",
      headers: authHeader(token),
      payload: { name: "Recovery", triggerType: "LEAD_CREATED", enabled: true },
    });

    const messages = await prisma.message.count({ where: { businessId } });
    const runs = await prisma.automationRun.count({ where: { businessId } });
    expect(messages).toBe(0);
    expect(runs).toBe(0);
  });

  it("23. no AutomationRun creation automatically sends a message", async () => {
    const { businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");

    await makeRun(businessId);

    const messages = await prisma.message.count({ where: { businessId } });
    expect(messages).toBe(0);
  });

  it("24. existing PRO manual SMS remains functional (entitlement path untouched)", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");

    const customer = await prisma.customer.create({
      data: { businessId, name: "Manual Send Target", phoneE164: "+15551234567" },
    });

    const response = await app.inject({
      method: "POST",
      url: "/messages/send",
      headers: authHeader(token),
      payload: { customerId: customer.id, body: "hello" },
    });

    // No live Twilio credentials in test env — accept anything other than
    // the entitlement/validation failures this phase could have caused.
    expect(response.statusCode).not.toBe(403);
    expect(response.statusCode).not.toBe(404);
  });

  it("25. opt-out protection remains intact for manual sends", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");

    const customer = await prisma.customer.create({
      data: { businessId, name: "Opted Out", phoneE164: "+15559999999" },
    });
    await prisma.customerOptOut.create({
      data: { businessId, customerId: customer.id, phone: "+15559999999", channel: "ALL", source: "manual" },
    });

    const response = await app.inject({
      method: "POST",
      url: "/messages/send",
      headers: authHeader(token),
      payload: { customerId: customer.id, body: "hello" },
    });

    expect(response.statusCode).toBe(403);
  });
});
