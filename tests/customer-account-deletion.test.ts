import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import { createTestApp, registerAccount, resetDatabase } from "./helpers.js";

async function registerCustomer(app: FastifyInstance, email: string) {
  const res = await app.inject({ method: "POST", url: "/customer/auth/register", payload: { email, password: "Sturdy-pass-71", fullName: "Dee Leet" } });
  if (res.statusCode !== 201) throw new Error(res.body);
  return res.json() as { accessToken: string; user: { id: string } };
}

describe("customer account deletion (store requirement)", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterEach(async () => { await resetDatabase(); });
  afterAll(async () => { await app.close(); });

  it("permanently deletes the account after the password is confirmed, and ends every session", async () => {
    const customer = await registerCustomer(app, "leaving@example.com");
    const headers = { authorization: `Bearer ${customer.accessToken}` };
    const wrong = await app.inject({ method: "POST", url: "/customer/auth/delete-account", headers, payload: { password: "not-it-at-all" } });
    expect(wrong.statusCode).toBe(401);
    expect(await prisma.user.count({ where: { id: customer.user.id } })).toBe(1);

    const ok = await app.inject({ method: "POST", url: "/customer/auth/delete-account", headers, payload: { password: "Sturdy-pass-71" } });
    expect(ok.statusCode).toBe(204);
    expect(await prisma.user.count({ where: { id: customer.user.id } })).toBe(0);
    const after = await app.inject({ method: "GET", url: "/customer/profile", headers });
    expect(after.statusCode).toBe(401);
  });

  it("requires a customer session and a confirmation", async () => {
    const customer = await registerCustomer(app, "stay@example.com");
    expect((await app.inject({ method: "POST", url: "/customer/auth/delete-account", payload: { password: "Sturdy-pass-71" } })).statusCode).toBe(401);
    const business = await registerAccount(app, { email: "biz@example.com" });
    const crossScope = await app.inject({ method: "POST", url: "/customer/auth/delete-account", headers: { authorization: `Bearer ${business.accessToken}` }, payload: { password: "password123" } });
    expect(crossScope.statusCode).toBe(401);
    const noProof = await app.inject({ method: "POST", url: "/customer/auth/delete-account", headers: { authorization: `Bearer ${customer.accessToken}` }, payload: {} });
    expect(noProof.statusCode).toBe(400);
    expect(await prisma.user.count({ where: { normalizedEmail: { in: ["stay@example.com", "biz@example.com"] } } })).toBe(2);
  });
});
