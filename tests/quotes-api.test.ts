import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { BusinessRole } from "@prisma/client";
import { createTestApp, resetDatabase, registerAccount, authHeader, setPlan, setSubscriptionStatus } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { createSession } from "../src/modules/auth/auth.service.js";
import { canSendQuote } from "../src/lib/quotes/quotes.domain.js";

// PROGRAM 3 LOOP 3B: BUSINESS draft + read Quotes/Estimates API.

const YEAR = new Date().getUTCFullYear();

async function businessAccount(app: FastifyInstance, plan: "FREE" | "PRO" | "BUSINESS" = "BUSINESS") {
  const account = await registerAccount(app);
  await setPlan(account.businessId, plan);
  if (plan !== "FREE") await setSubscriptionStatus(account.businessId, "ACTIVE");
  return account;
}

/** Adds a second user to `businessId` with the given role and returns a usable access token. */
async function addMember(app: FastifyInstance, businessId: string, role: BusinessRole) {
  const email = `member-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const user = await prisma.user.create({ data: { email, normalizedEmail: email.toLowerCase(), fullName: `${role} Member`, passwordHash: null } });
  await prisma.businessMember.create({ data: { businessId, userId: user.id, role, status: "ACTIVE" } });
  const { session } = await createSession(user.id, prisma);
  const token = app.jwt.sign({ userId: user.id, sessionId: session.id, type: "access" }, { expiresIn: 900 });
  return { userId: user.id, token };
}

async function registerCustomer(app: FastifyInstance) {
  const email = `cust-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const res = await app.inject({ method: "POST", url: "/customer/auth/register", payload: { email, password: "password123", fullName: "Casey Customer" } });
  if (res.statusCode !== 201) throw new Error(`customer register failed: ${res.body}`);
  return res.json().accessToken as string;
}

function createBody(over: Record<string, unknown> = {}) {
  return { documentType: "QUOTE", lineItems: [{ description: "Labor", quantity: 2, unitPrice: "50.00", discountAmount: "10.00" }], ...over };
}

