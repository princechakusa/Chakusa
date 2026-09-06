import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { BusinessRole } from "@prisma/client";
import { createTestApp, resetDatabase, registerAccount, authHeader, setPlan, setSubscriptionStatus } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { createSession } from "../src/modules/auth/auth.service.js";

// PROGRAM 3 / Invoicing I3: Create invoice from an accepted quote.

const YEAR = new Date().getUTCFullYear();

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

/** Creates a quote, sends it, and returns { quoteId, acceptToken }. */
async function sendQuote(app: FastifyInstance, token: string, over: Record<string, unknown> = {}) {
  const body = { documentType: "QUOTE", lineItems: [{ description: "Build", quantity: 2, unitPrice: "80.00", discountAmount: "10.00", taxable: true }], taxRatePercent: 10, ...over };
  const draft = await app.inject({ method: "POST", url: "/quotes", headers: authHeader(token), payload: body });
  if (draft.statusCode !== 201) throw new Error(`draft failed: ${draft.body}`);
  const sent = await app.inject({ method: "POST", url: `/quotes/${draft.json().id}/send`, headers: authHeader(token) });
  if (sent.statusCode !== 200) throw new Error(`send failed: ${sent.body}`);
  return { quoteId: draft.json().id as string, revisionId: draft.json().currentRevision.id as string, rawToken: sent.json().acceptanceToken as string };
}

async function acceptedQuote(app: FastifyInstance, token: string, over: Record<string, unknown> = {}) {
  const q = await sendQuote(app, token, over);
  const accepted = await app.inject({ method: "POST", url: `/public/quotes/${q.rawToken}/accept` });
  if (accepted.statusCode !== 200) throw new Error(`accept failed: ${accepted.body}`);
  return q;
}

