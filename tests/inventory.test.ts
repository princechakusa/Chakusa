import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import type { BusinessRole } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import { createSession } from "../src/modules/auth/auth.service.js";
import { authHeader, createTestApp, registerAccount, resetDatabase, setPlan, setSubscriptionStatus } from "./helpers.js";
import { deriveBalance, isLowStock, signedDelta } from "../src/lib/inventory/inventory.domain.js";

describe("inventory domain", () => {
  it("derives the signed delta from kind and direction", () => {
    expect(signedDelta("RECEIVE", 10).toString()).toBe("10");
    expect(signedDelta("RESTOCK", 2).toString()).toBe("2");
    expect(signedDelta("CONSUME", 3).toString()).toBe("-3");
    expect(signedDelta("SERVICE_USE", 1).toString()).toBe("-1");
    expect(signedDelta("WASTE", 4).toString()).toBe("-4");
    expect(signedDelta("ADJUST", 5, "increase").toString()).toBe("5");
    expect(signedDelta("CORRECTION", 5, "decrease").toString()).toBe("-5");
    expect(() => signedDelta("ADJUST", 5)).toThrow();
    expect(() => signedDelta("CONSUME", 0)).toThrow();
  });

  it("derives balance as the sum of deltas and flags low stock", () => {
    expect(deriveBalance(["10", "-3", "-2.5"]).toString()).toBe("4.5");
    expect(isLowStock("4.5", "5")).toBe(true);
    expect(isLowStock("6", "5")).toBe(false);
    expect(isLowStock("0", null)).toBe(false);
  });
});

async function memberToken(app: FastifyInstance, businessId: string, role: BusinessRole) {
  const email = `${role.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2)}@ex.com`;
  const user = await prisma.user.create({ data: { email, normalizedEmail: email.toLowerCase(), fullName: `${role}`, passwordHash: null } });
  await prisma.businessMember.create({ data: { businessId, userId: user.id, role, status: "ACTIVE" } });
  const { session } = await createSession(user.id, prisma);
  return app.jwt.sign({ userId: user.id, sessionId: session.id, type: "access" }, { expiresIn: 900 });
}

