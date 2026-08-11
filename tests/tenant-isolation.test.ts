import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, resetDatabase, registerAccount, authHeader } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

describe("tenant isolation", () => {
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

  it("prevents user A from reading user B's business", async () => {
    const userA = await registerAccount(app, { email: "a@example.com" });
    const userB = await registerAccount(app, { email: "b@example.com", businessName: "B Co" });

    const asA = await app.inject({ method: "GET", url: "/business", headers: authHeader(userA.token) });
    const asB = await app.inject({ method: "GET", url: "/business", headers: authHeader(userB.token) });

    expect(asA.json().id).toBe(userA.businessId);
    expect(asB.json().id).toBe(userB.businessId);
    expect(asA.json().id).not.toBe(asB.json().id);
  });

  it("prevents user A from reading user B's customer by ID", async () => {
    const userA = await registerAccount(app, { email: "a2@example.com" });
    const userB = await registerAccount(app, { email: "b2@example.com" });

    const created = await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(userB.token),
      payload: { name: "B's Customer" },
    });
    const customerId = created.json().id;

    const crossAccess = await app.inject({
      method: "GET",
      url: `/customers/${customerId}`,
      headers: authHeader(userA.token),
    });

    expect(crossAccess.statusCode).toBe(404);
    expect(crossAccess.json().error.code).toBe("NOT_FOUND");
  });

  it("prevents user A from updating user B's customer", async () => {
    const userA = await registerAccount(app, { email: "a3@example.com" });
    const userB = await registerAccount(app, { email: "b3@example.com" });

    const created = await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(userB.token),
      payload: { name: "B's Other Customer" },
    });
    const customerId = created.json().id;

    const crossUpdate = await app.inject({
      method: "PATCH",
      url: `/customers/${customerId}`,
      headers: authHeader(userA.token),
      payload: { name: "Hijacked" },
    });

    expect(crossUpdate.statusCode).toBe(404);

    const unchanged = await prisma.customer.findUnique({ where: { id: customerId } });
    expect(unchanged?.name).toBe("B's Other Customer");
  });

  it("scopes the customer list to the caller's business only", async () => {
    const userA = await registerAccount(app, { email: "a4@example.com" });
    const userB = await registerAccount(app, { email: "b4@example.com" });

    await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(userA.token),
      payload: { name: "A's Customer" },
    });
    await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(userB.token),
      payload: { name: "B's Customer" },
    });

    const listAsA = await app.inject({
      method: "GET",
      url: "/customers",
      headers: authHeader(userA.token),
    });

    const names = listAsA.json().items.map((c: { name: string }) => c.name);
    expect(names).toContain("A's Customer");
    expect(names).not.toContain("B's Customer");
  });

  it("prevents user A from accessing user B's lead", async () => {
    const userA = await registerAccount(app, { email: "a5@example.com" });
    const userB = await registerAccount(app, { email: "b5@example.com" });

    const created = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(userB.token),
      payload: { source: "missed_call", serviceRequested: "haircut" },
    });
    const leadId = created.json().id;

    const crossGet = await app.inject({
      method: "GET",
      url: `/leads/${leadId}`,
      headers: authHeader(userA.token),
    });
    expect(crossGet.statusCode).toBe(404);

    const crossTransition = await app.inject({
      method: "POST",
      url: `/leads/${leadId}/mark-won`,
      headers: authHeader(userA.token),
    });
    expect(crossTransition.statusCode).toBe(404);
  });

  it("prevents creating a lead against another business's customer", async () => {
    const userA = await registerAccount(app, { email: "a6@example.com" });
    const userB = await registerAccount(app, { email: "b6@example.com" });

    const bCustomer = await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(userB.token),
      payload: { name: "B's Customer" },
    });

    const response = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(userA.token),
      payload: { customerId: bCustomer.json().id, source: "missed_call" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("prevents user A from reading user B's dashboard data", async () => {
    const userA = await registerAccount(app, { email: "a7@example.com" });
    const userB = await registerAccount(app, { email: "b7@example.com" });

    await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(userB.token),
      payload: { source: "missed_call", estimatedValue: 500 },
    });

    const dashboardA = await app.inject({
      method: "GET",
      url: "/dashboard/summary",
      headers: authHeader(userA.token),
    });

    expect(dashboardA.json().leads.total).toBe(0);
  });
});
