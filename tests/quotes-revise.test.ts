import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { BusinessRole } from "@prisma/client";
import { createTestApp, resetDatabase, registerAccount, authHeader, setPlan, setSubscriptionStatus } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { createSession } from "../src/modules/auth/auth.service.js";

// PROGRAM 3 LOOP 3F.3: SENT -> SENT revision workflow.

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

async function sendQuote(app: FastifyInstance, token: string) {
  const body = { documentType: "QUOTE", lineItems: [{ description: "Labor", quantity: 2, unitPrice: "50.00", discountAmount: "10.00" }] };
  const draft = await app.inject({ method: "POST", url: "/quotes", headers: authHeader(token), payload: body });
  const sent = await app.inject({ method: "POST", url: `/quotes/${draft.json().id}/send`, headers: authHeader(token) });
  if (sent.statusCode !== 200) throw new Error(`send failed: ${sent.body}`);
  return {
    quoteId: draft.json().id as string,
    revisionId: draft.json().currentRevision.id as string,
    rawToken: sent.json().acceptanceToken as string,
  };
}

const reviseBody = (over: Record<string, unknown> = {}) => ({
  expectedCurrentRevisionId: over.expectedCurrentRevisionId,
  lineItems: [{ description: "Revised scope", quantity: 3, unitPrice: "40.00" }],
  ...over,
});

