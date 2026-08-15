import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, resetDatabase, registerAccount, authHeader, setPlan, setSubscriptionStatus } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { createAutomationRule, createAutomationRun, setAutomationRuleEnabled } from "../src/modules/automation/automation.service.js";

describe("automation rule uniqueness (businessId + triggerType + channel)", () => {
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

  const missedCallPayload = { name: "Missed call recovery", triggerType: "LEAD_CREATED", channel: "SMS" };

  it("1. first LEAD_CREATED + SMS rule succeeds", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");

    const response = await app.inject({ method: "POST", url: "/automation/rules", headers: authHeader(token), payload: missedCallPayload });

    expect(response.statusCode).toBe(201);
  });

  it("2. a second identical rule for the same business is rejected with 409", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");

    const first = await app.inject({ method: "POST", url: "/automation/rules", headers: authHeader(token), payload: missedCallPayload });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({ method: "POST", url: "/automation/rules", headers: authHeader(token), payload: missedCallPayload });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("CONFLICT");

    expect(await prisma.automationRule.count({ where: { businessId, triggerType: "LEAD_CREATED", channel: "SMS" } })).toBe(1);
  });

  it("3. the same trigger/channel is allowed for a different business", async () => {
    const businessA = await registerAccount(app, { email: "uniq-a@example.com" });
    const businessB = await registerAccount(app, { email: "uniq-b@example.com" });
    await setPlan(businessA.businessId, "PRO");
    await setPlan(businessB.businessId, "PRO");

    const a = await app.inject({ method: "POST", url: "/automation/rules", headers: authHeader(businessA.token), payload: missedCallPayload });
    const b = await app.inject({ method: "POST", url: "/automation/rules", headers: authHeader(businessB.token), payload: missedCallPayload });

    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
  });

  it("4. concurrent identical creates cannot produce duplicate rows", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");

    const [a, b] = await Promise.all([
      app.inject({ method: "POST", url: "/automation/rules", headers: authHeader(token), payload: missedCallPayload }),
      app.inject({ method: "POST", url: "/automation/rules", headers: authHeader(token), payload: missedCallPayload }),
    ]);

    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
    expect(await prisma.automationRule.count({ where: { businessId, triggerType: "LEAD_CREATED", channel: "SMS" } })).toBe(1);
  });

  it("5. a different triggerType can coexist for the same business", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");

    const leadCreated = await app.inject({ method: "POST", url: "/automation/rules", headers: authHeader(token), payload: missedCallPayload });
    const retention = await app.inject({
      method: "POST",
      url: "/automation/rules",
      headers: authHeader(token),
      payload: { name: "Retention", triggerType: "CUSTOMER_RETENTION", channel: "SMS" },
    });

    expect(leadCreated.statusCode).toBe(201);
    expect(retention.statusCode).toBe(201);
    expect(await prisma.automationRule.count({ where: { businessId } })).toBe(2);
  });

  it("6. a different channel can coexist for the same business", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");

    const sms = await app.inject({ method: "POST", url: "/automation/rules", headers: authHeader(token), payload: missedCallPayload });
    const whatsapp = await app.inject({
      method: "POST",
      url: "/automation/rules",
      headers: authHeader(token),
      payload: { name: "Missed call recovery (WhatsApp)", triggerType: "LEAD_CREATED", channel: "WHATSAPP" },
    });

    expect(sms.statusCode).toBe(201);
    expect(whatsapp.statusCode).toBe(201);
    expect(await prisma.automationRule.count({ where: { businessId } })).toBe(2);
  });

  it("7. an existing rule can still be updated after the uniqueness constraint is in place", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const created = await app.inject({ method: "POST", url: "/automation/rules", headers: authHeader(token), payload: missedCallPayload });

    const updated = await app.inject({
      method: "PATCH",
      url: `/automation/rules/${created.json().id}`,
      headers: authHeader(token),
      payload: { delaySeconds: 900 },
    });

    expect(updated.statusCode).toBe(200);
    expect(updated.json().delaySeconds).toBe(900);
  });

  it("8. an existing rule can still be enabled/disabled after the uniqueness constraint is in place", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const created = await app.inject({ method: "POST", url: "/automation/rules", headers: authHeader(token), payload: missedCallPayload });

    const enabled = await app.inject({ method: "POST", url: `/automation/rules/${created.json().id}/enable`, headers: authHeader(token) });
    expect(enabled.json().enabled).toBe(true);

    const disabled = await app.inject({ method: "POST", url: `/automation/rules/${created.json().id}/disable`, headers: authHeader(token) });
    expect(disabled.json().enabled).toBe(false);
  });

  it("9. FREE entitlement still blocks rule creation", async () => {
    const { token } = await registerAccount(app);

    const response = await app.inject({ method: "POST", url: "/automation/rules", headers: authHeader(token), payload: missedCallPayload });

    expect(response.statusCode).toBe(403);
  });

  it("10. an expired Pro subscription still blocks rule creation/mutation", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    await setSubscriptionStatus(businessId, "EXPIRED");

    const response = await app.inject({ method: "POST", url: "/automation/rules", headers: authHeader(token), payload: missedCallPayload });

    expect(response.statusCode).toBe(403);
  });
});