describe("Invoicing: create from accepted quote (Program 3, Invoicing I3)", () => {
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

  it("copies the exact accepted revision into a new DRAFT invoice with provenance and one event", async () => {
    const account = await businessAccount(app);
    const { quoteId, revisionId } = await acceptedQuote(app, account.token);
    const quoteDetail = await prisma.quoteDocument.findUniqueOrThrow({ where: { id: quoteId } });
    expect(quoteDetail.acceptedRevisionId).toBe(revisionId);

    const res = await app.inject({ method: "POST", url: `/invoices/from-quote/${quoteId}`, headers: authHeader(account.token) });
    expect(res.statusCode).toBe(201);
    const inv = res.json();
    expect(inv.status).toBe("DRAFT");
    expect(inv.invoiceNumber).toBe(`INV-${YEAR}-0001`);
    expect(inv.currency).toBe("USD");
    expect(inv.quoteProvenance).toEqual({ quoteDocumentId: quoteId, quoteRevisionId: revisionId });

    // Financial snapshot copied verbatim: 2 x 80 - 10 = 150 subtotal,
    // taxable line -> 10% of 150 = 15 tax, total 155.
    expect(inv.currentRevision.totals).toEqual({ subtotal: "160.00", discountTotal: "10.00", taxTotal: "15.00", total: "165.00" });
    expect(inv.currentRevision.lineItems[0]).toMatchObject({ description: "Build", quantity: "2.00", unitPrice: "80.00", discountAmount: "10.00", taxable: true, lineTotal: "150.00" });

    const events = await prisma.invoiceEvent.findMany({ where: { invoiceId: inv.id, eventType: "CONVERTED_FROM_QUOTE" } });
    expect(events).toHaveLength(1);
    expect(events[0]!.actorType).toBe("BUSINESS_MEMBER");
    expect(events[0]!.metadata).toMatchObject({ quoteDocumentId: quoteId, quoteRevisionId: revisionId });

    // The source quote revision + its line items are untouched.
    const revAfter = await prisma.quoteRevision.findUniqueOrThrow({ where: { id: revisionId } });
    expect(revAfter.total.toFixed(2)).toBe("165.00");
  });

  it("carries the quote's customer / appointment association", async () => {
    const account = await businessAccount(app);
    const customer = await prisma.customer.create({ data: { businessId: account.businessId, name: "Linked" } });
    const { quoteId } = await acceptedQuote(app, account.token, { customerId: customer.id });
    const res = await app.inject({ method: "POST", url: `/invoices/from-quote/${quoteId}`, headers: authHeader(account.token) });
    expect(res.json().origins.customerId).toBe(customer.id);
  });

  it("rejects converting a quote that is not ACCEPTED", async () => {
    const account = await businessAccount(app);
    // DRAFT
    const draft = await app.inject({ method: "POST", url: "/quotes", headers: authHeader(account.token), payload: { documentType: "QUOTE", lineItems: [{ description: "x", quantity: 1, unitPrice: "1.00" }] } });
    expect((await app.inject({ method: "POST", url: `/invoices/from-quote/${draft.json().id}`, headers: authHeader(account.token) })).statusCode).toBe(409);
    // SENT (not yet accepted)
    const sent = await sendQuote(app, account.token);
    expect((await app.inject({ method: "POST", url: `/invoices/from-quote/${sent.quoteId}`, headers: authHeader(account.token) })).statusCode).toBe(409);
    // DECLINED
    const declined = await sendQuote(app, account.token);
    await app.inject({ method: "POST", url: `/public/quotes/${declined.rawToken}/decline` });
    expect((await app.inject({ method: "POST", url: `/invoices/from-quote/${declined.quoteId}`, headers: authHeader(account.token) })).statusCode).toBe(409);
  });

  it("rejects a duplicate conversion while a non-VOID invoice already exists, but allows it after that invoice is voided", async () => {
    const account = await businessAccount(app);
    const { quoteId } = await acceptedQuote(app, account.token);
    const first = await app.inject({ method: "POST", url: `/invoices/from-quote/${quoteId}`, headers: authHeader(account.token) });
    expect(first.statusCode).toBe(201);
    const dup = await app.inject({ method: "POST", url: `/invoices/from-quote/${quoteId}`, headers: authHeader(account.token) });
    expect(dup.statusCode).toBe(409);

    await prisma.invoice.update({ where: { id: first.json().id }, data: { status: "VOID" } });
    const reconvert = await app.inject({ method: "POST", url: `/invoices/from-quote/${quoteId}`, headers: authHeader(account.token) });
    expect(reconvert.statusCode).toBe(201);
    expect(reconvert.json().invoiceNumber).toBe(`INV-${YEAR}-0002`);
  });

  it("does not let another tenant convert the quote", async () => {
    const a = await businessAccount(app);
    const b = await businessAccount(app);
    const { quoteId } = await acceptedQuote(app, a.token);
    expect((await app.inject({ method: "POST", url: `/invoices/from-quote/${quoteId}`, headers: authHeader(b.token) })).statusCode).toBe(404);
    expect(await prisma.invoice.count()).toBe(0);
  });

  it("STAFF may convert; FREE/PRO are blocked by entitlement; unauthenticated / customer callers are 401", async () => {
    const owner = await businessAccount(app);
    const staffToken = await addMember(app, owner.businessId, "STAFF");
    const q1 = await acceptedQuote(app, owner.token);
    expect((await app.inject({ method: "POST", url: `/invoices/from-quote/${q1.quoteId}`, headers: authHeader(staffToken) })).statusCode).toBe(201);

    const q2 = await acceptedQuote(app, owner.token);
    await setPlan(owner.businessId, "PRO");
    expect((await app.inject({ method: "POST", url: `/invoices/from-quote/${q2.quoteId}`, headers: authHeader(owner.token) })).statusCode).toBe(403);

    expect((await app.inject({ method: "POST", url: `/invoices/from-quote/${q2.quoteId}` })).statusCode).toBe(401);
    const cust = await app.inject({ method: "POST", url: "/customer/auth/register", payload: { email: `c${Date.now()}@x.com`, password: "password123", fullName: "C" } });
    expect((await app.inject({ method: "POST", url: `/invoices/from-quote/${q2.quoteId}`, headers: authHeader(cust.json().accessToken) })).statusCode).toBe(401);
  });
});
