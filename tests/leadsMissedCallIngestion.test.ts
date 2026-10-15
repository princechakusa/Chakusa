import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, resetDatabase, registerAccount, authHeader, setPlan, setSubscriptionStatus } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { LEAD_SOURCE_MISSED_CALL, supportsLeadCreatedAutomation } from "../src/lib/leadSources.js";
import { createAutomationRule } from "../src/modules/automation/automation.service.js";

describe("missed-call ingestion (POST /leads/missed-call)", () => {
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

  it("1. creates a lead and a new customer from just a phone number", async () => {
    const { token, businessId } = await registerAccount(app);

    const response = await app.inject({
      method: "POST",
      url: "/leads/missed-call",
      headers: authHeader(token),
      payload: { phone: "+263771234567", occurredAt: new Date().toISOString(), clientEventId: "call-1" },
    });

    expect(response.statusCode).toBe(201);
    const lead = response.json();
    expect(lead.source).toBe(LEAD_SOURCE_MISSED_CALL);
    expect(lead.status).toBe("new");
    expect(lead.customerId).toBeTruthy();

    const customers = await prisma.customer.findMany({ where: { businessId } });
    expect(customers).toHaveLength(1);
    expect(customers[0]!.phoneE164).toBe("+263771234567");
  });

  it("2. replaying the same clientEventId returns the same lead, never a second one", async () => {
    const { token, businessId } = await registerAccount(app);
    const payload = { phone: "+263771234567", occurredAt: new Date().toISOString(), clientEventId: "call-retry-1" };

    const first = await app.inject({ method: "POST", url: "/leads/missed-call", headers: authHeader(token), payload });
    const second = await app.inject({ method: "POST", url: "/leads/missed-call", headers: authHeader(token), payload });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json().id).toBe(first.json().id);

    const leads = await prisma.lead.findMany({ where: { businessId } });
    expect(leads).toHaveLength(1);
  });

  it("3. a repeat call while the first lead is still untouched joins that lead (one customer, one lead)", async () => {
    const { token, businessId } = await registerAccount(app);

    await app.inject({
      method: "POST",
      url: "/leads/missed-call",
      headers: authHeader(token),
      payload: { phone: "+263771234567", occurredAt: new Date().toISOString(), clientEventId: "call-a" },
    });
    await app.inject({
      method: "POST",
      url: "/leads/missed-call",
      headers: authHeader(token),
      payload: { phone: "+263771234567", occurredAt: new Date().toISOString(), clientEventId: "call-b" },
    });

    const customers = await prisma.customer.findMany({ where: { businessId } });
    expect(customers).toHaveLength(1);
    const leads = await prisma.lead.findMany({ where: { businessId } });
    expect(leads).toHaveLength(1);
    expect(leads[0]!.customerId).toBe(customers[0]!.id);
  });

  it("4. a differently-formatted number from the same caller still resolves to one customer", async () => {
    const { token, businessId } = await registerAccount(app);
    // Business country defaults to ZW at registration in this test suite's
    // fixtures — a bare local number and its E.164 form must resolve to the
    // same customer, matching how manual entry's phone normalization works.
    await prisma.business.update({ where: { id: businessId }, data: { country: "ZW" } });

    await app.inject({
      method: "POST",
      url: "/leads/missed-call",
      headers: authHeader(token),
      payload: { phone: "0771234567", occurredAt: new Date().toISOString(), clientEventId: "call-local" },
    });
    await app.inject({
      method: "POST",
      url: "/leads/missed-call",
      headers: authHeader(token),
      payload: { phone: "+263771234567", occurredAt: new Date().toISOString(), clientEventId: "call-e164" },
    });

    const customers = await prisma.customer.findMany({ where: { businessId } });
    expect(customers).toHaveLength(1);
  });

  it("5. schedules the missed-call SMS automation exactly like a manually-created missed-call lead", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    await setSubscriptionStatus(businessId, "ACTIVE");
    const rule = await createAutomationRule(businessId, "PRO", "ACTIVE", {
      name: "Recovery",
      enabled: true,
      triggerType: "LEAD_CREATED",
      channel: "SMS",
      delaySeconds: 60,
      config: {},
    });

    const response = await app.inject({
      method: "POST",
      url: "/leads/missed-call",
      headers: authHeader(token),
      payload: { phone: "+263771234567", occurredAt: new Date().toISOString(), clientEventId: "call-automated" },
    });

    const leadId = response.json().id;
    const runs = await prisma.automationRun.findMany({ where: { businessId, leadId } });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.automationRuleId).toBe(rule.id);
    expect(runs[0]!.status).toBe("PENDING");

    // The lead detail shows the owner the follow-up's state and channel.
    const detail = await app.inject({ method: "GET", url: `/leads/${leadId}`, headers: authHeader(token) });
    expect(detail.json().automationRuns).toEqual([expect.objectContaining({ id: runs[0]!.id, status: "PENDING", automationRule: { channel: "SMS" } })]);
  });

  it("3b. once the first lead has been actioned, a new call opens a new lead", async () => {
    const { token, businessId } = await registerAccount(app);
    const call = (clientEventId: string) => app.inject({ method: "POST", url: "/leads/missed-call", headers: authHeader(token), payload: { phone: "+263771234567", occurredAt: new Date().toISOString(), clientEventId } });

    const first = await call("call-x");
    await prisma.lead.update({ where: { id: first.json().id }, data: { status: "contacted" } });
    const second = await call("call-y");

    expect(second.json().id).not.toBe(first.json().id);
    expect(await prisma.lead.count({ where: { businessId } })).toBe(2);
  });

  it("5b. both SMS and WhatsApp rules each send one follow-up, and a repeat call adds none", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    await setSubscriptionStatus(businessId, "ACTIVE");
    const sms = await createAutomationRule(businessId, "PRO", "ACTIVE", { name: "SMS", enabled: true, triggerType: "LEAD_CREATED", channel: "SMS", delaySeconds: 0, config: {} });
    const whatsapp = await createAutomationRule(businessId, "PRO", "ACTIVE", { name: "WhatsApp", enabled: true, triggerType: "LEAD_CREATED", channel: "WHATSAPP", delaySeconds: 0, config: {} });

    for (const clientEventId of ["call-1", "call-2"]) {
      await app.inject({ method: "POST", url: "/leads/missed-call", headers: authHeader(token), payload: { phone: "+263771234567", occurredAt: new Date().toISOString(), clientEventId } });
    }

    const runs = await prisma.automationRun.findMany({ where: { businessId } });
    expect(runs.map((run) => run.automationRuleId).sort()).toEqual([sms.id, whatsapp.id].sort());
  });

  it("5c. a repeat call to a lead that predates the automation gets its follow-up then, once", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    await setSubscriptionStatus(businessId, "ACTIVE");
    const call = (clientEventId: string) => app.inject({ method: "POST", url: "/leads/missed-call", headers: authHeader(token), payload: { phone: "+263771234567", occurredAt: new Date().toISOString(), clientEventId } });

    await call("before-automation");
    expect(await prisma.automationRun.count({ where: { businessId } })).toBe(0);
    const rule = await createAutomationRule(businessId, "PRO", "ACTIVE", { name: "WhatsApp", enabled: true, triggerType: "LEAD_CREATED", channel: "WHATSAPP", delaySeconds: 0, config: {} });
    await call("after-automation-1");
    await call("after-automation-2");

    const runs = await prisma.automationRun.findMany({ where: { businessId } });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.automationRuleId).toBe(rule.id);
    expect(await prisma.lead.count({ where: { businessId } })).toBe(1);
  });

  it("6. rejects a missing phone or clientEventId with a validation error", async () => {
    const { token } = await registerAccount(app);

    const response = await app.inject({
      method: "POST",
      url: "/leads/missed-call",
      headers: authHeader(token),
      payload: { occurredAt: new Date().toISOString() },
    });

    expect(response.statusCode).toBe(400);
  });

  it("7. one business's missed-call report can never attach to another business's data", async () => {
    const businessA = await registerAccount(app, { email: "ingest-a@example.com" });
    const businessB = await registerAccount(app, { email: "ingest-b@example.com" });

    await app.inject({
      method: "POST",
      url: "/leads/missed-call",
      headers: authHeader(businessA.token),
      payload: { phone: "+263771234567", occurredAt: new Date().toISOString(), clientEventId: "shared-id" },
    });
    const second = await app.inject({
      method: "POST",
      url: "/leads/missed-call",
      headers: authHeader(businessB.token),
      payload: { phone: "+263771234567", occurredAt: new Date().toISOString(), clientEventId: "shared-id" },
    });

    // The (businessId, clientEventId) uniqueness is scoped per business —
    // an identical clientEventId from a different business's connector must
    // still create its own lead, not collide with business A's.
    expect(second.statusCode).toBe(201);
    const leadsA = await prisma.lead.findMany({ where: { businessId: businessA.businessId } });
    const leadsB = await prisma.lead.findMany({ where: { businessId: businessB.businessId } });
    expect(leadsA).toHaveLength(1);
    expect(leadsB).toHaveLength(1);
    expect(leadsA[0]!.id).not.toBe(leadsB[0]!.id);
  });
});

describe("supportsLeadCreatedAutomation", () => {
  it("allows only the missed-call source", () => {
    expect(supportsLeadCreatedAutomation(LEAD_SOURCE_MISSED_CALL)).toBe(true);
    expect(supportsLeadCreatedAutomation("referral")).toBe(false);
    expect(supportsLeadCreatedAutomation("walk_in")).toBe(false);
    expect(supportsLeadCreatedAutomation(null)).toBe(false);
    expect(supportsLeadCreatedAutomation(undefined)).toBe(false);
  });
});