describe("Business quote revise, SENT -> SENT (Program 3, Loop 3F.3)", () => {
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

  it("creates a new immutable current revision, keeps status SENT, preserves the old revision, issues a fresh token", async () => {
    const account = await businessAccount(app);
    const { quoteId, revisionId, rawToken: oldToken } = await sendQuote(app, account.token);
    const oldRev = await prisma.quoteRevision.findUniqueOrThrow({ where: { id: revisionId } });
    const oldItems = await prisma.quoteLineItem.findMany({ where: { quoteRevisionId: revisionId }, orderBy: { sortOrder: "asc" } });

    const res = await app.inject({
      method: "POST",
      url: `/quotes/${quoteId}/revise`,
      headers: authHeader(account.token),
      payload: reviseBody({ expectedCurrentRevisionId: revisionId }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.quote.status).toBe("SENT");
    expect(body.quote.currentRevision.revisionNumber).toBe(2);
    expect(body.quote.currentRevision.id).not.toBe(revisionId);
    expect(body.quote.currentRevision.totals.total).toBe("120.00");
    expect(body.quote.revisionHistory.map((r: { revisionNumber: number }) => r.revisionNumber)).toEqual([1, 2]);
    expect(typeof body.acceptanceToken).toBe("string");
    expect(body.acceptanceToken).not.toBe(oldToken);

    // Old revision + line items are byte-for-byte unchanged.
    expect(await prisma.quoteRevision.findUniqueOrThrow({ where: { id: revisionId } })).toEqual(oldRev);
    expect(await prisma.quoteLineItem.findMany({ where: { quoteRevisionId: revisionId }, orderBy: { sortOrder: "asc" } })).toEqual(oldItems);

    const doc = await prisma.quoteDocument.findUniqueOrThrow({ where: { id: quoteId } });
    expect(doc.status).toBe("SENT");
    expect(doc.nextRevisionNumber).toBe(3);

    const events = await prisma.quoteEvent.findMany({ where: { quoteDocumentId: quoteId, eventType: "REVISED" } });
    expect(events).toHaveLength(1);
    expect(events[0]!.actorType).toBe("BUSINESS_MEMBER");
  });

  it("revokes the old revision token and activates the new one", async () => {
    const account = await businessAccount(app);
    const { quoteId, revisionId, rawToken: oldToken } = await sendQuote(app, account.token);
    const revised = await app.inject({
      method: "POST",
      url: `/quotes/${quoteId}/revise`,
      headers: authHeader(account.token),
      payload: reviseBody({ expectedCurrentRevisionId: revisionId }),
    });
    const newToken = revised.json().acceptanceToken as string;

    // Old link: still resolves (shows the OLD revision) but is not actionable.
    const oldRead = await app.inject({ method: "GET", url: `/public/quotes/${oldToken}` });
    expect(oldRead.json().state).toBe("expired");
    expect(oldRead.json().revision.totals.total).toBe("90.00");
    expect((await app.inject({ method: "POST", url: `/public/quotes/${oldToken}/accept` })).statusCode).toBe(409);

    // New link: open, shows the NEW revision, and can be accepted.
    const newRead = await app.inject({ method: "GET", url: `/public/quotes/${newToken}` });
    expect(newRead.json().state).toBe("open");
    expect(newRead.json().revision.totals.total).toBe("120.00");
    const accept = await app.inject({ method: "POST", url: `/public/quotes/${newToken}/accept` });
    expect(accept.statusCode).toBe(200);

    const doc = await prisma.quoteDocument.findUniqueOrThrow({ where: { id: quoteId } });
    expect(doc.status).toBe("ACCEPTED");
    expect(doc.acceptedRevisionId).toBe(doc.currentRevisionId);
    expect(doc.acceptedRevisionId).not.toBe(revisionId);
  });

  it("allows OWNER and ADMIN to revise, but not STAFF", async () => {
    const owner = await businessAccount(app);
    const adminToken = await addMember(app, owner.businessId, "ADMIN");
    const staffToken = await addMember(app, owner.businessId, "STAFF");

    const q1 = await sendQuote(app, owner.token);
    expect((await app.inject({ method: "POST", url: `/quotes/${q1.quoteId}/revise`, headers: authHeader(owner.token), payload: reviseBody({ expectedCurrentRevisionId: q1.revisionId }) })).statusCode).toBe(200);

    const q2 = await sendQuote(app, owner.token);
    expect((await app.inject({ method: "POST", url: `/quotes/${q2.quoteId}/revise`, headers: authHeader(adminToken), payload: reviseBody({ expectedCurrentRevisionId: q2.revisionId }) })).statusCode).toBe(200);

    const q3 = await sendQuote(app, owner.token);
    expect((await app.inject({ method: "POST", url: `/quotes/${q3.quoteId}/revise`, headers: authHeader(staffToken), payload: reviseBody({ expectedCurrentRevisionId: q3.revisionId }) })).statusCode).toBe(403);
  });

  it("returns 403 FEATURE_NOT_AVAILABLE for FREE and PRO", async () => {
    const biz = await businessAccount(app, "BUSINESS");
    const { quoteId, revisionId } = await sendQuote(app, biz.token);
    for (const plan of ["FREE", "PRO"] as const) {
      await setPlan(biz.businessId, plan);
      const res = await app.inject({ method: "POST", url: `/quotes/${quoteId}/revise`, headers: authHeader(biz.token), payload: reviseBody({ expectedCurrentRevisionId: revisionId }) });
      expect(res.statusCode).toBe(403);
    }
  });

  it("rejects revising a DRAFT (use PATCH) and any terminal document", async () => {
    const account = await businessAccount(app);
    const draft = await app.inject({ method: "POST", url: "/quotes", headers: authHeader(account.token), payload: { documentType: "QUOTE", lineItems: [{ description: "x", quantity: 1, unitPrice: "1.00" }] } });
    const draftRev = draft.json().currentRevision.id;
    expect((await app.inject({ method: "POST", url: `/quotes/${draft.json().id}/revise`, headers: authHeader(account.token), payload: reviseBody({ expectedCurrentRevisionId: draftRev }) })).statusCode).toBe(409);

    const q = await sendQuote(app, account.token);
    await app.inject({ method: "POST", url: `/quotes/${q.quoteId}/cancel`, headers: authHeader(account.token) });
    expect((await app.inject({ method: "POST", url: `/quotes/${q.quoteId}/revise`, headers: authHeader(account.token), payload: reviseBody({ expectedCurrentRevisionId: q.revisionId }) })).statusCode).toBe(409);
  });

  it("rejects a stale expectedCurrentRevisionId", async () => {
    const account = await businessAccount(app);
    const { quoteId, revisionId } = await sendQuote(app, account.token);
    await app.inject({ method: "POST", url: `/quotes/${quoteId}/revise`, headers: authHeader(account.token), payload: reviseBody({ expectedCurrentRevisionId: revisionId }) });
    const stale = await app.inject({ method: "POST", url: `/quotes/${quoteId}/revise`, headers: authHeader(account.token), payload: reviseBody({ expectedCurrentRevisionId: revisionId }) });
    expect(stale.statusCode).toBe(409);
  });

  it("rejects a revision with zero line items", async () => {
    const account = await businessAccount(app);
    const { quoteId, revisionId } = await sendQuote(app, account.token);
    const res = await app.inject({ method: "POST", url: `/quotes/${quoteId}/revise`, headers: authHeader(account.token), payload: { expectedCurrentRevisionId: revisionId, lineItems: [] } });
    expect(res.statusCode).toBe(400);
  });

  it("does not let another tenant revise", async () => {
    const a = await businessAccount(app);
    const b = await businessAccount(app);
    const { quoteId, revisionId } = await sendQuote(app, a.token);
    const res = await app.inject({ method: "POST", url: `/quotes/${quoteId}/revise`, headers: authHeader(b.token), payload: reviseBody({ expectedCurrentRevisionId: revisionId }) });
    expect(res.statusCode).toBe(404);
  });

  it("rejects unauthenticated and customer-scoped callers", async () => {
    const account = await businessAccount(app);
    const { quoteId, revisionId } = await sendQuote(app, account.token);
    expect((await app.inject({ method: "POST", url: `/quotes/${quoteId}/revise`, payload: reviseBody({ expectedCurrentRevisionId: revisionId }) })).statusCode).toBe(401);
    const cust = await app.inject({ method: "POST", url: "/customer/auth/register", payload: { email: `c${Date.now()}@x.com`, password: "password123", fullName: "C" } });
    expect((await app.inject({ method: "POST", url: `/quotes/${quoteId}/revise`, headers: authHeader(cust.json().accessToken), payload: reviseBody({ expectedCurrentRevisionId: revisionId }) })).statusCode).toBe(401);
  });

  it("resolves concurrent revises to exactly one winner, advancing the revision number once", async () => {
    const account = await businessAccount(app);
    const { quoteId, revisionId } = await sendQuote(app, account.token);
    const [r1, r2] = await Promise.all([
      app.inject({ method: "POST", url: `/quotes/${quoteId}/revise`, headers: authHeader(account.token), payload: reviseBody({ expectedCurrentRevisionId: revisionId }) }),
      app.inject({ method: "POST", url: `/quotes/${quoteId}/revise`, headers: authHeader(account.token), payload: reviseBody({ expectedCurrentRevisionId: revisionId }) }),
    ]);
    expect([r1.statusCode, r2.statusCode].sort()).toEqual([200, 409]);
    expect(await prisma.quoteRevision.count({ where: { quoteDocumentId: quoteId } })).toBe(2);
    expect(await prisma.quoteEvent.count({ where: { quoteDocumentId: quoteId, eventType: "REVISED" } })).toBe(1);
    expect((await prisma.quoteDocument.findUniqueOrThrow({ where: { id: quoteId } })).nextRevisionNumber).toBe(3);
  });
});
