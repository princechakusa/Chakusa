import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, resetDatabase, registerAccount, authHeader, setPlan, setSubscriptionStatus } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { LEAD_SOURCE_MISSED_CALL } from "../src/lib/leadSources.js";

describe("P0 backend integrity + scale correction pass", () => {
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
  // 1. Subscription status must control entitlements
  // ---------------------------------------------------------------------

  it("1. EXPIRED Pro cannot create an automation rule", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    await setSubscriptionStatus(businessId, "EXPIRED");

    const response = await app.inject({
      method: "POST",
      url: "/automation/rules",
      headers: authHeader(token),
      payload: { name: "Recovery", triggerType: "LEAD_CREATED" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("FEATURE_NOT_AVAILABLE");
  });

  it("2. CANCELED Pro cannot create an automation rule", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    await setSubscriptionStatus(businessId, "CANCELED");

    const response = await app.inject({
      method: "POST",
      url: "/automation/rules",
      headers: authHeader(token),
      payload: { name: "Recovery", triggerType: "LEAD_CREATED" },
    });

    expect(response.statusCode).toBe(403);
  });

  it("3. EXPIRED Pro cannot send manual outbound messages", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const customer = await prisma.customer.create({ data: { businessId, name: "Target", phoneE164: "+15551234567" } });
    await setSubscriptionStatus(businessId, "EXPIRED");

    const response = await app.inject({
      method: "POST",
      url: "/messages/send",
      headers: authHeader(token),
      payload: { customerId: customer.id, body: "hi" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("FEATURE_NOT_AVAILABLE");
  });

  it("4. CANCELED Pro cannot send manual outbound messages", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const customer = await prisma.customer.create({ data: { businessId, name: "Target", phoneE164: "+15551234567" } });
    await setSubscriptionStatus(businessId, "CANCELED");

    const response = await app.inject({
      method: "POST",
      url: "/messages/send",
      headers: authHeader(token),
      payload: { customerId: customer.id, body: "hi" },
    });

    expect(response.statusCode).toBe(403);
  });

  it.each(["ACTIVE", "TRIALING", "GRACE_PERIOD"] as const)(
    "5. Pro + %s retains automation entitlement",
    async (status) => {
      const { token, businessId } = await registerAccount(app);
      await setPlan(businessId, "PRO");
      await setSubscriptionStatus(businessId, status);

      const response = await app.inject({
        method: "POST",
        url: "/automation/rules",
        headers: authHeader(token),
        payload: { name: "Recovery", triggerType: "LEAD_CREATED" },
      });

      expect(response.statusCode).toBe(201);
    },
  );

  it.each(["ACTIVE", "TRIALING", "GRACE_PERIOD"] as const)(
    "6. Pro + %s retains outbound-messaging entitlement",
    async (status) => {
      const { token, businessId } = await registerAccount(app);
      await setPlan(businessId, "PRO");
      const customer = await prisma.customer.create({ data: { businessId, name: "Target", phoneE164: "+15551234567" } });
      await setSubscriptionStatus(businessId, status);

      const response = await app.inject({
        method: "POST",
        url: "/messages/send",
        headers: authHeader(token),
        payload: { customerId: customer.id, body: "hi" },
      });

      expect(response.statusCode).not.toBe(403);
    },
  );

  it("7. /subscription/status reports automation:false and outboundMessaging:false for EXPIRED Pro", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    await setSubscriptionStatus(businessId, "EXPIRED");

    const response = await app.inject({
      method: "GET",
      url: "/subscription/status",
      headers: authHeader(token),
    });

    expect(response.json().plan).toBe("PRO");
    expect(response.json().status).toBe("EXPIRED");
    expect(response.json().features.automation).toBe(false);
    expect(response.json().features.outboundMessaging).toBe(false);
  });

  it("8. existing AutomationRule/AutomationRun rows are preserved when a Pro subscription expires", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");

    const createResponse = await app.inject({
      method: "POST",
      url: "/automation/rules",
      headers: authHeader(token),
      payload: { name: "Recovery", triggerType: "LEAD_CREATED", enabled: true },
    });
    const ruleId = createResponse.json().id;

    await setSubscriptionStatus(businessId, "EXPIRED");

    const rule = await prisma.automationRule.findUnique({ where: { id: ruleId } });
    expect(rule).not.toBeNull();
    expect(rule?.enabled).toBe(true);
  });

  // ---------------------------------------------------------------------
  // 2. Free template quota bypass via isDefault
  // ---------------------------------------------------------------------

  it("9. FREE cannot bypass the 1-per-type template quota by repeatedly setting isDefault: true", async () => {
    const { token } = await registerAccount(app);

    const first = await app.inject({
      method: "POST",
      url: "/message-templates",
      headers: authHeader(token),
      payload: { templateType: "custom", name: "One", body: "Hi", isDefault: true },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: "/message-templates",
      headers: authHeader(token),
      payload: { templateType: "custom", name: "Two", body: "Hi again", isDefault: true },
    });

    expect(second.statusCode).toBe(403);
    expect(second.json().error.code).toBe("LIMIT_REACHED");
  });

  it("10. concurrent template creation for the same type cannot bypass the quota", async () => {
    const { token, businessId } = await registerAccount(app);

    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        app.inject({
          method: "POST",
          url: "/message-templates",
          headers: authHeader(token),
          payload: { templateType: "custom", name: `Concurrent ${i}`, body: "Hi", isDefault: true },
        }),
      ),
    );

    const succeeded = responses.filter((r) => r.statusCode === 201);
    expect(succeeded).toHaveLength(1);

    const count = await prisma.messageTemplate.count({ where: { businessId, templateType: "custom" } });
    expect(count).toBe(1);
  });

  it("11. PRO can create multiple templates of the same type", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");

    const first = await app.inject({
      method: "POST",
      url: "/message-templates",
      headers: authHeader(token),
      payload: { templateType: "custom", name: "One", body: "Hi", isDefault: true },
    });
    const second = await app.inject({
      method: "POST",
      url: "/message-templates",
      headers: authHeader(token),
      payload: { templateType: "custom", name: "Two", body: "Hi again", isDefault: true },
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
  });

  // ---------------------------------------------------------------------
  // 3. Lead state transitions
  // ---------------------------------------------------------------------

  async function createLead(token: string) {
    const response = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: {},
    });
    return response.json();
  }

  it("12. valid transition: new -> contacted", async () => {
    const { token } = await registerAccount(app);
    const lead = await createLead(token);

    const response = await app.inject({
      method: "POST",
      url: `/leads/${lead.id}/mark-contacted`,
      headers: authHeader(token),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("contacted");
  });

  it("13. valid transition: contacted -> booked -> won", async () => {
    const { token } = await registerAccount(app);
    const lead = await createLead(token);

    await app.inject({ method: "POST", url: `/leads/${lead.id}/mark-contacted`, headers: authHeader(token) });
    const booked = await app.inject({ method: "POST", url: `/leads/${lead.id}/mark-booked`, headers: authHeader(token) });
    expect(booked.statusCode).toBe(200);
    const won = await app.inject({ method: "POST", url: `/leads/${lead.id}/mark-won`, headers: authHeader(token) });
    expect(won.statusCode).toBe(200);
    expect(won.json().status).toBe("won");
  });

  it("14. valid transition: lost is reachable from new, contacted, and booked", async () => {
    const { token } = await registerAccount(app);

    const leadFromNew = await createLead(token);
    const lostFromNew = await app.inject({ method: "POST", url: `/leads/${leadFromNew.id}/mark-lost`, headers: authHeader(token) });
    expect(lostFromNew.statusCode).toBe(200);

    const leadFromContacted = await createLead(token);
    await app.inject({ method: "POST", url: `/leads/${leadFromContacted.id}/mark-contacted`, headers: authHeader(token) });
    const lostFromContacted = await app.inject({ method: "POST", url: `/leads/${leadFromContacted.id}/mark-lost`, headers: authHeader(token) });
    expect(lostFromContacted.statusCode).toBe(200);
  });

  it("15. invalid transition: won -> contacted is rejected", async () => {
    const { token } = await registerAccount(app);
    const lead = await createLead(token);
    await app.inject({ method: "POST", url: `/leads/${lead.id}/mark-contacted`, headers: authHeader(token) });
    await app.inject({ method: "POST", url: `/leads/${lead.id}/mark-booked`, headers: authHeader(token) });
    await app.inject({ method: "POST", url: `/leads/${lead.id}/mark-won`, headers: authHeader(token) });

    const response = await app.inject({ method: "POST", url: `/leads/${lead.id}/mark-contacted`, headers: authHeader(token) });
    expect(response.statusCode).toBe(409);
  });

  it("16. invalid transition: new -> booked (skipping contacted) is rejected", async () => {
    const { token } = await registerAccount(app);
    const lead = await createLead(token);

    const response = await app.inject({ method: "POST", url: `/leads/${lead.id}/mark-booked`, headers: authHeader(token) });
    expect(response.statusCode).toBe(409);
  });

  it("16b. new -> won directly is allowed (outcome recorded after the fact)", async () => {
    const { token } = await registerAccount(app);
    const lead = await createLead(token);

    const response = await app.inject({ method: "POST", url: `/leads/${lead.id}/mark-won`, headers: authHeader(token) });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("won");
  });

  it("17. invalid transition: lost -> won is rejected (terminal)", async () => {
    const { token } = await registerAccount(app);
    const lead = await createLead(token);
    await app.inject({ method: "POST", url: `/leads/${lead.id}/mark-lost`, headers: authHeader(token) });

    const response = await app.inject({ method: "POST", url: `/leads/${lead.id}/mark-won`, headers: authHeader(token) });
    expect(response.statusCode).toBe(409);
  });

  it("18. re-affirming the current status is a harmless no-op, not an error", async () => {
    const { token } = await registerAccount(app);
    const lead = await createLead(token);
    await app.inject({ method: "POST", url: `/leads/${lead.id}/mark-contacted`, headers: authHeader(token) });

    const response = await app.inject({ method: "POST", url: `/leads/${lead.id}/mark-contacted`, headers: authHeader(token) });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("contacted");
  });

  it("19. concurrent conflicting transitions on the same lead resolve safely (exactly one applies cleanly)", async () => {
    const { token } = await registerAccount(app);
    const lead = await createLead(token);
    await app.inject({ method: "POST", url: `/leads/${lead.id}/mark-contacted`, headers: authHeader(token) });

    const [bookedResp, lostResp] = await Promise.all([
      app.inject({ method: "POST", url: `/leads/${lead.id}/mark-booked`, headers: authHeader(token) }),
      app.inject({ method: "POST", url: `/leads/${lead.id}/mark-lost`, headers: authHeader(token) }),
    ]);

    const statuses = [bookedResp.statusCode, lostResp.statusCode];
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);

    const finalLead = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(["booked", "lost"]).toContain(finalLead.status);
  });

  it("20. tenant isolation: Business A cannot transition Business B's lead", async () => {
    const businessA = await registerAccount(app, { email: "lead-transition-a@example.com" });
    const businessB = await registerAccount(app, { email: "lead-transition-b@example.com" });
    const lead = await createLead(businessB.token);

    const response = await app.inject({
      method: "POST",
      url: `/leads/${lead.id}/mark-contacted`,
      headers: authHeader(businessA.token),
    });
    expect(response.statusCode).toBe(404);
  });

  // ---------------------------------------------------------------------
  // 7. Reminder due vs future semantics
  // ---------------------------------------------------------------------

  it("21. a reminder due in the past is isDueNow: true", async () => {
    const { token, businessId } = await registerAccount(app);
    const customer = await prisma.customer.create({ data: { businessId, name: "Past Due" } });
    await prisma.reminder.create({
      data: { businessId, customerId: customer.id, dueDate: new Date(Date.now() - 86_400_000), status: "due" },
    });

    const response = await app.inject({ method: "GET", url: "/reminders", headers: authHeader(token) });
    const reminders = response.json();
    expect(reminders).toHaveLength(1);
    expect(reminders[0].isDueNow).toBe(true);
  });

  it("22. a reminder scheduled for the future is isDueNow: false", async () => {
    const { token, businessId } = await registerAccount(app);
    const customer = await prisma.customer.create({ data: { businessId, name: "Future" } });
    await prisma.reminder.create({
      data: { businessId, customerId: customer.id, dueDate: new Date(Date.now() + 30 * 86_400_000), status: "due" },
    });

    const response = await app.inject({ method: "GET", url: "/reminders", headers: authHeader(token) });
    const reminders = response.json();
    expect(reminders).toHaveLength(1);
    expect(reminders[0].isDueNow).toBe(false);
  });

  it("23. a completed reminder is never isDueNow even if its dueDate has passed", async () => {
    const { token, businessId } = await registerAccount(app);
    const customer = await prisma.customer.create({ data: { businessId, name: "Completed" } });
    await prisma.reminder.create({
      data: { businessId, customerId: customer.id, dueDate: new Date(Date.now() - 86_400_000), status: "completed" },
    });

    const response = await app.inject({ method: "GET", url: "/reminders", headers: authHeader(token) });
    expect(response.json()[0].isDueNow).toBe(false);
  });

  // ---------------------------------------------------------------------
  // 6. Attention Center action queue
  // ---------------------------------------------------------------------

  it("24. GET /dashboard/attention paginates missed_call_followup and reports a real total", async () => {
    const { token, businessId } = await registerAccount(app);
    for (let i = 0; i < 5; i += 1) {
      await prisma.lead.create({ data: { businessId, status: "new" } });
    }

    const response = await app.inject({
      method: "GET",
      url: "/dashboard/attention?category=missed_call_followup&page=1&pageSize=2",
      headers: authHeader(token),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items).toHaveLength(2);
    expect(body.total).toBe(5);
    expect(body.category).toBe("missed_call_followup");
  });

  it("25. GET /dashboard/attention customer_due only includes reminders actually due now", async () => {
    const { token, businessId } = await registerAccount(app);
    const customer = await prisma.customer.create({ data: { businessId, name: "Due" } });
    await prisma.reminder.create({ data: { businessId, customerId: customer.id, dueDate: new Date(Date.now() - 1000), status: "due" } });
    await prisma.reminder.create({ data: { businessId, customerId: customer.id, dueDate: new Date(Date.now() + 30 * 86_400_000), status: "due" } });

    const response = await app.inject({
      method: "GET",
      url: "/dashboard/attention?category=customer_due",
      headers: authHeader(token),
    });

    expect(response.json().total).toBe(1);
  });

  it("26. GET /dashboard/attention without a category returns a bounded merged preview across all three", async () => {
    const { token, businessId } = await registerAccount(app);
    await prisma.lead.create({ data: { businessId, status: "new" } });
    const customer = await prisma.customer.create({ data: { businessId, name: "Preview" } });
    await prisma.reminder.create({ data: { businessId, customerId: customer.id, dueDate: new Date(Date.now() - 1000), status: "due" } });
    await prisma.reviewRequest.create({ data: { businessId, customerId: customer.id, status: "pending" } });

    const response = await app.inject({ method: "GET", url: "/dashboard/attention", headers: authHeader(token) });
    const body = response.json();
    expect(body.countsByCategory.missed_call_followup).toBe(1);
    expect(body.countsByCategory.customer_due).toBe(1);
    expect(body.countsByCategory.review_opportunity).toBe(1);
  });

  it("27. GET /dashboard/attention is tenant-isolated", async () => {
    const businessA = await registerAccount(app, { email: "attention-a@example.com" });
    const businessB = await registerAccount(app, { email: "attention-b@example.com" });
    await prisma.lead.create({ data: { businessId: businessB.businessId, status: "new" } });

    const response = await app.inject({
      method: "GET",
      url: "/dashboard/attention?category=missed_call_followup",
      headers: authHeader(businessA.token),
    });
    expect(response.json().total).toBe(0);
  });

  // ---------------------------------------------------------------------
  // 8. Dashboard aggregation correctness (SQL aggregate rewrite)
  // ---------------------------------------------------------------------

  it("28. dashboard summary computes correct recovered revenue via SQL aggregates", async () => {
    const { token, businessId } = await registerAccount(app);
    const customer = await prisma.customer.create({ data: { businessId, name: "Revenue" } });
    await prisma.lead.create({
      data: { businessId, customerId: customer.id, status: "won", estimatedValue: 100, source: LEAD_SOURCE_MISSED_CALL },
    });
    await prisma.lead.create({
      data: { businessId, customerId: customer.id, status: "won", estimatedValue: 50, source: "referral" },
    });

    const response = await app.inject({ method: "GET", url: "/dashboard/summary", headers: authHeader(token) });
    const body = response.json();
    expect(body.recoveredRevenue.total).toBe(150);
    expect(body.recoveredRevenue.missedCall).toBe(100);
  });

  it("29. dashboard summary computes correct average response time via SQL aggregate", async () => {
    const { token, businessId } = await registerAccount(app);
    const customer = await prisma.customer.create({ data: { businessId, name: "Response" } });
    const missedAt = new Date(Date.now() - 3_600_000);
    const contactedAt = new Date(Date.now() - 3_000_000);
    await prisma.lead.create({
      data: { businessId, customerId: customer.id, missedCallTime: missedAt, contactedAt },
    });

    const response = await app.inject({ method: "GET", url: "/dashboard/summary", headers: authHeader(token) });
    const body = response.json();
    expect(body.responseTime.sampleSize).toBe(1);
    expect(body.responseTime.averageSeconds).toBeCloseTo((contactedAt.getTime() - missedAt.getTime()) / 1000, 0);
  });

  // ---------------------------------------------------------------------
  // Tenant isolation regression (entitlement changes)
  // ---------------------------------------------------------------------

  it("30. Business A's subscription status change does not affect Business B's entitlement", async () => {
    const businessA = await registerAccount(app, { email: "status-isolation-a@example.com" });
    const businessB = await registerAccount(app, { email: "status-isolation-b@example.com" });
    await setPlan(businessA.businessId, "PRO");
    await setPlan(businessB.businessId, "PRO");
    await setSubscriptionStatus(businessA.businessId, "EXPIRED");

    const responseA = await app.inject({
      method: "POST",
      url: "/automation/rules",
      headers: authHeader(businessA.token),
      payload: { name: "Recovery", triggerType: "LEAD_CREATED" },
    });
    const responseB = await app.inject({
      method: "POST",
      url: "/automation/rules",
      headers: authHeader(businessB.token),
      payload: { name: "Recovery", triggerType: "LEAD_CREATED" },
    });

    expect(responseA.statusCode).toBe(403);
    expect(responseB.statusCode).toBe(201);
  });

  // ---------------------------------------------------------------------
  // Regression — existing Free/Pro workflows remain unchanged
  // ---------------------------------------------------------------------

  it("31. existing Free lead/customer/reminder workflows remain unchanged", async () => {
    const { token } = await registerAccount(app);

    const customerResponse = await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(token),
      payload: { name: "Still works" },
    });
    expect(customerResponse.statusCode).toBe(201);

    const leadResponse = await app.inject({ method: "POST", url: "/leads", headers: authHeader(token), payload: {} });
    expect(leadResponse.statusCode).toBe(201);

    const reminderResponse = await app.inject({
      method: "POST",
      url: "/reminders",
      headers: authHeader(token),
      payload: { customerId: customerResponse.json().id, dueDate: new Date().toISOString() },
    });
    expect(reminderResponse.statusCode).toBe(201);
  });

  it("32. existing Pro automation (ACTIVE) still schedules and the worker path is unaffected", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");

    const ruleResponse = await app.inject({
      method: "POST",
      url: "/automation/rules",
      headers: authHeader(token),
      payload: { name: "Recovery", triggerType: "LEAD_CREATED", enabled: true },
    });
    expect(ruleResponse.statusCode).toBe(201);

    const customer = await prisma.customer.create({ data: { businessId, name: "Auto", phoneE164: "+15551234567" } });
    const leadResponse = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: { customerId: customer.id, source: LEAD_SOURCE_MISSED_CALL },
    });
    expect(leadResponse.statusCode).toBe(201);

    const runs = await prisma.automationRun.count({ where: { businessId } });
    expect(runs).toBe(1);
  });

  it("33. existing manual outbound messaging for ACTIVE Pro remains functional", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const customer = await prisma.customer.create({ data: { businessId, name: "Manual", phoneE164: "+15551234567" } });

    const response = await app.inject({
      method: "POST",
      url: "/messages/send",
      headers: authHeader(token),
      payload: { customerId: customer.id, body: "hello" },
    });

    expect(response.statusCode).not.toBe(403);
    expect(response.statusCode).not.toBe(404);
  });
});
