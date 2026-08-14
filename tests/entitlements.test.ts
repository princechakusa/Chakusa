import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, resetDatabase, registerAccount, authHeader, setPlan } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { ApiError } from "../src/lib/errors.js";
import { hasFeature, assertFeatureAvailable, startOfNextUtcMonth } from "../src/lib/entitlements.js";

describe("entitlements", () => {
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
  // Subscription creation
  // ---------------------------------------------------------------------

  it("1. gives a new Business a FREE subscription", async () => {
    const { businessId } = await registerAccount(app);

    const subscription = await prisma.subscription.findUnique({ where: { businessId } });
    expect(subscription).not.toBeNull();
    expect(subscription?.plan).toBe("FREE");
    expect(subscription?.status).toBe("ACTIVE");
  });

  // ---------------------------------------------------------------------
  // Plan resolution from tenant context
  // ---------------------------------------------------------------------

  it("2. resolves FREE plan correctly from tenant context", async () => {
    const { token, businessId } = await registerAccount(app);
    await seedLeads(businessId, 40);

    const response = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: {},
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.details.plan).toBe("FREE");
  });

  it("3. resolves PRO plan correctly from tenant context", async () => {
    const { token, businessId } = await registerAccount(app);
    await seedLeads(businessId, 40);
    await setPlan(businessId, "PRO");

    const response = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: {},
    });

    expect(response.statusCode).toBe(201);
  });

  // ---------------------------------------------------------------------
  // Feature entitlement
  // ---------------------------------------------------------------------

  it("4. denies AUTOMATION on FREE", () => {
    expect(hasFeature("FREE", "ACTIVE", "AUTOMATION")).toBe(false);
    expect(() => assertFeatureAvailable("FREE", "ACTIVE", "AUTOMATION")).toThrow(ApiError);
  });

  it("5. allows AUTOMATION on PRO", () => {
    expect(hasFeature("PRO", "ACTIVE", "AUTOMATION")).toBe(true);
    expect(() => assertFeatureAvailable("PRO", "ACTIVE", "AUTOMATION")).not.toThrow();
  });

  it("6. denies ADVANCED_ANALYTICS on FREE", () => {
    expect(hasFeature("FREE", "ADVANCED_ANALYTICS")).toBe(false);
    expect(() => assertFeatureAvailable("FREE", "ADVANCED_ANALYTICS")).toThrow(ApiError);
  });

  it("7. allows ADVANCED_ANALYTICS on PRO", () => {
    expect(hasFeature("PRO", "ADVANCED_ANALYTICS")).toBe(true);
    expect(() => assertFeatureAvailable("PRO", "ADVANCED_ANALYTICS")).not.toThrow();
  });

  // Added in Phase 2 (manual Pro SMS) — see src/lib/entitlements.ts for why
  // this is a separate feature from AUTOMATION rather than reusing it.
  it("denies OUTBOUND_MESSAGING on FREE", () => {
    expect(hasFeature("FREE", "ACTIVE", "OUTBOUND_MESSAGING")).toBe(false);
    expect(() => assertFeatureAvailable("FREE", "ACTIVE", "OUTBOUND_MESSAGING")).toThrow(ApiError);
  });

  it("allows OUTBOUND_MESSAGING on PRO", () => {
    expect(hasFeature("PRO", "ACTIVE", "OUTBOUND_MESSAGING")).toBe(true);
    expect(() => assertFeatureAvailable("PRO", "ACTIVE", "OUTBOUND_MESSAGING")).not.toThrow();
  });

  // ---------------------------------------------------------------------
  // Leads limit
  // ---------------------------------------------------------------------

  it("8. allows Free lead creation under the 40/month limit", async () => {
    const { token } = await registerAccount(app);

    for (let i = 0; i < 5; i += 1) {
      const response = await app.inject({ method: "POST", url: "/leads", headers: authHeader(token), payload: {} });
      expect(response.statusCode).toBe(201);
    }
  });

  it("9. allows the 40th lead this month", async () => {
    const { token, businessId } = await registerAccount(app);
    await seedLeads(businessId, 39);

    const response = await app.inject({ method: "POST", url: "/leads", headers: authHeader(token), payload: {} });

    expect(response.statusCode).toBe(201);
    expect(await prisma.lead.count({ where: { businessId } })).toBe(40);
  });

  it("10. rejects the 41st lead this month", async () => {
    const { token, businessId } = await registerAccount(app);
    await seedLeads(businessId, 40);

    const response = await app.inject({ method: "POST", url: "/leads", headers: authHeader(token), payload: {} });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("LIMIT_REACHED");
    expect(await prisma.lead.count({ where: { businessId } })).toBe(40);
  });

  it("11. resets the lead count at the UTC calendar month boundary", async () => {
    const { token, businessId } = await registerAccount(app);
    const lastMonth = previousUtcMonthDate();
    await seedLeads(businessId, 40, lastMonth);

    const response = await app.inject({ method: "POST", url: "/leads", headers: authHeader(token), payload: {} });

    expect(response.statusCode).toBe(201);
  });

  it("12. lets Pro lead creation bypass the limit", async () => {
    const { token, businessId } = await registerAccount(app);
    await seedLeads(businessId, 60);
    await setPlan(businessId, "PRO");

    const response = await app.inject({ method: "POST", url: "/leads", headers: authHeader(token), payload: {} });

    expect(response.statusCode).toBe(201);
  });

  // ---------------------------------------------------------------------
  // Customers limit
  // ---------------------------------------------------------------------

  it("13. allows Free customer creation under the 200 limit", async () => {
    const { token } = await registerAccount(app);

    const response = await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(token),
      payload: { name: "Under limit" },
    });
    expect(response.statusCode).toBe(201);
  });

  it("14. allows the 200th customer", async () => {
    const { token, businessId } = await registerAccount(app);
    await seedCustomers(businessId, 199);

    const response = await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(token),
      payload: { name: "Number 200" },
    });

    expect(response.statusCode).toBe(201);
    expect(await prisma.customer.count({ where: { businessId } })).toBe(200);
  });

  it("15. rejects the 201st customer", async () => {
    const { token, businessId } = await registerAccount(app);
    await seedCustomers(businessId, 200);

    const response = await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(token),
      payload: { name: "Number 201" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("LIMIT_REACHED");
  });

  it("16. lets Pro customer creation bypass the limit", async () => {
    const { token, businessId } = await registerAccount(app);
    await seedCustomers(businessId, 200);
    await setPlan(businessId, "PRO");

    const response = await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(token),
      payload: { name: "Beyond 200" },
    });

    expect(response.statusCode).toBe(201);
  });

  // ---------------------------------------------------------------------
  // Review requests limit
  // ---------------------------------------------------------------------

  it("17. rejects Free review requests beyond the 40/month limit", async () => {
    const { token, businessId } = await registerAccount(app);
    await seedReviewRequests(businessId, 40);

    const response = await app.inject({ method: "POST", url: "/review-requests", headers: authHeader(token), payload: {} });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("LIMIT_REACHED");
  });

  it("18. lets Pro review request creation bypass the limit", async () => {
    const { token, businessId } = await registerAccount(app);
    await seedReviewRequests(businessId, 40);
    await setPlan(businessId, "PRO");

    const response = await app.inject({ method: "POST", url: "/review-requests", headers: authHeader(token), payload: {} });

    expect(response.statusCode).toBe(201);
  });

  // ---------------------------------------------------------------------
  // Reminders limit (standing, not monthly)
  // ---------------------------------------------------------------------

  it("19. allows the 40th open reminder", async () => {
    const { token, businessId } = await registerAccount(app);
    await seedReminders(businessId, 39, "due");

    const response = await app.inject({
      method: "POST",
      url: "/reminders",
      headers: authHeader(token),
      payload: { dueDate: new Date().toISOString() },
    });

    expect(response.statusCode).toBe(201);
  });

  it("20. rejects the 41st open reminder", async () => {
    const { token, businessId } = await registerAccount(app);
    await seedReminders(businessId, 40, "due");

    const response = await app.inject({
      method: "POST",
      url: "/reminders",
      headers: authHeader(token),
      payload: { dueDate: new Date().toISOString() },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("LIMIT_REACHED");
  });

  it("21. does not count completed or dismissed reminders toward the open limit", async () => {
    const { token, businessId } = await registerAccount(app);
    await seedReminders(businessId, 20, "completed");
    await seedReminders(businessId, 20, "dismissed");

    const response = await app.inject({
      method: "POST",
      url: "/reminders",
      headers: authHeader(token),
      payload: { dueDate: new Date().toISOString() },
    });

    expect(response.statusCode).toBe(201);
  });

  it("22. lets Pro reminder creation bypass the open-reminder limit", async () => {
    const { token, businessId } = await registerAccount(app);
    await seedReminders(businessId, 40, "due");
    await setPlan(businessId, "PRO");

    const response = await app.inject({
      method: "POST",
      url: "/reminders",
      headers: authHeader(token),
      payload: { dueDate: new Date().toISOString() },
    });

    expect(response.statusCode).toBe(201);
  });

  // ---------------------------------------------------------------------
  // Templates limit
  // ---------------------------------------------------------------------

  it("23. allows one custom template per type on Free", async () => {
    const { token } = await registerAccount(app);

    const response = await app.inject({
      method: "POST",
      url: "/message-templates",
      headers: authHeader(token),
      payload: { templateType: "missed_call", name: "Custom", body: "Hi {{customer_name}}" },
    });

    expect(response.statusCode).toBe(201);
  });

  it("24. rejects a second custom template of the same type on Free", async () => {
    const { token } = await registerAccount(app);

    await app.inject({
      method: "POST",
      url: "/message-templates",
      headers: authHeader(token),
      payload: { templateType: "missed_call", name: "First", body: "First body" },
    });
    const second = await app.inject({
      method: "POST",
      url: "/message-templates",
      headers: authHeader(token),
      payload: { templateType: "missed_call", name: "Second", body: "Second body" },
    });

    expect(second.statusCode).toBe(403);
    expect(second.json().error.code).toBe("LIMIT_REACHED");
  });

  it("25. a default template row DOES count toward the custom-template limit (P0 quota-bypass fix)", async () => {
    const { token } = await registerAccount(app);

    // Every MessageTemplate row a business creates is a stored custom
    // template regardless of isDefault — the system default
    // (defaultTemplates.ts) never creates a row at all, so isDefault only
    // controls render precedence, not whether the row is "custom." A Free
    // business creating one isDefault:true row has therefore already used
    // its one allowed slot for that type — a second row of any kind for
    // the same type must be rejected. This replaces a prior version of
    // this test that asserted the opposite (the actual P0 bug: isDefault
    // rows were exempt from the count, letting Free repeatedly bypass the
    // limit by always passing isDefault: true).
    const defaultTemplate = await app.inject({
      method: "POST",
      url: "/message-templates",
      headers: authHeader(token),
      payload: { templateType: "missed_call", name: "Default A", body: "Body A", isDefault: true },
    });
    expect(defaultTemplate.statusCode).toBe(201);

    const secondRow = await app.inject({
      method: "POST",
      url: "/message-templates",
      headers: authHeader(token),
      payload: { templateType: "missed_call", name: "Custom", body: "Custom body", isDefault: false },
    });
    expect(secondRow.statusCode).toBe(403);
    expect(secondRow.json().error.code).toBe("LIMIT_REACHED");
  });

  it("26. lets Pro template creation bypass the per-type limit", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");

    await app.inject({
      method: "POST",
      url: "/message-templates",
      headers: authHeader(token),
      payload: { templateType: "missed_call", name: "First", body: "First body" },
    });
    const second = await app.inject({
      method: "POST",
      url: "/message-templates",
      headers: authHeader(token),
      payload: { templateType: "missed_call", name: "Second", body: "Second body" },
    });

    expect(second.statusCode).toBe(201);
  });

  // ---------------------------------------------------------------------
  // Cross-tenant isolation, downgrade safety, client security
  // ---------------------------------------------------------------------

  it("27. does not let Business A's usage affect Business B's limit", async () => {
    const businessA = await registerAccount(app, { email: "usage-a@example.com" });
    const businessB = await registerAccount(app, { email: "usage-b@example.com" });
    await seedLeads(businessA.businessId, 40);

    const responseA = await app.inject({ method: "POST", url: "/leads", headers: authHeader(businessA.token), payload: {} });
    const responseB = await app.inject({ method: "POST", url: "/leads", headers: authHeader(businessB.token), payload: {} });

    expect(responseA.statusCode).toBe(403);
    expect(responseB.statusCode).toBe(201);
  });

  it("28. keeps existing records when a Pro business downgrades to Free", async () => {
    const { businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    await seedLeads(businessId, 60);

    await setPlan(businessId, "FREE");

    expect(await prisma.lead.count({ where: { businessId } })).toBe(60);
  });

  it("29. blocks new creation beyond the Free limit after a downgrade", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    await seedLeads(businessId, 60);
    await setPlan(businessId, "FREE");

    const response = await app.inject({ method: "POST", url: "/leads", headers: authHeader(token), payload: {} });

    expect(response.statusCode).toBe(403);
    expect(await prisma.lead.count({ where: { businessId } })).toBe(60);
  });

  it("30. ignores a client-supplied plan field and cannot change entitlement", async () => {
    const { token, businessId } = await registerAccount(app);
    await seedLeads(businessId, 40);

    const response = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      // A client attempting to smuggle plan upgrade data into the request
      // body — createLeadSchema doesn't declare `plan`, so Zod strips it,
      // and the service only ever reads plan from request.plan (tenant.ts,
      // resolved from the Subscription row), never from the body.
      payload: { plan: "PRO", notes: "trying to upgrade myself" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("LIMIT_REACHED");

    const subscription = await prisma.subscription.findUnique({ where: { businessId } });
    expect(subscription?.plan).toBe("FREE");
  });

  // ---------------------------------------------------------------------
  // Error contract
  // ---------------------------------------------------------------------

  it("31. returns a fully-shaped LIMIT_REACHED error", async () => {
    const { token, businessId } = await registerAccount(app);
    await seedLeads(businessId, 40);

    const response = await app.inject({ method: "POST", url: "/leads", headers: authHeader(token), payload: {} });
    const body = response.json();

    expect(body.error.code).toBe("LIMIT_REACHED");
    expect(body.error.message).toBe("Free plan limit reached for leads");
    expect(body.error.details).toMatchObject({
      resource: "leads",
      limit: 40,
      current: 40,
      plan: "FREE",
      requiredPlan: "PRO",
    });
  });

  it("32. returns a fully-shaped FEATURE_NOT_AVAILABLE error", () => {
    try {
      assertFeatureAvailable("FREE", "ACTIVE", "AUTOMATION");
      throw new Error("expected assertFeatureAvailable to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.statusCode).toBe(403);
      expect(apiError.code).toBe("FEATURE_NOT_AVAILABLE");
      expect(apiError.message).toBe("Automation is available on the Pro plan");
      expect(apiError.details).toMatchObject({ feature: "AUTOMATION", plan: "FREE", requiredPlan: "PRO" });
    }
  });

  it("33. includes periodResetsAt on monthly limits", async () => {
    const { token, businessId } = await registerAccount(app);
    await seedLeads(businessId, 40);

    const response = await app.inject({ method: "POST", url: "/leads", headers: authHeader(token), payload: {} });
    const details = response.json().error.details;

    expect(details.periodResetsAt).toBe(startOfNextUtcMonth().toISOString());
  });

  it("34. omits periodResetsAt on standing limits", async () => {
    const { token, businessId } = await registerAccount(app);
    await seedCustomers(businessId, 200);

    const response = await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(token),
      payload: { name: "Standing limit check" },
    });
    const details = response.json().error.details;

    expect(details.periodResetsAt).toBeUndefined();
  });

  // ---------------------------------------------------------------------
  // Concurrency
  // ---------------------------------------------------------------------

  it("35. allows only one of 10 concurrent requests to create the 40th lead", async () => {
    const { token, businessId } = await registerAccount(app);
    await seedLeads(businessId, 39);

    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        app.inject({ method: "POST", url: "/leads", headers: authHeader(token), payload: {} }),
      ),
    );

    const succeeded = responses.filter((r) => r.statusCode === 201);
    const rejected = responses.filter((r) => r.statusCode === 403);

    expect(succeeded).toHaveLength(1);
    expect(rejected).toHaveLength(9);
    expect(rejected.every((r) => r.json().error.code === "LIMIT_REACHED")).toBe(true);
    expect(await prisma.lead.count({ where: { businessId } })).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// Seed helpers — bulk-insert records directly rather than looping HTTP
// requests, since these tests are about the count-based limit, not about
// exercising the create endpoints themselves (already covered elsewhere).
// ---------------------------------------------------------------------------

async function seedLeads(businessId: string, count: number, createdAt?: Date) {
  await prisma.lead.createMany({
    data: Array.from({ length: count }, () => ({ businessId, ...(createdAt ? { createdAt } : {}) })),
  });
}

async function seedCustomers(businessId: string, count: number) {
  await prisma.customer.createMany({
    data: Array.from({ length: count }, (_, i) => ({ businessId, name: `Seed customer ${i}` })),
  });
}

async function seedReviewRequests(businessId: string, count: number, createdAt?: Date) {
  await prisma.reviewRequest.createMany({
    data: Array.from({ length: count }, () => ({ businessId, ...(createdAt ? { createdAt } : {}) })),
  });
}

async function seedReminders(businessId: string, count: number, status: "due" | "sent" | "completed" | "dismissed") {
  await prisma.reminder.createMany({
    data: Array.from({ length: count }, () => ({ businessId, dueDate: new Date(), status })),
  });
}

function previousUtcMonthDate(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
}
