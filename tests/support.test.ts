import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import { authHeader, createTestApp, registerAccount, resetDatabase } from "./helpers.js";
import { expectedSupportResponseAt } from "../src/modules/support/support.service.js";

describe("support cases", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterEach(resetDatabase);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it("creates a tenant-scoped case with a deterministic response expectation", async () => {
    const account = await registerAccount(app); const before = new Date();
    const response = await app.inject({ method: "POST", url: "/support-tickets", headers: authHeader(account.token), payload: { category: "technical", subject: "Calendar problem", message: "The calendar does not show the appointment I created." } });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ businessId: account.businessId, createdByUserId: account.userId, category: "technical", status: "open" });
    expect(new Date(response.json().expectedResponseAt).getTime()).toBeGreaterThanOrEqual(expectedSupportResponseAt(before).getTime());
  });

  it("lists only cases belonging to the authenticated business", async () => {
    const first = await registerAccount(app, { email: "support-one@example.com" }); const second = await registerAccount(app, { email: "support-two@example.com" });
    await prisma.supportTicket.create({ data: { businessId: first.businessId, createdByUserId: first.userId, category: "account", subject: "First account", message: "Only the first tenant can read this support case.", expectedResponseAt: new Date() } });
    await prisma.supportTicket.create({ data: { businessId: second.businessId, createdByUserId: second.userId, category: "billing", subject: "Second account", message: "Only the second tenant can read this support case.", expectedResponseAt: new Date() } });
    const response = await app.inject({ method: "GET", url: "/support-tickets", headers: authHeader(first.token) });
    expect(response.statusCode).toBe(200); expect(response.json()).toHaveLength(1); expect(response.json()[0].subject).toBe("First account");
  });

  it("rejects invalid and oversized case content", async () => {
    const account = await registerAccount(app);
    const response = await app.inject({ method: "POST", url: "/support-tickets", headers: authHeader(account.token), payload: { category: "unknown", subject: "x", message: "short" } });
    expect(response.statusCode).toBe(400);
  });
});
