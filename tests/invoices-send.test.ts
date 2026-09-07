import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { BusinessRole } from "@prisma/client";
import { createTestApp, resetDatabase, registerAccount, authHeader, setPlan, setSubscriptionStatus } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { createSession } from "../src/modules/auth/auth.service.js";
import { hashToken } from "../src/lib/authTokens.js";

// PROGRAM 3 / Invoicing I4: send + void + secure customer access.

async function businessAccount(app: FastifyInstance, plan: "FREE" | "PRO" | "BUSINESS" = "BUSINESS") {
  const account = await registerAccount(app);
  await setPlan(account.businessId, plan);
  if (plan !== "FREE") await setSubscriptionStatus(account.businessId, "ACTIVE");
  return account;
}

async function addMember(app: FastifyInstance, businessId: string, role: BusinessRole) {
  const email = `m-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const user = await prisma.user.create({ data: { email, normalizedEmail: email.toLowerCase(), fullName: `${role}`, passwordHash: null } });
  await prisma.businessMember.create({ data: { businessId, userId: user.id, role, status: "ACTIVE" } });
  const { session } = await createSession(user.id, prisma);
  return app.jwt.sign({ userId: user.id, sessionId: session.id, type: "access" }, { expiresIn: 900 });
}

async function draftInvoice(app: FastifyInstance, token: string, over: Record<string, unknown> = {}) {
  const body = { lineItems: [{ description: "Consulting", quantity: 2, unitPrice: "75.00", discountAmount: "10.00" }], ...over };
  const res = await app.inject({ method: "POST", url: "/invoices", headers: authHeader(token), payload: body });
  if (res.statusCode !== 201) throw new Error(`draft failed: ${res.body}`);
  return res.json();
}

async function registerCustomerToken(app: FastifyInstance) {
  const res = await app.inject({ method: "POST", url: "/customer/auth/register", payload: { email: `c${Date.now()}${Math.random().toString(36).slice(2)}@x.com`, password: "password123", fullName: "C" } });
  return res.json().accessToken as string;
}

const tokenFromUrl = (url: string) => url.split("/i/")[1]!;

describe("Invoicing send + void + public access (Program 3, Invoicing I4)", () => {
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

  // --- send ---

  it("transitions DRAFT to SENT, freezes the revision, sets issueDate, issues one hashed token and one SENT event", async () => {
    const account = await businessAccount(app);
    const draft = await draftInvoice(app, account.token);
    const revisionId = draft.currentRevision.id;
    const itemsBefore = await prisma.invoiceLineItem.findMany({ where: { invoiceRevisionId: revisionId }, orderBy: { sortOrder: "asc" } });

    const res = await app.inject({ method: "POST", url: `/invoices/${draft.id}/send`, headers: authHeader(account.token) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.invoice.status).toBe("SENT");
    expect(body.invoice.issueDate).not.toBeNull();
    expect(typeof body.accessToken).toBe("string");
    expect(body.accessUrl).toBe(`http://localhost:19006/i/${body.accessToken}`);
    expect(JSON.stringify(body.invoice)).not.toContain("tokenHash");
    expect(JSON.stringify(body.invoice)).not.toContain(body.accessToken);

    const doc = await prisma.invoice.findUniqueOrThrow({ where: { id: draft.id } });
    expect(doc.status).toBe("SENT");
    expect(doc.currentRevisionId).toBe(revisionId);

    expect(await prisma.invoiceLineItem.findMany({ where: { invoiceRevisionId: revisionId }, orderBy: { sortOrder: "asc" } })).toEqual(itemsBefore);

    const tokens = await prisma.invoiceAccessToken.findMany({ where: { invoiceRevisionId: revisionId } });
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.tokenHash).toBe(hashToken(body.accessToken));
    expect(tokens[0]!.tokenHash).not.toBe(body.accessToken);
    expect(tokens[0]!.revokedAt).toBeNull();
    const ttlMs = tokens[0]!.expiresAt.getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(29 * 86_400_000);
    expect(ttlMs).toBeLessThan(31 * 86_400_000);

    const events = await prisma.invoiceEvent.findMany({ where: { invoiceId: draft.id, eventType: "SENT" } });
    expect(events).toHaveLength(1);
    expect(events[0]!.actorType).toBe("BUSINESS_MEMBER");
  });

  it("lets OWNER, ADMIN and STAFF send", async () => {
    const owner = await businessAccount(app);
    for (const role of ["ADMIN", "STAFF"] as const) {
      const member = await addMember(app, owner.businessId, role);
      const d = await draftInvoice(app, member);
      expect((await app.inject({ method: "POST", url: `/invoices/${d.id}/send`, headers: authHeader(member) })).statusCode).toBe(200);
    }
  });

  it("rejects sending a zero-line DRAFT, a non-DRAFT invoice, and a due-date before the issue date", async () => {
    const account = await businessAccount(app);
    const empty = await draftInvoice(app, account.token, { lineItems: [] });
    expect((await app.inject({ method: "POST", url: `/invoices/${empty.id}/send`, headers: authHeader(account.token) })).statusCode).toBe(400);

    const d = await draftInvoice(app, account.token);
    expect((await app.inject({ method: "POST", url: `/invoices/${d.id}/send`, headers: authHeader(account.token) })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/invoices/${d.id}/send`, headers: authHeader(account.token) })).statusCode).toBe(409);

    const bad = await draftInvoice(app, account.token, {
      issueDate: new Date(Date.now() + 10 * 86_400_000).toISOString(),
      dueDate: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    });
    const res = await app.inject({ method: "POST", url: `/invoices/${bad.id}/send`, headers: authHeader(account.token) });
    expect(res.statusCode).toBe(400);
  });

  it("blocks send for FREE/PRO plans and for unauthenticated / customer callers", async () => {
    const biz = await businessAccount(app, "BUSINESS");
    const d = await draftInvoice(app, biz.token);
    await setPlan(biz.businessId, "PRO");
    expect((await app.inject({ method: "POST", url: `/invoices/${d.id}/send`, headers: authHeader(biz.token) })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/invoices/${d.id}/send` })).statusCode).toBe(401);
    const cust = await registerCustomerToken(app);
    expect((await app.inject({ method: "POST", url: `/invoices/${d.id}/send`, headers: authHeader(cust) })).statusCode).toBe(401);
  });

  it("does not let another tenant send the invoice", async () => {
    const a = await businessAccount(app);
    const b = await businessAccount(app);
    const d = await draftInvoice(app, a.token);
    expect((await app.inject({ method: "POST", url: `/invoices/${d.id}/send`, headers: authHeader(b.token) })).statusCode).toBe(404);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("DRAFT");
  });

  it("resolves concurrent sends to exactly one winner: one token, one event", async () => {
    const account = await businessAccount(app);
    const d = await draftInvoice(app, account.token);
    const [r1, r2] = await Promise.all([
      app.inject({ method: "POST", url: `/invoices/${d.id}/send`, headers: authHeader(account.token) }),
      app.inject({ method: "POST", url: `/invoices/${d.id}/send`, headers: authHeader(account.token) }),
    ]);
    expect([r1.statusCode, r2.statusCode].sort()).toEqual([200, 409]);
    expect(await prisma.invoiceAccessToken.count({ where: { invoiceRevision: { invoiceId: d.id } } })).toBe(1);
    expect(await prisma.invoiceEvent.count({ where: { invoiceId: d.id, eventType: "SENT" } })).toBe(1);
  });

  // --- void ---

  it("OWNER/ADMIN void a SENT invoice (tokens revoked, VOIDED event); STAFF cannot", async () => {
    const owner = await businessAccount(app);
    const staff = await addMember(app, owner.businessId, "STAFF");

    const d1 = await draftInvoice(app, owner.token);
    const sent1 = await app.inject({ method: "POST", url: `/invoices/${d1.id}/send`, headers: authHeader(owner.token) });
    const res = await app.inject({ method: "POST", url: `/invoices/${d1.id}/void`, headers: authHeader(owner.token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("VOID");
    const tok = await prisma.invoiceAccessToken.findFirstOrThrow({ where: { invoiceRevision: { invoiceId: d1.id } } });
    expect(tok.revokedAt).not.toBeNull();
    expect(await prisma.invoiceEvent.count({ where: { invoiceId: d1.id, eventType: "VOIDED" } })).toBe(1);
    // Customer link now reports "void".
    expect((await app.inject({ method: "GET", url: `/public/invoices/${tokenFromUrl(sent1.json().accessUrl)}` })).json().state).toBe("void");

    const d2 = await draftInvoice(app, owner.token);
    await app.inject({ method: "POST", url: `/invoices/${d2.id}/send`, headers: authHeader(owner.token) });
    expect((await app.inject({ method: "POST", url: `/invoices/${d2.id}/void`, headers: authHeader(staff) })).statusCode).toBe(403);
  });

  it("voids a DRAFT (legal) but rejects voiding an already-VOID invoice", async () => {
    const account = await businessAccount(app);
    const d = await draftInvoice(app, account.token);
    expect((await app.inject({ method: "POST", url: `/invoices/${d.id}/void`, headers: authHeader(account.token) })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/invoices/${d.id}/void`, headers: authHeader(account.token) })).statusCode).toBe(409);
  });

  // --- reissue link ---

  it("reissues the customer link for a SENT invoice: old link dies, new link works, no lifecycle change", async () => {
    const account = await businessAccount(app);
    const d = await draftInvoice(app, account.token);
    const sent = await app.inject({ method: "POST", url: `/invoices/${d.id}/send`, headers: authHeader(account.token) });
    const oldToken = sent.json().accessToken as string;

    const res = await app.inject({ method: "POST", url: `/invoices/${d.id}/reissue-link`, headers: authHeader(account.token) });
    expect(res.statusCode).toBe(200);
    const newToken = res.json().accessToken as string;
    expect(newToken).not.toBe(oldToken);
    expect(res.json().accessUrl).toBe(`http://localhost:19006/i/${newToken}`);
    expect(res.json().invoice.status).toBe("SENT");

    expect((await app.inject({ method: "GET", url: `/public/invoices/${oldToken}` })).json().state).toBe("expired");
    expect((await app.inject({ method: "GET", url: `/public/invoices/${newToken}` })).json().state).toBe("open");
    // No extra SENT event for a reissue.
    expect(await prisma.invoiceEvent.count({ where: { invoiceId: d.id, eventType: "SENT" } })).toBe(1);
  });

  it("rejects reissue for a DRAFT or a VOID invoice", async () => {
    const account = await businessAccount(app);
    const draft = await draftInvoice(app, account.token);
    expect((await app.inject({ method: "POST", url: `/invoices/${draft.id}/reissue-link`, headers: authHeader(account.token) })).statusCode).toBe(409);
    await app.inject({ method: "POST", url: `/invoices/${draft.id}/void`, headers: authHeader(account.token) });
    expect((await app.inject({ method: "POST", url: `/invoices/${draft.id}/reissue-link`, headers: authHeader(account.token) })).statusCode).toBe(409);
  });

  // --- public read ---

  it("resolves a valid token to a safe read model of the sent revision", async () => {
    const account = await businessAccount(app);
    const d = await draftInvoice(app, account.token, { notes: "Thanks", terms: "Net 30" });
    const sent = await app.inject({ method: "POST", url: `/invoices/${d.id}/send`, headers: authHeader(account.token) });
    const raw = sent.json().accessToken as string;

    const res = await app.inject({ method: "GET", url: `/public/invoices/${raw}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.state).toBe("open");
    expect(body.invoiceNumber).toBe(d.invoiceNumber);
    expect(body.currency).toBe("USD");
    expect(body.business).toEqual({ name: "Test Business" });
    expect(body.revision.notes).toBe("Thanks");
    expect(body.revision.terms).toBe("Net 30");
    expect(body.revision.totals).toEqual({ subtotal: "150.00", discountTotal: "10.00", taxTotal: "0.00", total: "140.00" });
    expect(body.revision.lineItems[0]).toEqual({ description: "Consulting", quantity: "2.00", unitPrice: "75.00", discountAmount: "10.00", taxable: false, lineTotal: "140.00" });
    // Authoritative payment position only (derived, no provider internals).
    expect(body.payment).toEqual({ currency: "USD", invoiceTotal: "140.00", amountPaid: "0.00", outstandingBalance: "140.00", state: null });
    // No leakage: no token material, no internal record ids, no provider refs.
    for (const forbidden of ["tokenHash", "token_hash", "businessId", "createdByMemberId", "invoiceRevisionId", "stripe", "checkoutUrl", "paymentIntent", hashToken(raw)]) {
      expect(res.body).not.toContain(forbidden);
    }
    for (const key of ["id", "invoiceId", "revisionId", "currentRevisionId", "customerId"]) {
      expect(body).not.toHaveProperty(key);
      expect(body.revision).not.toHaveProperty(key);
      expect(body.payment).not.toHaveProperty(key);
    }
  });

  it("returns a generic 404 for malformed / unknown / forged tokens", async () => {
    const account = await businessAccount(app);
    const d = await draftInvoice(app, account.token);
    const raw = (await app.inject({ method: "POST", url: `/invoices/${d.id}/send`, headers: authHeader(account.token) })).json().accessToken as string;
    const tokenId = raw.split(".")[0];
    expect((await app.inject({ method: "GET", url: "/public/invoices/not-a-token" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/public/invoices/00000000-0000-4000-8000-000000000000.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/public/invoices/${tokenId}.wrongsecretwrongsecretwrongsecretwrongsecretwrongsecretwrong` })).statusCode).toBe(404);
  });

  it("still resolves an expired token but reports state 'expired'", async () => {
    const account = await businessAccount(app);
    const d = await draftInvoice(app, account.token);
    const raw = (await app.inject({ method: "POST", url: `/invoices/${d.id}/send`, headers: authHeader(account.token) })).json().accessToken as string;
    await prisma.invoiceAccessToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await app.inject({ method: "GET", url: `/public/invoices/${raw}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().state).toBe("expired");
    expect(res.json().revision.totals.total).toBe("140.00");
  });

  it("returns 404 (no leak) when the owning business is suspended, and needs no auth", async () => {
    const account = await businessAccount(app);
    const d = await draftInvoice(app, account.token);
    const raw = (await app.inject({ method: "POST", url: `/invoices/${d.id}/send`, headers: authHeader(account.token) })).json().accessToken as string;
    expect((await app.inject({ method: "GET", url: `/public/invoices/${raw}` })).statusCode).toBe(200);
    await prisma.business.update({ where: { id: account.businessId }, data: { platformStatus: "SUSPENDED" } });
    expect((await app.inject({ method: "GET", url: `/public/invoices/${raw}` })).statusCode).toBe(404);
  });
});
