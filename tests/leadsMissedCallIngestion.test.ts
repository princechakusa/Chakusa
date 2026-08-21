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

  it("3. a second call from the same number reuses the existing customer instead of duplicating it", async () => {
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
    expect(leads).toHaveLength(2);
    expect(leads.every((lead) => lead.customerId === customers[0]!.id)).toBe(true);
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