describe("GET /automation/runs history", () => {
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

  async function setupBusinessWithRule(email: string) {
    const account = await registerAccount(app, { email });
    await setPlan(account.businessId, "PRO");
    const rule = await createAutomationRule(account.businessId, "PRO", "ACTIVE", {
      name: "Missed call recovery",
      enabled: true,
      triggerType: "LEAD_CREATED",
      channel: "SMS",
      delaySeconds: 0,
      config: {},
    });
    return { ...account, rule };
  }

  async function makeRun(
    businessId: string,
    ruleId: string,
    overrides: { customerId?: string | null; leadId?: string | null } = {},
  ) {
    return createAutomationRun(businessId, {
      automationRuleId: ruleId,
      customerId: overrides.customerId,
      leadId: overrides.leadId,
      dedupeKey: `${ruleId}:${Math.random()}`,
      scheduledFor: new Date(),
    });
  }

  it("1. an authenticated business can list its own runs", async () => {
    const { token, businessId, rule } = await setupBusinessWithRule("history-1@example.com");
    await makeRun(businessId, rule.id);

    const response = await app.inject({ method: "GET", url: "/automation/runs", headers: authHeader(token) });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);
  });

  it("2. an unauthenticated request is rejected", async () => {
    const response = await app.inject({ method: "GET", url: "/automation/runs" });

    expect(response.statusCode).toBe(401);
  });

  it("3. Business A cannot see Business B's runs", async () => {
    const a = await setupBusinessWithRule("history-3a@example.com");
    const b = await setupBusinessWithRule("history-3b@example.com");
    await makeRun(b.businessId, b.rule.id);

    const response = await app.inject({ method: "GET", url: "/automation/runs", headers: authHeader(a.token) });

    expect(response.json().items).toHaveLength(0);
  });

  it("4. pagination returns the requested page", async () => {
    const { token, businessId, rule } = await setupBusinessWithRule("history-4@example.com");
    for (let index = 0; index < 5; index += 1) await makeRun(businessId, rule.id);

    const page1 = await app.inject({ method: "GET", url: "/automation/runs?page=1&pageSize=2", headers: authHeader(token) });
    const page2 = await app.inject({ method: "GET", url: "/automation/runs?page=2&pageSize=2", headers: authHeader(token) });

    expect(page1.json().items).toHaveLength(2);
    expect(page2.json().items).toHaveLength(2);
    expect(page1.json().items[0].id).not.toBe(page2.json().items[0].id);
  });

  it("5. total reflects the full row count regardless of page size", async () => {
    const { token, businessId, rule } = await setupBusinessWithRule("history-5@example.com");
    for (let index = 0; index < 5; index += 1) await makeRun(businessId, rule.id);

    const response = await app.inject({ method: "GET", url: "/automation/runs?pageSize=2", headers: authHeader(token) });

    expect(response.json().total).toBe(5);
    expect(response.json().page).toBe(1);
    expect(response.json().pageSize).toBe(2);
  });

  it("6. ordering is deterministic (createdAt DESC)", async () => {
    const { token, businessId, rule } = await setupBusinessWithRule("history-6@example.com");
    const first = await makeRun(businessId, rule.id);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await makeRun(businessId, rule.id);

    const response = await app.inject({ method: "GET", url: "/automation/runs", headers: authHeader(token) });

    expect(response.json().items.map((item: { id: string }) => item.id)).toEqual([second.id, first.id]);
  });

  it("7. a PENDING run is returned with status PENDING and no reason", async () => {
    const { token, businessId, rule } = await setupBusinessWithRule("history-7@example.com");
    await makeRun(businessId, rule.id);

    const response = await app.inject({ method: "GET", url: "/automation/runs", headers: authHeader(token) });

    expect(response.json().items[0].status).toBe("PENDING");
    expect(response.json().items[0].reason).toBeNull();
  });

  it("8. a RUNNING run is returned with status RUNNING and no reason", async () => {
    const { token, businessId, rule } = await setupBusinessWithRule("history-8@example.com");
    const run = await makeRun(businessId, rule.id);
    await prisma.automationRun.update({ where: { id: run.id }, data: { status: "RUNNING", startedAt: new Date() } });

    const response = await app.inject({ method: "GET", url: "/automation/runs", headers: authHeader(token) });

    expect(response.json().items[0].status).toBe("RUNNING");
    expect(response.json().items[0].reason).toBeNull();
  });

  it("9. a COMPLETED run is returned with status COMPLETED and no reason", async () => {
    const { token, businessId, rule } = await setupBusinessWithRule("history-9@example.com");
    const run = await makeRun(businessId, rule.id);
    await prisma.automationRun.update({ where: { id: run.id }, data: { status: "COMPLETED", completedAt: new Date() } });

    const response = await app.inject({ method: "GET", url: "/automation/runs", headers: authHeader(token) });

    expect(response.json().items[0].status).toBe("COMPLETED");
    expect(response.json().items[0].reason).toBeNull();
  });

  it("10. a FAILED run maps a known executor error message to a safe SEND_FAILED reason", async () => {
    const { token, businessId, rule } = await setupBusinessWithRule("history-10@example.com");
    const run = await makeRun(businessId, rule.id);
    await prisma.automationRun.update({
      where: { id: run.id },
      data: { status: "FAILED", completedAt: new Date(), errorMessage: "Max attempts reached: 30003" },
    });

    const response = await app.inject({ method: "GET", url: "/automation/runs?status=FAILED", headers: authHeader(token) });

    expect(response.json().items[0].status).toBe("FAILED");
    expect(response.json().items[0].reason).toBe("SEND_FAILED");
    expect(JSON.stringify(response.json())).not.toContain("30003");
  });

  it("11a. a CANCELLED run maps invalid-phone/opt-out/subscription/rule-disabled reasons safely", async () => {
    const { token, businessId, rule } = await setupBusinessWithRule("history-11a@example.com");
    const reasons: Array<[string, string]> = [
      ["Customer has no valid E.164 phone number", "INVALID_PHONE"],
      ["Customer has opted out of SMS", "CUSTOMER_OPTED_OUT"],
      ["Business is no longer entitled to automation", "SUBSCRIPTION_INACTIVE"],
      ["Automation rule no longer exists or is disabled", "RULE_DISABLED"],
      ["Lead has already been actioned (status: contacted)", "LEAD_ALREADY_CONTACTED"],
    ];

    for (const [errorMessage] of reasons) {
      const run = await makeRun(businessId, rule.id);
      await prisma.automationRun.update({
        where: { id: run.id },
        data: { status: "CANCELLED", cancelledAt: new Date(), errorMessage },
      });
    }

    const response = await app.inject({ method: "GET", url: "/automation/runs?status=CANCELLED&pageSize=10", headers: authHeader(token) });
    const returnedReasons = response.json().items.map((item: { reason: string }) => item.reason).sort();

    expect(returnedReasons).toEqual(reasons.map(([, safe]) => safe).sort());
  });

  it("11b. an unrecognized CANCELLED reason falls back to UNKNOWN, never raw text", async () => {
    const { token, businessId, rule } = await setupBusinessWithRule("history-11b@example.com");
    const run = await makeRun(businessId, rule.id);
    await prisma.automationRun.update({
      where: { id: run.id },
      data: { status: "CANCELLED", cancelledAt: new Date(), errorMessage: null },
    });

    const response = await app.inject({ method: "GET", url: "/automation/runs?status=CANCELLED", headers: authHeader(token) });

    expect(response.json().items[0].status).toBe("CANCELLED");
    expect(response.json().items[0].reason).toBe("UNKNOWN");
  });

  it("12. customer context is sanitized to id and name only", async () => {
    const { token, businessId, rule } = await setupBusinessWithRule("history-12@example.com");
    const customer = await prisma.customer.create({
      data: { businessId, name: "Sarah", phone: "+15551234567", email: "sarah@example.com" },
    });
    await makeRun(businessId, rule.id, { customerId: customer.id });

    const response = await app.inject({ method: "GET", url: "/automation/runs", headers: authHeader(token) });
    const item = response.json().items[0];

    expect(item.customer).toEqual({ id: customer.id, name: "Sarah" });
    expect(JSON.stringify(item)).not.toContain("+15551234567");
    expect(JSON.stringify(item)).not.toContain("sarah@example.com");
  });

  it("13. lead context is sanitized to id, serviceRequested, and status only", async () => {
    const { token, businessId, rule } = await setupBusinessWithRule("history-13@example.com");
    const lead = await prisma.lead.create({
      data: { businessId, serviceRequested: "Haircut", notes: "Private note", estimatedValue: "150.00" },
    });
    await makeRun(businessId, rule.id, { leadId: lead.id });

    const response = await app.inject({ method: "GET", url: "/automation/runs", headers: authHeader(token) });
    const item = response.json().items[0];

    expect(item.lead).toEqual({ id: lead.id, serviceRequested: "Haircut", status: "new" });
    expect(JSON.stringify(item)).not.toContain("Private note");
    expect(JSON.stringify(item)).not.toContain("150");
  });

  it("14. internal businessId is never exposed", async () => {
    const { token, businessId, rule } = await setupBusinessWithRule("history-14@example.com");
    await makeRun(businessId, rule.id);

    const response = await app.inject({ method: "GET", url: "/automation/runs", headers: authHeader(token) });

    expect(JSON.stringify(response.json())).not.toMatch(/businessId/i);
  });

  it("15. dedupeKey is never exposed", async () => {
    const { token, businessId, rule } = await setupBusinessWithRule("history-15@example.com");
    await makeRun(businessId, rule.id);

    const response = await app.inject({ method: "GET", url: "/automation/runs", headers: authHeader(token) });

    expect(JSON.stringify(response.json())).not.toMatch(/dedupeKey/i);
  });

  it("16. leaseExpiresAt is never exposed", async () => {
    const { token, businessId, rule } = await setupBusinessWithRule("history-16@example.com");
    const run = await makeRun(businessId, rule.id);
    await prisma.automationRun.update({ where: { id: run.id }, data: { status: "RUNNING", leaseExpiresAt: new Date(Date.now() + 300000) } });

    const response = await app.inject({ method: "GET", url: "/automation/runs", headers: authHeader(token) });

    expect(JSON.stringify(response.json())).not.toMatch(/leaseExpiresAt/i);
  });

  it("17. raw errorMessage text is never exposed", async () => {
    const { token, businessId, rule } = await setupBusinessWithRule("history-17@example.com");
    const run = await makeRun(businessId, rule.id);
    await prisma.automationRun.update({
      where: { id: run.id },
      data: { status: "FAILED", completedAt: new Date(), errorMessage: "Twilio error 21211: invalid destination number" },
    });

    const response = await app.inject({ method: "GET", url: "/automation/runs", headers: authHeader(token) });

    expect(JSON.stringify(response.json())).not.toContain("Twilio");
    expect(JSON.stringify(response.json())).not.toContain("21211");
    expect(JSON.stringify(response.json())).not.toMatch(/errorMessage/i);
  });

  it("18. history remains visible after the rule is disabled", async () => {
    const { token, businessId, rule } = await setupBusinessWithRule("history-18@example.com");
    await makeRun(businessId, rule.id);
    await setAutomationRuleEnabled(businessId, "PRO", "ACTIVE", rule.id, false);

    const response = await app.inject({ method: "GET", url: "/automation/runs", headers: authHeader(token) });

    expect(response.json().items).toHaveLength(1);
  });

  it("19. history remains visible after the subscription expires", async () => {
    const { token, businessId, rule } = await setupBusinessWithRule("history-19@example.com");
    await makeRun(businessId, rule.id);
    await setSubscriptionStatus(businessId, "EXPIRED");

    const response = await app.inject({ method: "GET", url: "/automation/runs", headers: authHeader(token) });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);
  });

  it("20. a business with no runs gets a clean empty envelope", async () => {
    const { token } = await registerAccount(app, { email: "history-20@example.com" });

    const response = await app.inject({ method: "GET", url: "/automation/runs", headers: authHeader(token) });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [], total: 0, page: 1, pageSize: 25 });
  });
});