describe("inventory API", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterEach(resetDatabase);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  async function biz(email = "inv-owner@ex.com") {
    const account = await registerAccount(app, { email });
    await setPlan(account.businessId, "BUSINESS");
    await setSubscriptionStatus(account.businessId, "ACTIVE");
    return account;
  }
  const H = (t: string) => authHeader(t);

  async function newItem(token: string, body: Record<string, unknown> = {}) {
    const res = await app.inject({ method: "POST", url: "/inventory/items", headers: H(token), payload: { name: `Item ${Math.random().toString(36).slice(2)}`, unit: "each", ...body } });
    expect(res.statusCode).toBe(201);
    return res.json();
  }
  const move = (token: string, id: string, payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: `/inventory/items/${id}/movements`, headers: H(token), payload });

  it("tracks stock purely from the movement ledger, with a consistent balanceAfter snapshot", async () => {
    const { token } = await biz();
    const item = await newItem(token, { openingQuantity: 20, lowStockThreshold: 5 });
    expect(item.currentStock).toBe("20.000");

    expect((await move(token, item.id, { kind: "RECEIVE", quantity: 5, reference: "PO-1" })).json().currentStock).toBe("25.000");
    const consume = await move(token, item.id, { kind: "CONSUME", quantity: 21 });
    expect(consume.statusCode).toBe(201);
    expect(consume.json().currentStock).toBe("4.000");
    expect(consume.json().lowStock).toBe(true);

    const detail = (await app.inject({ method: "GET", url: `/inventory/items/${item.id}`, headers: H(token) })).json();
    expect(detail.currentStock).toBe("4.000");
    // balanceAfter of the newest movement equals the derived sum of all deltas.
    const ledger = (await app.inject({ method: "GET", url: `/inventory/items/${item.id}/movements`, headers: H(token) })).json();
    const sum = ledger.reduce((a: number, m: { quantityDelta: string }) => a + Number(m.quantityDelta), 0);
    expect(Number(ledger[0].balanceAfter)).toBeCloseTo(sum, 3);
    expect(ledger).toHaveLength(3); // OPENING, RECEIVE, CONSUME
  });

  it("refuses to drive stock negative unless the item opts in", async () => {
    const { token } = await biz("inv-neg@ex.com");
    const strict = await newItem(token, { openingQuantity: 3 });
    const over = await move(token, strict.id, { kind: "CONSUME", quantity: 5 });
    expect(over.statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: `/inventory/items/${strict.id}`, headers: H(token) })).json().currentStock).toBe("3.000");

    const loose = await newItem(token, { openingQuantity: 3, allowNegative: true });
    const ok = await move(token, loose.id, { kind: "CONSUME", quantity: 5 });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().currentStock).toBe("-2.000");
  });

  it("never rewrites history: a mistake is fixed with a CORRECTION row", async () => {
    const { token } = await biz("inv-correct@ex.com");
    const item = await newItem(token, { openingQuantity: 10 });
    await move(token, item.id, { kind: "CONSUME", quantity: 8, reason: "typo, meant 3" });
    const fix = await move(token, item.id, { kind: "CORRECTION", quantity: 5, direction: "increase", reason: "reverse 5 of the 8" });
    expect(fix.json().currentStock).toBe("7.000");
    const ledger = (await app.inject({ method: "GET", url: `/inventory/items/${item.id}/movements`, headers: H(token) })).json();
    expect(ledger).toHaveLength(3);
    expect(ledger.map((m: { kind: string }) => m.kind).sort()).toEqual(["CONSUME", "CORRECTION", "OPENING"]);
  });

  it("SERVICE_USE must reference an appointment of this business", async () => {
    const { token, businessId } = await biz("inv-svc@ex.com");
    const other = await biz("inv-svc-other@ex.com");
    const item = await newItem(token, { openingQuantity: 10 });
    const customer = await prisma.customer.create({ data: { businessId, name: "Pat" } });
    const appt = await app.inject({ method: "POST", url: "/appointments", headers: H(token), payload: { customerId: customer.id, serviceName: "Cut", startsAt: "2026-09-10T09:00:00.000Z", endsAt: "2026-09-10T10:00:00.000Z" } });
    const foreignAppt = await app.inject({ method: "POST", url: "/appointments", headers: H(other.token), payload: { serviceName: "Cut", startsAt: "2026-09-10T09:00:00.000Z", endsAt: "2026-09-10T10:00:00.000Z" } });

    expect((await move(token, item.id, { kind: "SERVICE_USE", quantity: 2 })).statusCode).toBe(400); // no appointmentId
    expect((await move(token, item.id, { kind: "SERVICE_USE", quantity: 2, appointmentId: foreignAppt.json().id })).statusCode).toBe(400);
    const ok = await move(token, item.id, { kind: "SERVICE_USE", quantity: 2, appointmentId: appt.json().id });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().currentStock).toBe("8.000");
  });

  it("enforces the capability matrix: STAFF records flow, OWNER/ADMIN configure and reconcile", async () => {
    const { token, businessId } = await biz("inv-caps@ex.com");
    const staff = await memberToken(app, businessId, "STAFF");
    const item = await newItem(token, { openingQuantity: 10 });

    // STAFF may record in/out flow
    expect((await move(staff, item.id, { kind: "CONSUME", quantity: 1 })).statusCode).toBe(201);
    // STAFF may NOT reconcile the ledger
    expect((await move(staff, item.id, { kind: "ADJUST", quantity: 1, direction: "increase" })).statusCode).toBe(403);
    // STAFF may NOT create or edit items
    expect((await app.inject({ method: "POST", url: "/inventory/items", headers: H(staff), payload: { name: "X" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "PATCH", url: `/inventory/items/${item.id}`, headers: H(staff), payload: { lowStockThreshold: 2 } })).statusCode).toBe(403);
    // STAFF may read
    expect((await app.inject({ method: "GET", url: "/inventory/items", headers: H(staff) })).statusCode).toBe(200);
  });

  it("is tenant scoped and Business-plan gated", async () => {
    const { token } = await biz("inv-tenant@ex.com");
    const outsider = await biz("inv-tenant-out@ex.com");
    const item = await newItem(token, { openingQuantity: 5 });
    expect((await app.inject({ method: "GET", url: `/inventory/items/${item.id}`, headers: H(outsider.token) })).statusCode).toBe(404);
    expect((await move(outsider.token, item.id, { kind: "CONSUME", quantity: 1 })).statusCode).toBe(404);

    const free = await registerAccount(app, { email: "inv-free@ex.com" }); // FREE plan
    expect((await app.inject({ method: "GET", url: "/inventory/items", headers: H(free.token) })).statusCode).toBe(403);
  });

  it("serializes concurrent consumption so stock never goes negative or loses an update", async () => {
    const { token } = await biz("inv-race@ex.com");
    const item = await newItem(token, { openingQuantity: 5 });
    const results = await Promise.all(Array.from({ length: 12 }, () => move(token, item.id, { kind: "CONSUME", quantity: 1 })));
    const ok = results.filter(r => r.statusCode === 201).length;
    const rejected = results.filter(r => r.statusCode === 400).length;
    expect(ok).toBe(5);
    expect(rejected).toBe(7);

    const rows = await prisma.inventoryMovement.findMany({ where: { itemId: item.id }, select: { quantityDelta: true } });
    const derived = rows.reduce((a, r) => a.plus(r.quantityDelta), new Prisma.Decimal(0));
    expect(derived.toString()).toBe("0");
    expect((await app.inject({ method: "GET", url: `/inventory/items/${item.id}`, headers: H(token) })).json().currentStock).toBe("0.000");
  });

  it("blocks movements on a deactivated item until it is reactivated", async () => {
    const { token } = await biz("inv-inactive@ex.com");
    const item = await newItem(token, { openingQuantity: 4 });
    await app.inject({ method: "PATCH", url: `/inventory/items/${item.id}`, headers: H(token), payload: { active: false } });
    expect((await move(token, item.id, { kind: "CONSUME", quantity: 1 })).statusCode).toBe(409);
    await app.inject({ method: "PATCH", url: `/inventory/items/${item.id}`, headers: H(token), payload: { active: true } });
    expect((await move(token, item.id, { kind: "CONSUME", quantity: 1 })).statusCode).toBe(201);
  });
});
