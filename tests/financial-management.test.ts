import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import { authHeader, createTestApp, registerAccount, resetDatabase, setPlan, setSubscriptionStatus } from "./helpers.js";
import { createSession } from "../src/modules/auth/auth.service.js";
import { configureExpenseReceiptPlatform } from "../src/lib/financial/expenseReceiptPlatform.js";

// A 1x1 PNG, base64.
const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function createExpense(app: FastifyInstance, token: string) {
  const res = await app.inject({
    method: "POST",
    url: "/financial/expenses",
    headers: auth(token),
    payload: { amount: "25.00", currency: "USD", spentAt: "2026-03-10T00:00:00.000Z" },
  });
  return res.json().id as string;
}

// PROGRAM 3 / Financial Management F2: expenses, categories, mileage,
// money-in/out summary. BUSINESS-tier gated, tenant-scoped, exact money.

const auth = authHeader;

async function businessAccount(app: FastifyInstance, plan: "FREE" | "PRO" | "BUSINESS" = "BUSINESS") {
  const account = await registerAccount(app);
  await setPlan(account.businessId, plan);
  if (plan !== "FREE") await setSubscriptionStatus(account.businessId, "ACTIVE");
  return account;
}

async function staffToken(app: FastifyInstance, businessId: string) {
  const email = `staff-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const user = await prisma.user.create({
    data: { email, normalizedEmail: email.toLowerCase(), fullName: "Staff Member", passwordHash: null },
  });
  await prisma.businessMember.create({ data: { businessId, userId: user.id, role: "STAFF", status: "ACTIVE" } });
  const { session } = await createSession(user.id, prisma);
  return app.jwt.sign({ userId: user.id, sessionId: session.id, type: "access" }, { expiresIn: 900 });
}

let app: FastifyInstance;
beforeAll(async () => {
  await resetDatabase();
  app = await createTestApp();
});
afterEach(() => resetDatabase());
afterAll(() => app.close());

describe("entitlement", () => {
  it("blocks Financial Management below BUSINESS", async () => {
    const { token } = await businessAccount(app, "PRO");
    const res = await app.inject({ method: "GET", url: "/financial/expenses", headers: auth(token) });
    expect(res.statusCode).toBe(403);
  });
});

describe("categories", () => {
  it("seeds descriptive defaults on first read", async () => {
    const { token } = await businessAccount(app);
    const res = await app.inject({ method: "GET", url: "/financial/categories", headers: auth(token) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.length).toBeGreaterThanOrEqual(10);
    expect(body.every((c: { isDefault: boolean }) => c.isDefault)).toBe(true);
    expect(body.map((c: { slug: string }) => c.slug)).toContain("supplies");
  });

  it("rejects a duplicate-slug category with 409 and lets STAFF not manage structure", async () => {
    const { token, businessId } = await businessAccount(app);
    const created = await app.inject({
      method: "POST",
      url: "/financial/categories",
      headers: auth(token),
      payload: { name: "Custom Tools" },
    });
    expect(created.statusCode).toBe(201);
    const dup = await app.inject({
      method: "POST",
      url: "/financial/categories",
      headers: auth(token),
      payload: { name: "custom   tools" },
    });
    expect(dup.statusCode).toBe(409);

    const staff = await staffToken(app, businessId);
    const forbidden = await app.inject({
      method: "POST",
      url: "/financial/categories",
      headers: auth(staff),
      payload: { name: "Nope" },
    });
    expect(forbidden.statusCode).toBe(403);
  });
});

describe("expenses", () => {
  it("stores exact money, lists it back, and derives it into the summary", async () => {
    const { token } = await businessAccount(app);
    const create = await app.inject({
      method: "POST",
      url: "/financial/expenses",
      headers: auth(token),
      payload: { amount: "19.99", currency: "usd", spentAt: "2026-03-10T00:00:00.000Z", vendor: "Clipper Co" },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().amount).toBe("19.99");
    expect(create.json().currency).toBe("USD");

    const list = await app.inject({ method: "GET", url: "/financial/expenses", headers: auth(token) });
    expect(list.json().total).toBe(1);

    const summary = await app.inject({
      method: "GET",
      url: "/financial/summary?from=2026-03-01T00:00:00.000Z&to=2026-03-31T23:59:59.000Z",
      headers: auth(token),
    });
    expect(summary.statusCode).toBe(200);
    const usd = summary.json().currencies.find((c: { currency: string }) => c.currency === "USD");
    expect(usd).toMatchObject({ expenses: "19.99", revenue: "0.00", net: "-19.99" });
  });

  it("rejects a non-positive amount and a foreign-tenant category", async () => {
    const { token } = await businessAccount(app);
    const other = await businessAccount(app);
    const otherCategory = await app.inject({
      method: "POST",
      url: "/financial/categories",
      headers: auth(other.token),
      payload: { name: "Their Bucket" },
    });
    const foreignCategoryId = otherCategory.json().id;

    const negative = await app.inject({
      method: "POST",
      url: "/financial/expenses",
      headers: auth(token),
      payload: { amount: "-5.00", currency: "USD", spentAt: "2026-03-10T00:00:00.000Z" },
    });
    expect(negative.statusCode).toBe(400);

    const crossTenant = await app.inject({
      method: "POST",
      url: "/financial/expenses",
      headers: auth(token),
      payload: { amount: "5.00", currency: "USD", spentAt: "2026-03-10T00:00:00.000Z", categoryId: foreignCategoryId },
    });
    expect(crossTenant.statusCode).toBe(400);
  });

  it("soft-deletes: a removed expense leaves the list and the summary", async () => {
    const { token } = await businessAccount(app);
    const created = await app.inject({
      method: "POST",
      url: "/financial/expenses",
      headers: auth(token),
      payload: { amount: "40.00", currency: "USD", spentAt: "2026-03-10T00:00:00.000Z" },
    });
    const id = created.json().id;
    const del = await app.inject({ method: "DELETE", url: `/financial/expenses/${id}`, headers: auth(token) });
    expect(del.statusCode).toBe(204);
    const list = await app.inject({ method: "GET", url: "/financial/expenses", headers: auth(token) });
    expect(list.json().total).toBe(0);
    const again = await app.inject({ method: "DELETE", url: `/financial/expenses/${id}`, headers: auth(token) });
    expect(again.statusCode).toBe(404);
  });

  it("does not leak another tenant's expense", async () => {
    const a = await businessAccount(app);
    const b = await businessAccount(app);
    const created = await app.inject({
      method: "POST",
      url: "/financial/expenses",
      headers: auth(a.token),
      payload: { amount: "12.00", currency: "USD", spentAt: "2026-03-10T00:00:00.000Z" },
    });
    const id = created.json().id;
    const cross = await app.inject({ method: "GET", url: `/financial/expenses/${id}`, headers: auth(b.token) });
    expect(cross.statusCode).toBe(404);
  });
});

describe("receipts", () => {
  it("uploads, lists, and streams a receipt back byte-for-byte", async () => {
    const { token } = await businessAccount(app);
    const expenseId = await createExpense(app, token);

    const upload = await app.inject({
      method: "POST",
      url: `/financial/expenses/${expenseId}/receipts`,
      headers: auth(token),
      payload: { fileName: "till.png", mimeType: "image/png", dataBase64: TINY_PNG },
    });
    expect(upload.statusCode).toBe(201);
    expect(upload.json()).toMatchObject({ status: "ready", downloadable: true });
    const receiptId = upload.json().id;

    const list = await app.inject({
      method: "GET",
      url: `/financial/expenses/${expenseId}/receipts`,
      headers: auth(token),
    });
    expect(list.json()).toHaveLength(1);

    const grant = await app.inject({
      method: "POST",
      url: `/financial/receipts/${receiptId}/download`,
      headers: auth(token),
    });
    expect(grant.statusCode).toBe(200);
    const streamed = await app.inject({
      method: "GET",
      url: `/financial/receipts/download/${grant.json().token}`,
      headers: auth(token),
    });
    expect(streamed.statusCode).toBe(200);
    expect(streamed.rawPayload.equals(Buffer.from(TINY_PNG, "base64"))).toBe(true);
  });

  it("rejects a disallowed file type", async () => {
    const { token } = await businessAccount(app);
    const expenseId = await createExpense(app, token);
    const res = await app.inject({
      method: "POST",
      url: `/financial/expenses/${expenseId}/receipts`,
      headers: auth(token),
      payload: { fileName: "note.txt", mimeType: "text/plain", dataBase64: Buffer.from("hi").toString("base64") },
    });
    expect(res.statusCode).toBe(400);
  });

  it("does not let another tenant see, download, or delete a receipt", async () => {
    const a = await businessAccount(app);
    const b = await businessAccount(app);
    const expenseId = await createExpense(app, a.token);
    const upload = await app.inject({
      method: "POST",
      url: `/financial/expenses/${expenseId}/receipts`,
      headers: auth(a.token),
      payload: { fileName: "till.png", mimeType: "image/png", dataBase64: TINY_PNG },
    });
    const receiptId = upload.json().id;

    const list = await app.inject({
      method: "GET",
      url: `/financial/expenses/${expenseId}/receipts`,
      headers: auth(b.token),
    });
    expect(list.statusCode).toBe(404);
    const grant = await app.inject({
      method: "POST",
      url: `/financial/receipts/${receiptId}/download`,
      headers: auth(b.token),
    });
    expect(grant.statusCode).toBe(404);
    const del = await app.inject({ method: "DELETE", url: `/financial/receipts/${receiptId}`, headers: auth(b.token) });
    expect(del.statusCode).toBe(404);
  });

  it("quarantines a receipt the scanner rejects and refuses to serve it", async () => {
    configureExpenseReceiptPlatform({
      storage: {
        put: async () => undefined,
        get: async () => Buffer.from(TINY_PNG, "base64"),
        remove: async () => undefined,
      },
      scanner: { scan: async () => ({ clean: false, detail: "eicar" }) },
    });
    try {
      const { token } = await businessAccount(app);
      const expenseId = await createExpense(app, token);
      const upload = await app.inject({
        method: "POST",
        url: `/financial/expenses/${expenseId}/receipts`,
        headers: auth(token),
        payload: { fileName: "bad.pdf", mimeType: "application/pdf", dataBase64: TINY_PNG },
      });
      expect(upload.statusCode).toBe(201);
      expect(upload.json()).toMatchObject({ status: "quarantined", downloadable: false });
      const grant = await app.inject({
        method: "POST",
        url: `/financial/receipts/${upload.json().id}/download`,
        headers: auth(token),
      });
      expect(grant.statusCode).toBe(404);
    } finally {
      const objects = new Map<string, Buffer>();
      configureExpenseReceiptPlatform({
        storage: {
          put: async (key, body) => void objects.set(key, Buffer.from(body)),
          get: async (key) => objects.get(key) ?? null,
          remove: async (key) => void objects.delete(key),
        },
        scanner: { scan: async (_b, m) => ({ clean: true, detectedMime: m }) },
      });
    }
  });
});

describe("mileage", () => {
  it("derives the money value from distance x rate and requires a currency with a rate", async () => {
    const { token } = await businessAccount(app);
    const noCurrency = await app.inject({
      method: "POST",
      url: "/financial/mileage",
      headers: auth(token),
      payload: { tripDate: "2026-03-12T00:00:00.000Z", distance: "20", ratePerUnit: "0.45" },
    });
    expect(noCurrency.statusCode).toBe(400);

    const ok = await app.inject({
      method: "POST",
      url: "/financial/mileage",
      headers: auth(token),
      payload: { tripDate: "2026-03-12T00:00:00.000Z", distance: "20", unit: "mi", ratePerUnit: "0.45", currency: "usd" },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ amount: "9.00", currency: "USD", ratePerUnit: "0.4500" });

    const distanceOnly = await app.inject({
      method: "POST",
      url: "/financial/mileage",
      headers: auth(token),
      payload: { tripDate: "2026-03-12T00:00:00.000Z", distance: "8" },
    });
    expect(distanceOnly.statusCode).toBe(201);
    expect(distanceOnly.json().amount).toBeNull();
  });
});
