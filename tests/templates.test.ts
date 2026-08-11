import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, resetDatabase, registerAccount, authHeader } from "./helpers.js";
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
});
