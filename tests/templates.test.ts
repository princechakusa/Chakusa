import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, resetDatabase, registerAccount, authHeader, setPlan } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

describe("message templates", () => {
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

  it("creates a custom template and uses it over the built-in default", async () => {
    const { token } = await registerAccount(app, { businessName: "Sparkle Clean" });

    await app.inject({
      method: "POST",
      url: "/message-templates",
      headers: authHeader(token),
      payload: {
        templateType: "missed_call",
        name: "Custom missed call",
        body: "Yo {{customer_name}}, {{business_name}} here, we missed you!",
        isDefault: true,
      },
    });

    const customer = await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(token),
      payload: { name: "Alex" },
    });

    const lead = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: { customerId: customer.json().id },
    });

    const generated = await app.inject({
      method: "POST",
      url: `/leads/${lead.json().id}/generate-message`,
      headers: authHeader(token),
    });

    expect(generated.json().message).toBe("Yo Alex, Sparkle Clean here, we missed you!");
  });

  it("unsets the previous default when a new default of the same type is created", async () => {
    const { token, businessId } = await registerAccount(app);
    // PRO — this test isolates the isDefault demotion mechanic from the
    // Free per-type quota (a Free business creating two rows of the same
    // type now correctly hits LIMIT_REACHED on the second one, see the
    // P0 template-quota-bypass fix; that interaction is covered by its
    // own tests in entitlements.test.ts/p0-integrity-scale.test.ts).
    await setPlan(businessId, "PRO");

    await app.inject({
      method: "POST",
      url: "/message-templates",
      headers: authHeader(token),
      payload: { templateType: "review_request", name: "First", body: "First body", isDefault: true },
    });

    await app.inject({
      method: "POST",
      url: "/message-templates",
      headers: authHeader(token),
      payload: { templateType: "review_request", name: "Second", body: "Second body", isDefault: true },
    });

    const templates = await prisma.messageTemplate.findMany({
      where: { businessId, templateType: "review_request" },
    });

    const defaults = templates.filter((t) => t.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.name).toBe("Second");
  });

  it("falls back to industry-aware defaults when no template exists", async () => {
    const { token } = await registerAccount(app, { businessName: "Smile Dental" });

    await app.inject({
      method: "PATCH",
      url: "/business",
      headers: authHeader(token),
      payload: { industry: "dentist" },
    });

    const lead = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: {},
    });

    const generated = await app.inject({
      method: "POST",
      url: `/leads/${lead.json().id}/generate-message`,
      headers: authHeader(token),
    });

    expect(generated.json().message).toContain("Smile Dental");
    expect(generated.json().message).toMatch(/checkup|missed your call/i);
  });

  it("deterministically selects the lowest id when isDefault and createdAt are both tied", async () => {
    const { token, businessId } = await registerAccount(app, { businessName: "Tie Breaker Co" });

    // Force a genuine createdAt tie (two API calls would naturally differ
    // by at least a few milliseconds) by inserting both rows directly with
    // the same timestamp — this is the only way to reliably reproduce the
    // tie-break scenario without a flaky sleep-based test.
    const tiedCreatedAt = new Date("2026-01-01T00:00:00.000Z");
    const templateA = await prisma.messageTemplate.create({
      data: {
        businessId,
        templateType: "missed_call",
        name: "Tied A",
        body: "Body A for {{customer_name}}",
        isDefault: false,
        createdAt: tiedCreatedAt,
      },
    });
    const templateB = await prisma.messageTemplate.create({
      data: {
        businessId,
        templateType: "missed_call",
        name: "Tied B",
        body: "Body B for {{customer_name}}",
        isDefault: false,
        createdAt: tiedCreatedAt,
      },
    });

    const expectedWinner = [templateA.id, templateB.id].sort()[0];
    const expectedBody = expectedWinner === templateA.id ? "Body A" : "Body B";

    const lead = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: {},
    });

    // Call generate-message repeatedly — without the id ASC tie-breaker,
    // Postgres/Prisma give no ordering guarantee between two rows with
    // identical isDefault and createdAt, so a flaky implementation could
    // return either template across calls. With the tie-breaker, every
    // call must pick the same one.
    for (let i = 0; i < 5; i += 1) {
      const generated = await app.inject({
        method: "POST",
        url: `/leads/${lead.json().id}/generate-message`,
        headers: authHeader(token),
      });
      expect(generated.json().message).toContain(expectedBody);
    }
  });
});