describe("Quotes & Estimates API (Program 3, Loop 3B)", () => {
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

  // --- auth & entitlement ---------------------------------------------------

  it("rejects an unauthenticated request", async () => {
    const res = await app.inject({ method: "GET", url: "/quotes" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a customer-scoped token", async () => {
    const token = await registerCustomer(app);
    const res = await app.inject({ method: "GET", url: "/quotes", headers: authHeader(token) });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 FEATURE_NOT_AVAILABLE for FREE and PRO plans", async () => {
    const free = await businessAccount(app, "FREE");
    const pro = await businessAccount(app, "PRO");
    for (const account of [free, pro]) {
      const res = await app.inject({ method: "GET", url: "/quotes", headers: authHeader(account.token) });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("FEATURE_NOT_AVAILABLE");
    }
  });

  it("allows a BUSINESS plan account", async () => {
    const account = await businessAccount(app);
    const res = await app.inject({ method: "GET", url: "/quotes", headers: authHeader(account.token) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ items: [], total: 0, page: 1, pageSize: 25 });
  });

  // --- roles --------------------------------------------------------------

  it("lets OWNER, ADMIN and STAFF all create, edit and delete drafts", async () => {
    const owner = await businessAccount(app);
    for (const role of ["ADMIN", "STAFF"] as const) {
      const member = await addMember(app, owner.businessId, role);
      const created = await app.inject({ method: "POST", url: "/quotes", headers: authHeader(member.token), payload: createBody() });
      expect(created.statusCode).toBe(201);
      const id = created.json().id;
      const edited = await app.inject({
        method: "PATCH",
        url: `/quotes/${id}`,
        headers: authHeader(member.token),
        payload: { expectedCurrentRevisionId: created.json().currentRevision.id, lineItems: [{ description: "Revised", quantity: 1, unitPrice: "10.00" }] },
      });
      expect(edited.statusCode).toBe(200);
      const deleted = await app.inject({ method: "DELETE", url: `/quotes/${id}`, headers: authHeader(member.token) });
      expect(deleted.statusCode).toBe(204);
    }
  });

  // --- creation ---------------------------------------------------------

  it("allocates a stable server document number with independent QUOTE / ESTIMATE sequences", async () => {
    const account = await businessAccount(app);
    const h = authHeader(account.token);
    const q1 = await app.inject({ method: "POST", url: "/quotes", headers: h, payload: createBody() });
    const q2 = await app.inject({ method: "POST", url: "/quotes", headers: h, payload: createBody() });
    const e1 = await app.inject({ method: "POST", url: "/quotes", headers: h, payload: createBody({ documentType: "ESTIMATE" }) });
    expect(q1.json().documentNumber).toBe(`Q-${YEAR}-0001`);
    expect(q2.json().documentNumber).toBe(`Q-${YEAR}-0002`);
    expect(e1.json().documentNumber).toBe(`E-${YEAR}-0001`);
    expect(q1.json().status).toBe("DRAFT");
    expect(q1.json().currency).toBe("USD");
  });

  it("computes totals server-side from line items", async () => {
    const account = await businessAccount(app);
    const res = await app.inject({ method: "POST", url: "/quotes", headers: authHeader(account.token), payload: createBody() });
    expect(res.json().currentRevision.totals).toEqual({ subtotal: "100.00", discountTotal: "10.00", taxTotal: "0.00", total: "90.00" });
  });

  it("applies taxRatePercent to taxable lines only", async () => {
    const account = await businessAccount(app);
    const res = await app.inject({
      method: "POST",
      url: "/quotes",
      headers: authHeader(account.token),
      payload: createBody({ lineItems: [{ description: "Part", quantity: 1, unitPrice: "100.00", taxable: true }], taxRatePercent: 10 }),
    });
    expect(res.json().currentRevision.totals).toEqual({ subtotal: "100.00", discountTotal: "0.00", taxTotal: "10.00", total: "110.00" });
  });

  it("accepts a zero-line-item DRAFT with zero totals", async () => {
    const account = await businessAccount(app);
    const res = await app.inject({ method: "POST", url: "/quotes", headers: authHeader(account.token), payload: { documentType: "QUOTE" } });
    expect(res.statusCode).toBe(201);
    expect(res.json().currentRevision.totals).toEqual({ subtotal: "0.00", discountTotal: "0.00", taxTotal: "0.00", total: "0.00" });
    expect(res.json().currentRevision.lineItems).toEqual([]);
  });

  it("ignores client-supplied businessId / documentNumber / currency / totals", async () => {
    const account = await businessAccount(app);
    const other = await businessAccount(app);
    const res = await app.inject({
      method: "POST",
      url: "/quotes",
      headers: authHeader(account.token),
      payload: createBody({ businessId: other.businessId, documentNumber: "HACK-1", currency: "EUR", total: "0.01", currentRevisionId: "x" }),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().documentNumber).toBe(`Q-${YEAR}-0001`);
    expect(res.json().currency).toBe("USD");
    const row = await prisma.quoteDocument.findUniqueOrThrow({ where: { id: res.json().id } });
    expect(row.businessId).toBe(account.businessId);
  });

  it("snapshots currency at creation and does not re-read it later", async () => {
    const account = await businessAccount(app);
    await prisma.business.update({ where: { id: account.businessId }, data: { currency: "GBP" } });
    const first = await app.inject({ method: "POST", url: "/quotes", headers: authHeader(account.token), payload: createBody() });
    expect(first.json().currency).toBe("GBP");
    await prisma.business.update({ where: { id: account.businessId }, data: { currency: "CAD" } });
    const detail = await app.inject({ method: "GET", url: `/quotes/${first.json().id}`, headers: authHeader(account.token) });
    expect(detail.json().currency).toBe("GBP");
  });

  // --- tenant isolation on origins ---------------------------------------

  it("safe-rejects a cross-tenant leadId with 404 and no existence leak", async () => {
    const account = await businessAccount(app);
    const other = await businessAccount(app);
    const foreignLead = await prisma.lead.create({ data: { businessId: other.businessId } });
    const res = await app.inject({ method: "POST", url: "/quotes", headers: authHeader(account.token), payload: createBody({ leadId: foreignLead.id }) });
    expect(res.statusCode).toBe(404);
    expect(await prisma.quoteDocument.count()).toBe(0);
  });

  it("safe-rejects a cross-tenant serviceOfferingId with 404", async () => {
    const account = await businessAccount(app);
    const other = await businessAccount(app);
    const foreignService = await prisma.serviceOffering.create({ data: { businessId: other.businessId, name: "X", durationMinutes: 30, price: "10.00" } });
    const res = await app.inject({
      method: "POST",
      url: "/quotes",
      headers: authHeader(account.token),
      payload: createBody({ lineItems: [{ description: "X", quantity: 1, unitPrice: "10.00", serviceOfferingId: foreignService.id }] }),
    });
    expect(res.statusCode).toBe(404);
  });

  // --- draft editing ---------------------------------------------------

  it("creates a NEW immutable revision on edit, leaving the old revision and its line items untouched", async () => {
    const account = await businessAccount(app);
    const h = authHeader(account.token);
    const created = (await app.inject({ method: "POST", url: "/quotes", headers: h, payload: createBody() })).json();
    const rev1Id = created.currentRevision.id;
    const rev1Items = await prisma.quoteLineItem.findMany({ where: { quoteRevisionId: rev1Id } });

    const edited = (await app.inject({
      method: "PATCH",
      url: `/quotes/${created.id}`,
      headers: h,
      payload: { expectedCurrentRevisionId: rev1Id, lineItems: [{ description: "New scope", quantity: 3, unitPrice: "20.00" }] },
    })).json();

    expect(edited.currentRevision.id).not.toBe(rev1Id);
    expect(edited.currentRevision.revisionNumber).toBe(2);
    expect(edited.currentRevision.totals.total).toBe("60.00");
    expect(edited.revisionHistory.map((r: { revisionNumber: number }) => r.revisionNumber)).toEqual([1, 2]);

    const rev1After = await prisma.quoteRevision.findUniqueOrThrow({ where: { id: rev1Id } });
    expect(rev1After.total.toFixed(2)).toBe("90.00");
    const rev1ItemsAfter = await prisma.quoteLineItem.findMany({ where: { quoteRevisionId: rev1Id } });
    expect(rev1ItemsAfter).toEqual(rev1Items);
  });

  it("rejects a stale expectedCurrentRevisionId with 409", async () => {
    const account = await businessAccount(app);
    const h = authHeader(account.token);
    const created = (await app.inject({ method: "POST", url: "/quotes", headers: h, payload: createBody() })).json();
    const staleId = created.currentRevision.id;
    await app.inject({ method: "PATCH", url: `/quotes/${created.id}`, headers: h, payload: { expectedCurrentRevisionId: staleId, lineItems: [] } });
    const second = await app.inject({ method: "PATCH", url: `/quotes/${created.id}`, headers: h, payload: { expectedCurrentRevisionId: staleId, lineItems: [{ description: "Z", quantity: 1, unitPrice: "1.00" }] } });
    expect(second.statusCode).toBe(409);
  });

  it("allows editing a draft down to zero line items", async () => {
    const account = await businessAccount(app);
    const h = authHeader(account.token);
    const created = (await app.inject({ method: "POST", url: "/quotes", headers: h, payload: createBody() })).json();
    const res = await app.inject({ method: "PATCH", url: `/quotes/${created.id}`, headers: h, payload: { expectedCurrentRevisionId: created.currentRevision.id, lineItems: [] } });
    expect(res.statusCode).toBe(200);
    expect(res.json().currentRevision.totals.total).toBe("0.00");
  });

  it("does not let one tenant edit another tenant's draft", async () => {
    const a = await businessAccount(app);
    const b = await businessAccount(app);
    const created = (await app.inject({ method: "POST", url: "/quotes", headers: authHeader(a.token), payload: createBody() })).json();
    const res = await app.inject({
      method: "PATCH",
      url: `/quotes/${created.id}`,
      headers: authHeader(b.token),
      payload: { expectedCurrentRevisionId: created.currentRevision.id, lineItems: [] },
    });
    expect(res.statusCode).toBe(404);
  });

  it("rejects editing a non-DRAFT document", async () => {
    const account = await businessAccount(app);
    const h = authHeader(account.token);
    const created = (await app.inject({ method: "POST", url: "/quotes", headers: h, payload: createBody() })).json();
    await prisma.quoteDocument.update({ where: { id: created.id }, data: { status: "SENT" } });
    const res = await app.inject({ method: "PATCH", url: `/quotes/${created.id}`, headers: h, payload: { expectedCurrentRevisionId: created.currentRevision.id, lineItems: [] } });
    expect(res.statusCode).toBe(409);
  });

  // --- deletion ------------------------------------------------------

  it("deletes a DRAFT and cascades its revisions", async () => {
    const account = await businessAccount(app);
    const h = authHeader(account.token);
    const created = (await app.inject({ method: "POST", url: "/quotes", headers: h, payload: createBody() })).json();
    const res = await app.inject({ method: "DELETE", url: `/quotes/${created.id}`, headers: h });
    expect(res.statusCode).toBe(204);
    expect(await prisma.quoteDocument.count({ where: { id: created.id } })).toBe(0);
    expect(await prisma.quoteRevision.count({ where: { quoteDocumentId: created.id } })).toBe(0);
  });

  it("rejects deleting a non-DRAFT document with 409", async () => {
    const account = await businessAccount(app);
    const h = authHeader(account.token);
    const created = (await app.inject({ method: "POST", url: "/quotes", headers: h, payload: createBody() })).json();
    await prisma.quoteDocument.update({ where: { id: created.id }, data: { status: "SENT" } });
    const res = await app.inject({ method: "DELETE", url: `/quotes/${created.id}`, headers: h });
    expect(res.statusCode).toBe(409);
    expect(await prisma.quoteDocument.count({ where: { id: created.id } })).toBe(1);
  });

  it("returns 404 deleting another tenant's draft or a nonexistent id", async () => {
    const a = await businessAccount(app);
    const b = await businessAccount(app);
    const created = (await app.inject({ method: "POST", url: "/quotes", headers: authHeader(a.token), payload: createBody() })).json();
    expect((await app.inject({ method: "DELETE", url: `/quotes/${created.id}`, headers: authHeader(b.token) })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: "/quotes/00000000-0000-4000-8000-000000000000", headers: authHeader(a.token) })).statusCode).toBe(404);
    expect(await prisma.quoteDocument.count({ where: { id: created.id } })).toBe(1);
  });

  // --- reads --------------------------------------------------------

  it("lists only the calling business's documents, with filters and pagination shape", async () => {
    const a = await businessAccount(app);
    const b = await businessAccount(app);
    await app.inject({ method: "POST", url: "/quotes", headers: authHeader(a.token), payload: createBody() });
    await app.inject({ method: "POST", url: "/quotes", headers: authHeader(a.token), payload: createBody({ documentType: "ESTIMATE" }) });
    await app.inject({ method: "POST", url: "/quotes", headers: authHeader(b.token), payload: createBody() });

    const all = await app.inject({ method: "GET", url: "/quotes", headers: authHeader(a.token) });
    expect(all.json().total).toBe(2);
    expect(all.json().items).toHaveLength(2);

    const estimates = await app.inject({ method: "GET", url: "/quotes?documentType=ESTIMATE", headers: authHeader(a.token) });
    expect(estimates.json().total).toBe(1);
    expect(estimates.json().items[0].documentType).toBe("ESTIMATE");

    const paged = await app.inject({ method: "GET", url: "/quotes?page=1&pageSize=1", headers: authHeader(a.token) });
    expect(paged.json()).toMatchObject({ total: 2, page: 1, pageSize: 1 });
    expect(paged.json().items).toHaveLength(1);
  });

  it("returns detail with the current revision and revision history, never exposing tokenHash", async () => {
    const account = await businessAccount(app);
    const h = authHeader(account.token);
    const created = (await app.inject({ method: "POST", url: "/quotes", headers: h, payload: createBody() })).json();
    const detail = await app.inject({ method: "GET", url: `/quotes/${created.id}`, headers: h });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().currentRevision.lineItems[0]).toMatchObject({ description: "Labor", quantity: "2.00", unitPrice: "50.00", lineTotal: "90.00" });
    expect(detail.json().revisionHistory).toHaveLength(1);
    expect(detail.body).not.toContain("tokenHash");
    expect(detail.body).not.toContain("token_hash");
  });

  it("returns 404 for a cross-tenant detail request", async () => {
    const a = await businessAccount(app);
    const b = await businessAccount(app);
    const created = (await app.inject({ method: "POST", url: "/quotes", headers: authHeader(a.token), payload: createBody() })).json();
    const res = await app.inject({ method: "GET", url: `/quotes/${created.id}`, headers: authHeader(b.token) });
    expect(res.statusCode).toBe(404);
  });

  // --- domain regression guard ------------------------------------------

  it("canSendQuote still rejects a zero-line DRAFT (send guard not weakened)", () => {
    expect(canSendQuote({ status: "DRAFT", lineItems: [] }).ok).toBe(false);
  });
});
