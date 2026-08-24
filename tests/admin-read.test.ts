import type { AdminRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { config } from "../src/lib/config.js";
import { prisma } from "../src/lib/prisma.js";
import { createTestApp, registerAccount, resetDatabase } from "./helpers.js";

describe("admin read console API", () => {
  let app: FastifyInstance;
  beforeAll(async () => { config.ADMIN_CONSOLE_ENABLED = true; app = await createTestApp(); });
  beforeEach(resetDatabase);
  afterAll(async () => { config.ADMIN_CONSOLE_ENABLED = false; await app.close(); });

  async function adminToken(role: AdminRole = "SUPER_ADMIN") {
    const email = `admin-read-${role.toLowerCase()}-${Date.now()}@example.com`;
    const account = await registerAccount(app, { email, password: "admin-password-123", businessName: `${role} Business` });
    await prisma.adminMembership.create({ data: { userId: account.userId, role } });
    const response = await app.inject({ method: "POST", url: "/admin/auth/login", payload: { email, password: "admin-password-123" } });
    expect(response.statusCode).toBe(200);
    return { token: response.json().accessToken as string, account };
  }

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  it("serves truthful dashboard metrics and explicit unavailable metrics", async () => {
    const { token } = await adminToken("READ_ONLY");
    await registerAccount(app, { businessName: "Second Business" });
    const response = await app.inject({ method: "GET", url: "/admin/dashboard?days=30", headers: auth(token) });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ metrics: { totalBusinesses: 2, totalCustomers: 0, mrr: null, arr: null }, health: { api: "operational", database: "operational" } });
    expect(response.json().unavailable.mrr).toEqual(expect.any(String));
  });

  it("paginates searchable business DTOs without exposing internal provider identifiers", async () => {
    const { token, account } = await adminToken();
    const response = await app.inject({ method: "GET", url: "/admin/businesses?search=SUPER&page=1&pageSize=10", headers: auth(token) });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ total: 1, page: 1, pageSize: 10 });
    expect(response.json().items[0]).toMatchObject({ id: account.businessId, name: "SUPER_ADMIN Business" });
    expect(JSON.stringify(response.json())).not.toContain("providerSubscriptionId");
    expect(JSON.stringify(response.json())).not.toContain("passwordHash");
  });

  it("returns user session metadata but never refresh credentials", async () => {
    const { token, account } = await adminToken();
    const response = await app.inject({ method: "GET", url: `/admin/users/${account.userId}`, headers: auth(token) });
    expect(response.statusCode).toBe(200);
    expect(response.json().authSessions[0]).toMatchObject({ scope: "ADMIN", status: "active" });
    expect(JSON.stringify(response.json())).not.toContain("refreshTokenHash");
    expect(JSON.stringify(response.json())).not.toContain("csrfTokenHash");
  });

  it("enforces section permissions instead of relying on hidden navigation", async () => {
    const { token } = await adminToken("FINANCE");
    const allowed = await app.inject({ method: "GET", url: "/admin/subscriptions", headers: auth(token) });
    const denied = await app.inject({ method: "GET", url: "/admin/communications", headers: auth(token) });
    expect(allowed.statusCode).toBe(200);
    expect(denied.statusCode).toBe(403);
  });

  it("rejects product tokens at every admin read route", async () => {
    const account = await registerAccount(app);
    const response = await app.inject({ method: "GET", url: "/admin/businesses", headers: auth(account.accessToken) });
    expect(response.statusCode).toBe(401);
  });
});
