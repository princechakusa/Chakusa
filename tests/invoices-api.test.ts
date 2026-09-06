import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { BusinessRole } from "@prisma/client";
import { createTestApp, resetDatabase, registerAccount, authHeader, setPlan, setSubscriptionStatus } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { createSession } from "../src/modules/auth/auth.service.js";

// PROGRAM 3 / Invoicing I2: BUSINESS draft + read Invoice API.

const YEAR = new Date().getUTCFullYear();

async function businessAccount(app: FastifyInstance, plan: "FREE" | "PRO" | "BUSINESS" = "BUSINESS") {
  const account = await registerAccount(app);
  await setPlan(account.businessId, plan);
  if (plan !== "FREE") await setSubscriptionStatus(account.businessId, "ACTIVE");
  return account;
}

async function addMember(app: FastifyInstance, businessId: string, role: BusinessRole) {
  const email = `member-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const user = await prisma.user.create({ data: { email, normalizedEmail: email.toLowerCase(), fullName: `${role} Member`, passwordHash: null } });
  await prisma.businessMember.create({ data: { businessId, userId: user.id, role, status: "ACTIVE" } });
  const { session } = await createSession(user.id, prisma);
  return { userId: user.id, token: app.jwt.sign({ userId: user.id, sessionId: session.id, type: "access" }, { expiresIn: 900 }) };
}

async function registerCustomer(app: FastifyInstance) {
  const email = `cust-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const res = await app.inject({ method: "POST", url: "/customer/auth/register", payload: { email, password: "password123", fullName: "Casey Customer" } });
  if (res.statusCode !== 201) throw new Error(`customer register failed: ${res.body}`);
  return res.json().accessToken as string;
}

function createBody(over: Record<string, unknown> = {}) {
  return { lineItems: [{ description: "Consulting", quantity: 2, unitPrice: "75.00", discountAmount: "10.00" }], ...over };
}

