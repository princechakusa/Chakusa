import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, resetDatabase, registerAccount, authHeader } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

describe("customers", () => {
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

  it("creates a customer scoped to the caller's business", async () => {
    const { token, businessId } = await registerAccount(app);

    const response = await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(token),
      payload: { name: "Jane Doe", phone: "555-1234" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().businessId).toBe(businessId);
  });

  it("computes lifetime value from won leads only", async () => {
    const { token } = await registerAccount(app);

    const customer = await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(token),
      payload: { name: "Big Spender" },
    });
    const customerId = customer.json().id;

    const wonLead = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: { customerId, estimatedValue: 150 },
    });
    await app.inject({
      method: "POST",
      url: `/leads/${wonLead.json().id}/mark-won`,
      headers: authHeader(token),
    });

    const lostLead = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: { customerId, estimatedValue: 999 },
    });
    await app.inject({
      method: "POST",
      url: `/leads/${lostLead.json().id}/mark-lost`,
      headers: authHeader(token),
    });

    const profile = await app.inject({
      method: "GET",
      url: `/customers/${customerId}`,
      headers: authHeader(token),
    });

    expect(profile.json().lifetimeValue).toBe(150);
    expect(typeof profile.json().lifetimeValue).toBe("number");

    for (const lead of profile.json().leads) {
      expect(typeof lead.estimatedValue).toBe("number");
    }
  });

  it("records CUSTOMER_UPDATED activity when a customer is updated", async () => {
    const { token } = await registerAccount(app);

    const created = await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(token),
      payload: { name: "Original Name" },
    });
    const customerId = created.json().id;

    const updated = await app.inject({
      method: "PATCH",
      url: `/customers/${customerId}`,
      headers: authHeader(token),
      payload: { name: "Updated Name" },
    });
    expect(updated.json().name).toBe("Updated Name");

    const events = await prisma.activityEvent.findMany({
      where: { entityType: "customer", entityId: customerId },
      orderBy: { createdAt: "asc" },
    });

    expect(events.map((e) => e.eventType)).toEqual(["CUSTOMER_CREATED", "CUSTOMER_UPDATED"]);
  });

  it("returns 404 for a nonexistent customer", async () => {
    const { token } = await registerAccount(app);

    const response = await app.inject({
      method: "GET",
      url: "/customers/00000000-0000-0000-0000-000000000000",
      headers: authHeader(token),
    });

    expect(response.statusCode).toBe(404);
  });
});
