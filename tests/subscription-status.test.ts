import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, resetDatabase, registerAccount, authHeader, setPlan, setSubscriptionStatus } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { startOfNextUtcMonth } from "../src/lib/entitlements.js";

async function getStatus(app: FastifyInstance, token: string) {
  const response = await app.inject({
    method: "GET",
    url: "/subscription/status",
    headers: authHeader(token),
  });
  return response;
}

describe("GET /subscription/status", () => {
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

  it("returns deterministic subscription value from real leads and appointments", async () => {
    const { token, businessId, userId } = await registerAccount(app);
    await prisma.lead.create({ data: { businessId, status: "won", estimatedValue: 125, wonAt: new Date() } });
    await prisma.appointment.createMany({ data: [
      { businessId, createdByUserId: userId, serviceName: "Completed", startsAt: new Date(), endsAt: new Date(Date.now() + 3_600_000), status: "COMPLETED", price: 50 },
      { businessId, createdByUserId: userId, serviceName: "Upcoming", startsAt: new Date(Date.now() + 86_400_000), endsAt: new Date(Date.now() + 90_000_000), status: "CONFIRMED", price: 80 },
    ] });
    const response = await getStatus(app, token);
    expect(response.json().value).toEqual({ recoveredRevenueThisMonth: 125, completedAppointmentsThisMonth: 1, scheduledAppointmentValue: 80, customerMessagesSentThisMonth: 0, reviewsReceivedThisMonth: 0 });
  });

  // ---------------------------------------------------------------------
  // Plan / status
  // ---------------------------------------------------------------------

  it("1. FREE business returns FREE", async () => {
    const { token } = await registerAccount(app);
    const response = await getStatus(app, token);
    expect(response.statusCode).toBe(200);
    expect(response.json().plan).toBe("FREE");
  });

  it("2. PRO business returns PRO", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const response = await getStatus(app, token);
    expect(response.json().plan).toBe("PRO");
  });

  it("3. correct subscription status is returned", async () => {
    const { token, businessId } = await registerAccount(app);
    await setSubscriptionStatus(businessId, "GRACE_PERIOD");
    const response = await getStatus(app, token);
    expect(response.json().status).toBe("GRACE_PERIOD");
  });

  // ---------------------------------------------------------------------
  // Feature entitlements
  // ---------------------------------------------------------------------

  it("4. FREE automation entitlement = false", async () => {
    const { token } = await registerAccount(app);
    const response = await getStatus(app, token);
    expect(response.json().features.automation).toBe(false);
  });

  it("5. PRO automation entitlement = true", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const response = await getStatus(app, token);
    expect(response.json().features.automation).toBe(true);
  });

  it("6. FREE outbound messaging entitlement = false", async () => {
    const { token } = await registerAccount(app);
    const response = await getStatus(app, token);
    expect(response.json().features.outboundMessaging).toBe(false);
  });

  it("7. PRO outbound messaging entitlement = true", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const response = await getStatus(app, token);
    expect(response.json().features.outboundMessaging).toBe(true);
  });

  // ---------------------------------------------------------------------
  // PROGRAM 3 LOOP 1: placeholder future-capability entitlements in the
  // same snapshot — no route enforces these yet, but the read-only
  // business-facing display (mobile ProScreen) and any future loop that
  // builds the real feature both read this contract.
  // ---------------------------------------------------------------------

  it("FREE and PRO report all future-capability placeholders as false", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const response = await getStatus(app, token);
    expect(response.json().features).toMatchObject({
      aiReceptionist: false,
      quotesEstimates: false,
      invoicing: false,
      marketplaceDiscovery: false,
      accountingIntegrations: false,
    });
  });

  it("BUSINESS reports all future-capability placeholders as true", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "BUSINESS");
    const response = await getStatus(app, token);
    expect(response.json().features).toMatchObject({
      aiReceptionist: true,
      quotesEstimates: true,
      invoicing: true,
      marketplaceDiscovery: true,
      accountingIntegrations: true,
    });
  });

  // ---------------------------------------------------------------------
  // Leads / review requests (monthly)
  // ---------------------------------------------------------------------

  it("8. lead monthly usage count is correct", async () => {
    const { token, businessId } = await registerAccount(app);
    await prisma.lead.createMany({ data: Array.from({ length: 5 }, () => ({ businessId })) });
    const response = await getStatus(app, token);
    expect(response.json().usage.leads.current).toBe(5);
  });

  it("9. lead reset timestamp is correct", async () => {
    const { token } = await registerAccount(app);
    const response = await getStatus(app, token);
    expect(response.json().usage.leads.resetsAt).toBe(startOfNextUtcMonth().toISOString());
  });

  it("10. review-request monthly usage count is correct", async () => {
    const { token, businessId } = await registerAccount(app);
    await prisma.reviewRequest.createMany({ data: Array.from({ length: 3 }, () => ({ businessId })) });
    const response = await getStatus(app, token);
    expect(response.json().usage.reviewRequests.current).toBe(3);
  });

  it("11. review-request reset timestamp is correct", async () => {
    const { token } = await registerAccount(app);
    const response = await getStatus(app, token);
    expect(response.json().usage.reviewRequests.resetsAt).toBe(startOfNextUtcMonth().toISOString());
  });

  it("does not count leads/review requests from before the current UTC month", async () => {
    const { token, businessId } = await registerAccount(app);
    const lastMonth = new Date(Date.UTC(2020, 0, 1));
    await prisma.lead.create({ data: { businessId, createdAt: lastMonth } });
    await prisma.reviewRequest.create({ data: { businessId, createdAt: lastMonth } });
    const response = await getStatus(app, token);
    expect(response.json().usage.leads.current).toBe(0);
    expect(response.json().usage.reviewRequests.current).toBe(0);
  });

  // ---------------------------------------------------------------------
  // Customers (standing)
  // ---------------------------------------------------------------------

  it("12. customer total usage is correct", async () => {
    const { token, businessId } = await registerAccount(app);
    await prisma.customer.createMany({ data: Array.from({ length: 7 }, (_, i) => ({ businessId, name: `Customer ${i}` })) });
    const response = await getStatus(app, token);
    expect(response.json().usage.customers.current).toBe(7);
    expect(response.json().usage.customers.period).toBeNull();
    expect(response.json().usage.customers.resetsAt).toBeNull();
  });

  // ---------------------------------------------------------------------
  // Open reminders
  // ---------------------------------------------------------------------

  it("13. open reminder count excludes completed", async () => {
    const { token, businessId } = await registerAccount(app);
    await prisma.reminder.create({ data: { businessId, dueDate: new Date(), status: "completed" } });
    const response = await getStatus(app, token);
    expect(response.json().usage.openReminders.current).toBe(0);
  });

  it("14. open reminder count excludes dismissed", async () => {
    const { token, businessId } = await registerAccount(app);
    await prisma.reminder.create({ data: { businessId, dueDate: new Date(), status: "dismissed" } });
    const response = await getStatus(app, token);
    expect(response.json().usage.openReminders.current).toBe(0);
  });

  it("15. open reminder count includes actual open statuses", async () => {
    const { token, businessId } = await registerAccount(app);
    await prisma.reminder.create({ data: { businessId, dueDate: new Date(), status: "due" } });
    await prisma.reminder.create({ data: { businessId, dueDate: new Date(), status: "sent" } });
    const response = await getStatus(app, token);
    expect(response.json().usage.openReminders.current).toBe(2);
  });

  // ---------------------------------------------------------------------
  // Custom templates
  // ---------------------------------------------------------------------

  it("16. template usage counts every stored row for the type, including isDefault rows (P0 quota-bypass fix)", async () => {
    // A system default (defaultTemplates.ts) never creates a database row
    // at all, so any MessageTemplate row — isDefault or not — is a custom
    // row the business created and must count toward usage/limit. This
    // replaces a prior version of this test that asserted isDefault rows
    // were excluded, which was the actual P0 bug (Free could create
    // unlimited "custom" templates by always passing isDefault: true).
    const { token, businessId } = await registerAccount(app);
    await prisma.messageTemplate.create({
      data: { businessId, templateType: "review_request", name: "Default", body: "x", isDefault: true },
    });
    const response = await getStatus(app, token);
    expect(response.json().usage.customTemplates.usageByType.review_request).toBe(1);
  });

  it("17. template usage is calculated per template type", async () => {
    const { token, businessId } = await registerAccount(app);
    await prisma.messageTemplate.create({
      data: { businessId, templateType: "review_request", name: "Custom review", body: "x", isDefault: false },
    });
    await prisma.messageTemplate.create({
      data: { businessId, templateType: "custom", name: "Custom other", body: "x", isDefault: false },
    });
    const response = await getStatus(app, token);
    const usageByType = response.json().usage.customTemplates.usageByType;
    expect(usageByType.review_request).toBe(1);
    expect(usageByType.custom).toBe(1);
    expect(usageByType.missed_call).toBe(0);
  });

  // ---------------------------------------------------------------------
  // FREE limits
  // ---------------------------------------------------------------------

  it("18. FREE limits are returned correctly", async () => {
    const { token } = await registerAccount(app);
    const response = await getStatus(app, token);
    const usage = response.json().usage;
    expect(usage.leads.limit).toBe(40);
    expect(usage.reviewRequests.limit).toBe(40);
    expect(usage.customers.limit).toBe(200);
    expect(usage.openReminders.limit).toBe(40);
    expect(usage.customTemplates.limitPerType).toBe(1);
  });

  // ---------------------------------------------------------------------
  // PRO unlimited representation
  // ---------------------------------------------------------------------

  it("19. PRO lead limit = null", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const response = await getStatus(app, token);
    expect(response.json().usage.leads.limit).toBeNull();
  });

  it("20. PRO review-request limit = null", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const response = await getStatus(app, token);
    expect(response.json().usage.reviewRequests.limit).toBeNull();
  });

  it("21. PRO customer limit = null", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const response = await getStatus(app, token);
    expect(response.json().usage.customers.limit).toBeNull();
  });

  it("22. PRO reminder limit = null", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const response = await getStatus(app, token);
    expect(response.json().usage.openReminders.limit).toBeNull();
  });

  it("23. PRO template access is represented as unlimited", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const response = await getStatus(app, token);
    expect(response.json().usage.customTemplates.limitPerType).toBeNull();
  });

  it("PRO still reports monthly usage counters, not entitlement caps", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    await prisma.lead.createMany({ data: Array.from({ length: 154 }, () => ({ businessId })) });
    const response = await getStatus(app, token);
    expect(response.json().usage.leads.current).toBe(154);
    expect(response.json().usage.leads.limit).toBeNull();
  });

  // ---------------------------------------------------------------------
  // Tenant isolation
  // ---------------------------------------------------------------------

  it("24. Business A usage does not include Business B", async () => {
    const businessA = await registerAccount(app, { email: "status-a@example.com" });
    const businessB = await registerAccount(app, { email: "status-b@example.com" });
    await prisma.lead.createMany({ data: Array.from({ length: 10 }, () => ({ businessId: businessB.businessId })) });

    const response = await getStatus(app, businessA.token);
    expect(response.json().usage.leads.current).toBe(0);
  });

  it("25. Business A cannot read Business B subscription state", async () => {
    const businessA = await registerAccount(app, { email: "status-plan-a@example.com" });
    const businessB = await registerAccount(app, { email: "status-plan-b@example.com" });
    await setPlan(businessB.businessId, "PRO");

    const response = await getStatus(app, businessA.token);
    expect(response.json().plan).toBe("FREE");
  });

  // ---------------------------------------------------------------------
  // Security
  // ---------------------------------------------------------------------

  it("26. unauthenticated request is rejected", async () => {
    const response = await app.inject({ method: "GET", url: "/subscription/status" });
    expect(response.statusCode).toBe(401);
  });

  it("27. client cannot spoof businessId", async () => {
    const { token, businessId: ownBusinessId } = await registerAccount(app);
    const other = await registerAccount(app, { email: "spoof-business@example.com" });
    await setPlan(other.businessId, "PRO");

    const response = await app.inject({
      method: "GET",
      url: `/subscription/status?businessId=${other.businessId}`,
      headers: authHeader(token),
    });
    expect(response.json().plan).toBe("FREE");
    expect(ownBusinessId).not.toBe(other.businessId);
  });

  it("28. client cannot spoof plan", async () => {
    const { token } = await registerAccount(app);
    const response = await app.inject({
      method: "GET",
      url: "/subscription/status?plan=PRO",
      headers: authHeader(token),
    });
    expect(response.json().plan).toBe("FREE");
  });

  it("29. client cannot spoof subscription status", async () => {
    const { token } = await registerAccount(app);
    const response = await app.inject({
      method: "GET",
      url: "/subscription/status?status=CANCELED",
      headers: authHeader(token),
    });
    expect(response.json().status).toBe("ACTIVE");
  });

  it("30. client cannot spoof usage", async () => {
    const { token } = await registerAccount(app);
    const response = await app.inject({
      method: "GET",
      url: "/subscription/status?usage.leads.current=999",
      headers: authHeader(token),
    });
    expect(response.json().usage.leads.current).toBe(0);
  });

  it("exposes only safe billing fields, never raw provider identifiers/payloads", async () => {
    const { token } = await registerAccount(app);
    const response = await getStatus(app, token);
    const body = response.json();
    // provider/currentPeriodEnd/cancelAtPeriodEnd/trialEndsAt are the
    // deliberate safe additions (null/false for a FREE business with no
    // billing history) — see the Billing Phase 1 report's "subscription
    // status changes" section.
    expect(body.provider).toBeNull();
    expect(body.currentPeriodEnd).toBeNull();
    expect(body.cancelAtPeriodEnd).toBe(false);
    expect(body.trialEndsAt).toBeNull();
    expect(body).not.toHaveProperty("originalTransactionId");
    expect(body).not.toHaveProperty("latestTransactionId");
    expect(body).not.toHaveProperty("providerProductId");
    expect(body).not.toHaveProperty("googlePurchaseToken");
    expect(body).not.toHaveProperty("environment");
    expect(JSON.stringify(body)).not.toContain("Twilio");
  });

  // ---------------------------------------------------------------------
  // Consistency with enforcement at the exact Free boundary
  // ---------------------------------------------------------------------

  it("31. response stays consistent with LIMIT_REACHED enforcement at the exact Free boundary", async () => {
    const { token, businessId } = await registerAccount(app);
    await prisma.lead.createMany({ data: Array.from({ length: 40 }, () => ({ businessId })) });

    const statusResponse = await getStatus(app, token);
    expect(statusResponse.json().usage.leads.current).toBe(40);
    expect(statusResponse.json().usage.leads.limit).toBe(40);

    const createResponse = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: {},
    });
    expect(createResponse.statusCode).toBe(403);
    expect(createResponse.json().error.code).toBe("LIMIT_REACHED");
  });

  // ---------------------------------------------------------------------
  // Regression
  // ---------------------------------------------------------------------

  it("32. existing PRO creation still bypasses Free resource limits", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    await prisma.lead.createMany({ data: Array.from({ length: 40 }, () => ({ businessId })) });

    const createResponse = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: {},
    });
    expect(createResponse.statusCode).toBe(201);
  });

  it("33. existing Free manual workflows remain unchanged", async () => {
    const { token } = await registerAccount(app);
    const response = await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(token),
      payload: { name: "Still works" },
    });
    expect(response.statusCode).toBe(201);
  });

  it("34. existing automation entitlement tests remain green (spot check)", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const response = await app.inject({
      method: "POST",
      url: "/automation/rules",
      headers: authHeader(token),
      payload: { name: "Recovery", triggerType: "LEAD_CREATED" },
    });
    expect(response.statusCode).toBe(201);
  });

  it("35. existing outbound-messaging entitlement tests remain green (spot check)", async () => {
    const { token } = await registerAccount(app);
    const customer = await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(token),
      payload: { name: "Target", phone: "+15551234567" },
    });
    const response = await app.inject({
      method: "POST",
      url: "/messages/send",
      headers: authHeader(token),
      payload: { customerId: customer.json().id, body: "hi" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("FEATURE_NOT_AVAILABLE");
  });

  // ---------------------------------------------------------------------
  // Missing-subscription fallback
  // ---------------------------------------------------------------------

  it("falls back to FREE/ACTIVE if the Subscription row is unexpectedly missing", async () => {
    const { token, businessId } = await registerAccount(app);
    await prisma.subscription.delete({ where: { businessId } });

    const response = await getStatus(app, token);
    expect(response.statusCode).toBe(200);
    expect(response.json().plan).toBe("FREE");
    expect(response.json().status).toBe("ACTIVE");
  });
});