describe("Invoicing draft + read API (Program 3, Invoicing I2)", () => {
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

  // --- auth & entitlement ---

  it("rejects unauthenticated and customer-scoped callers", async () => {
    expect((await app.inject({ method: "GET", url: "/invoices" })).statusCode).toBe(401);
    const custToken = await registerCustomer(app);
    expect((await app.inject({ method: "GET", url: "/invoices", headers: authHeader(custToken) })).statusCode).toBe(401);
  });

  it("returns 403 FEATURE_NOT_AVAILABLE for FREE and PRO plans", async () => {
    for (const plan of ["FREE", "PRO"] as const) {
      const account = await businessAccount(app, plan);
      const res = await app.inject({ method: "GET", url: "/invoices", headers: authHeader(account.token) });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("FEATURE_NOT_AVAILABLE");
    }
  });

  it("allows a BUSINESS plan account with an empty list", async () => {
    const account = await businessAccount(app);
    const res = await app.inject({ method: "GET", url: "/invoices", headers: authHeader(account.token) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ items: [], total: 0, page: 1, pageSize: 25 });
  });

  // --- roles ---

  it("lets OWNER, ADMIN and STAFF all create, edit and delete drafts", async () => {
    const owner = await businessAccount(app);
    for (const role of ["ADMIN", "STAFF"] as const) {
      const member = await addMember(app, owner.businessId, role);
      const created = await app.inject({ method: "POST", url: "/invoices", headers: authHeader(member.token), payload: createBody() });
      expect(created.statusCode).toBe(201);
      const id = created.json().id;
      const edited = await app.inject({
        method: "PATCH",
        url: `/invoices/${id}`,
        headers: authHeader(member.token),
        payload: { expectedCurrentRevisionId: created.json().currentRevision.id, lineItems: [{ description: "Revised", quantity: 1, unitPrice: "10.00" }] },
      });
      expect(edited.statusCode).toBe(200);
      expect((await app.inject({ method: "DELETE", url: `/invoices/${id}`, headers: authHeader(member.token) })).statusCode).toBe(204);
    }
  });

  // --- creation ---

  it("allocates a stable server invoice number and computes totals server-side", async () => {
    const account = await businessAccount(app);
    const h = authHeader(account.token);
    const first = await app.inject({ method: "POST", url: "/invoices", headers: h, payload: createBody() });
    const second = await app.inject({ method: "POST", url: "/invoices", headers: h, payload: createBody() });
    expect(first.json().invoiceNumber).toBe(`INV-${YEAR}-0001`);
    expect(second.json().invoiceNumber).toBe(`INV-${YEAR}-0002`);
    expect(first.json().status).toBe("DRAFT");
    expect(first.json().currency).toBe("USD");
    expect(first.json().currentRevision.totals).toEqual({ subtotal: "150.00", discountTotal: "10.00", taxTotal: "0.00", total: "140.00" });
  });

  it("applies taxRatePercent to taxable lines only", async () => {
    const account = await businessAccount(app);
    const res = await app.inject({
      method: "POST",
      url: "/invoices",
      headers: authHeader(account.token),
      payload: createBody({ lineItems: [{ description: "Part", quantity: 1, unitPrice: "100.00", taxable: true }], taxRatePercent: 10 }),
    });
    expect(res.json().currentRevision.totals).toEqual({ subtotal: "100.00", discountTotal: "0.00", taxTotal: "10.00", total: "110.00" });
  });

  it("accepts a zero-line DRAFT with zero totals and stores issue/due dates", async () => {
    const account = await businessAccount(app);
    const due = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const res = await app.inject({ method: "POST", url: "/invoices", headers: authHeader(account.token), payload: { dueDate: due } });
    expect(res.statusCode).toBe(201);
    expect(res.json().currentRevision.totals.total).toBe("0.00");
    expect(new Date(res.json().dueDate).toISOString()).toBe(due);
  });

  it("ignores client-supplied invoiceNumber / currency / status / totals", async () => {
    const account = await businessAccount(app);
    const other = await businessAccount(app);
    const res = await app.inject({
      method: "POST",
      url: "/invoices",
      headers: authHeader(account.token),
      payload: createBody({ businessId: other.businessId, invoiceNumber: "HACK-1", currency: "EUR", status: "SENT", total: "0.01" }),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().invoiceNumber).toBe(`INV-${YEAR}-0001`);
    expect(res.json().currency).toBe("USD");
    expect(res.json().status).toBe("DRAFT");
    const row = await prisma.invoice.findUniqueOrThrow({ where: { id: res.json().id } });
    expect(row.businessId).toBe(account.businessId);
  });

  it("snapshots currency at creation and does not re-read it later", async () => {
    const account = await businessAccount(app);
    await prisma.business.update({ where: { id: account.businessId }, data: { currency: "GBP" } });
    const first = await app.inject({ method: "POST", url: "/invoices", headers: authHeader(account.token), payload: createBody() });
    expect(first.json().currency).toBe("GBP");
    await prisma.business.update({ where: { id: account.businessId }, data: { currency: "CAD" } });
    const detail = await app.inject({ method: "GET", url: `/invoices/${first.json().id}`, headers: authHeader(account.token) });
    expect(detail.json().currency).toBe("GBP");
  });

  // --- tenant isolation ---

  it("safe-rejects a cross-tenant customerId with 404 and creates nothing", async () => {
    const account = await businessAccount(app);
    const other = await businessAccount(app);
    const foreignCustomer = await prisma.customer.create({ data: { businessId: other.businessId, name: "Theirs" } });
    const res = await app.inject({ method: "POST", url: "/invoices", headers: authHeader(account.token), payload: createBody({ customerId: foreignCustomer.id }) });
    expect(res.statusCode).toBe(404);
    expect(await prisma.invoice.count()).toBe(0);
  });

  it("does not let one tenant read, edit or delete another tenant's invoice", async () => {
    const a = await businessAccount(app);
    const b = await businessAccount(app);
    const created = (await app.inject({ method: "POST", url: "/invoices", headers: authHeader(a.token), payload: createBody() })).json();
    expect((await app.inject({ method: "GET", url: `/invoices/${created.id}`, headers: authHeader(b.token) })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/invoices/${created.id}`, headers: authHeader(b.token) })).statusCode).toBe(404);
    const patch = await app.inject({ method: "PATCH", url: `/invoices/${created.id}`, headers: authHeader(b.token), payload: { expectedCurrentRevisionId: created.currentRevision.id, lineItems: [] } });
    expect(patch.statusCode).toBe(404);
  });

  // --- editing ---

  it("creates a NEW immutable revision on edit, leaving the old revision + line items unchanged", async () => {
    const account = await businessAccount(app);
    const h = authHeader(account.token);
    const created = (await app.inject({ method: "POST", url: "/invoices", headers: h, payload: createBody() })).json();
    const rev1Id = created.currentRevision.id;
    const rev1Items = await prisma.invoiceLineItem.findMany({ where: { invoiceRevisionId: rev1Id } });

    const edited = (await app.inject({
      method: "PATCH",
      url: `/invoices/${created.id}`,
      headers: h,
      payload: { expectedCurrentRevisionId: rev1Id, lineItems: [{ description: "New scope", quantity: 3, unitPrice: "20.00" }] },
    })).json();

    expect(edited.currentRevision.id).not.toBe(rev1Id);
    expect(edited.currentRevision.revisionNumber).toBe(2);
    expect(edited.currentRevision.totals.total).toBe("60.00");
    expect(edited.revisionHistory.map((r: { revisionNumber: number }) => r.revisionNumber)).toEqual([1, 2]);

    const rev1After = await prisma.invoiceRevision.findUniqueOrThrow({ where: { id: rev1Id } });
    expect(rev1After.total.toFixed(2)).toBe("140.00");
    expect(await prisma.invoiceLineItem.findMany({ where: { invoiceRevisionId: rev1Id } })).toEqual(rev1Items);
  });

  it("rejects a stale expectedCurrentRevisionId with 409", async () => {
    const account = await businessAccount(app);
    const h = authHeader(account.token);
    const created = (await app.inject({ method: "POST", url: "/invoices", headers: h, payload: createBody() })).json();
    const staleId = created.currentRevision.id;
    await app.inject({ method: "PATCH", url: `/invoices/${created.id}`, headers: h, payload: { expectedCurrentRevisionId: staleId, lineItems: [] } });
    const second = await app.inject({ method: "PATCH", url: `/invoices/${created.id}`, headers: h, payload: { expectedCurrentRevisionId: staleId, lineItems: [{ description: "Z", quantity: 1, unitPrice: "1.00" }] } });
    expect(second.statusCode).toBe(409);
  });

  // --- deletion ---

  it("deletes a DRAFT and cascades its revisions", async () => {
    const account = await businessAccount(app);
    const h = authHeader(account.token);
    const created = (await app.inject({ method: "POST", url: "/invoices", headers: h, payload: createBody() })).json();
    expect((await app.inject({ method: "DELETE", url: `/invoices/${created.id}`, headers: h })).statusCode).toBe(204);
    expect(await prisma.invoice.count({ where: { id: created.id } })).toBe(0);
    expect(await prisma.invoiceRevision.count({ where: { invoiceId: created.id } })).toBe(0);
  });

  it("rejects deleting a non-DRAFT invoice with 409", async () => {
    const account = await businessAccount(app);
    const h = authHeader(account.token);
    const created = (await app.inject({ method: "POST", url: "/invoices", headers: h, payload: createBody() })).json();
    await prisma.invoice.update({ where: { id: created.id }, data: { status: "SENT" } });
    expect((await app.inject({ method: "DELETE", url: `/invoices/${created.id}`, headers: h })).statusCode).toBe(409);
    expect(await prisma.invoice.count({ where: { id: created.id } })).toBe(1);
  });

  // --- reads ---

  it("lists only the calling business's invoices, with filters and pagination", async () => {
    const a = await businessAccount(app);
    const b = await businessAccount(app);
    await app.inject({ method: "POST", url: "/invoices", headers: authHeader(a.token), payload: createBody() });
    await app.inject({ method: "POST", url: "/invoices", headers: authHeader(a.token), payload: createBody() });
    await app.inject({ method: "POST", url: "/invoices", headers: authHeader(b.token), payload: createBody() });

    const all = await app.inject({ method: "GET", url: "/invoices", headers: authHeader(a.token) });
    expect(all.json().total).toBe(2);

    const paged = await app.inject({ method: "GET", url: "/invoices?page=1&pageSize=1", headers: authHeader(a.token) });
    expect(paged.json()).toMatchObject({ total: 2, page: 1, pageSize: 1 });
    expect(paged.json().items).toHaveLength(1);

    const drafts = await app.inject({ method: "GET", url: "/invoices?status=DRAFT", headers: authHeader(a.token) });
    expect(drafts.json().total).toBe(2);
  });

  it("detail returns the current revision, revision history and no payment fields", async () => {
    const account = await businessAccount(app);
    const h = authHeader(account.token);
    const created = (await app.inject({ method: "POST", url: "/invoices", headers: h, payload: createBody() })).json();
    const detail = await app.inject({ method: "GET", url: `/invoices/${created.id}`, headers: h });
    expect(detail.statusCode).toBe(200);
    const body = detail.json();
    expect(body.currentRevision.lineItems[0]).toMatchObject({ description: "Consulting", quantity: "2.00", unitPrice: "75.00", lineTotal: "140.00" });
    expect(body.revisionHistory).toHaveLength(1);
    expect(body.quoteProvenance).toBeNull();
    // No payment / paid / balance leakage in the read model.
    expect(detail.body).not.toContain("amountPaid");
    expect(detail.body).not.toContain("paidAmount");
    expect(detail.body).not.toContain("balance");
  });
});
