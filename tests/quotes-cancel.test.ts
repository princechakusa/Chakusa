import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { BusinessRole } from "@prisma/client";
import { createTestApp, resetDatabase, registerAccount, authHeader, setPlan, setSubscriptionStatus } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { createSession } from "../src/modules/auth/auth.service.js";

// PROGRAM 3 LOOP 3F.1: business cancellation of a SENT quote.

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
  return app.jwt.sign({ userId: user.id, sessionId: session.id, type: "access" }, { expiresIn: 900 });
}

async function sendQuote(app: FastifyInstance, token: string) {
  const body = { documentType: "QUOTE", lineItems: [{ description: "Labor", quantity: 1, unitPrice: "100.00" }] };
  const draft = await app.inject({ method: "POST", url: "/quotes", headers: authHeader(token), payload: body });
  const sent = await app.inject({ method: "POST", url: `/quotes/${draft.json().id}/send`, headers: authHeader(token) });
  if (sent.statusCode !== 200) throw new Error(`send failed: ${sent.body}`);
  return { quoteId: draft.json().id as string, revisionId: draft.json().currentRevision.id as string, rawToken: sent.json().acceptanceToken as string };
}

describe("Business quote cancel (Program 3, Loop 3F.1)", () => {
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

  it("cancels a SENT quote: CANCELED status, tokens revoked, one BUSINESS_MEMBER event", async () => {
    const account = await businessAccount(app);
    const { quoteId, revisionId, rawToken } = await sendQuote(app, account.token);

    const res = await app.inject({ method: "POST", url: `/quotes/${quoteId}/cancel`, headers: authHeader(account.token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("CANCELED");

    const doc = await prisma.quoteDocument.findUniqueOrThrow({ where: { id: quoteId } });
    expect(doc.status).toBe("CANCELED");
    expect(doc.acceptedRevisionId).toBeNull();

    const token = await prisma.quoteAcceptanceToken.findFirstOrThrow({ where: { quoteRevisionId: revisionId } });
    expect(token.revokedAt).not.toBeNull();

    const events = await prisma.quoteEvent.findMany({ where: { quoteDocumentId: quoteId, eventType: "CANCELED" } });
    expect(events).toHaveLength(1);
    expect(events[0]!.actorType).toBe("BUSINESS_MEMBER");
    expect(events[0]!.actorId).not.toBeNull();

    // Customer link now resolves read-only as "canceled" and cannot be actioned.
    const read = await app.inject({ method: "GET", url: `/public/quotes/${rawToken}` });
    expect(read.json().state).toBe("canceled");
    const accept = await app.inject({ method: "POST", url: `/public/quotes/${rawToken}/accept` });
    expect(accept.statusCode).toBe(409);
  });

  it("allows OWNER and ADMIN to cancel, but not STAFF", async () => {
    const owner = await businessAccount(app);
    const adminToken = await addMember(app, owner.businessId, "ADMIN");
    const staffToken = await addMember(app, owner.businessId, "STAFF");

    const q1 = await sendQuote(app, owner.token);
    expect((await app.inject({ method: "POST", url: `/quotes/${q1.quoteId}/cancel`, headers: authHeader(owner.token) })).statusCode).toBe(200);

    const q2 = await sendQuote(app, owner.token);
    expect((await app.inject({ method: "POST", url: `/quotes/${q2.quoteId}/cancel`, headers: authHeader(adminToken) })).statusCode).toBe(200);

    const q3 = await sendQuote(app, owner.token);
    const staffRes = await app.inject({ method: "POST", url: `/quotes/${q3.quoteId}/cancel`, headers: authHeader(staffToken) });
    expect(staffRes.statusCode).toBe(403);
    expect((await prisma.quoteDocument.findUniqueOrThrow({ where: { id: q3.quoteId } })).status).toBe("SENT");
  });

  it("returns 403 FEATURE_NOT_AVAILABLE for FREE and PRO", async () => {
    const biz = await businessAccount(app, "BUSINESS");
    const { quoteId } = await sendQuote(app, biz.token);
    for (const plan of ["FREE", "PRO"] as const) {
      await setPlan(biz.businessId, plan);
      const res = await app.inject({ method: "POST", url: `/quotes/${quoteId}/cancel`, headers: authHeader(biz.token) });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("FEATURE_NOT_AVAILABLE");
    }
  });

  it("rejects canceling a DRAFT (409) - drafts are deleted, not canceled", async () => {
    const account = await businessAccount(app);
    const draft = await app.inject({ method: "POST", url: "/quotes", headers: authHeader(account.token), payload: { documentType: "QUOTE" } });
    const res = await app.inject({ method: "POST", url: `/quotes/${draft.json().id}/cancel`, headers: authHeader(account.token) });
    expect(res.statusCode).toBe(409);
  });

  it("rejects a second cancel and cancel of an accepted/declined quote", async () => {
    const account = await businessAccount(app);
    const c = await sendQuote(app, account.token);
    expect((await app.inject({ method: "POST", url: `/quotes/${c.quoteId}/cancel`, headers: authHeader(account.token) })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/quotes/${c.quoteId}/cancel`, headers: authHeader(account.token) })).statusCode).toBe(409);

    const a = await sendQuote(app, account.token);
    await app.inject({ method: "POST", url: `/public/quotes/${a.rawToken}/accept` });
    expect((await app.inject({ method: "POST", url: `/quotes/${a.quoteId}/cancel`, headers: authHeader(account.token) })).statusCode).toBe(409);
  });

  it("does not let another tenant cancel the quote", async () => {
    const a = await businessAccount(app);
    const b = await businessAccount(app);
    const { quoteId } = await sendQuote(app, a.token);
    const res = await app.inject({ method: "POST", url: `/quotes/${quoteId}/cancel`, headers: authHeader(b.token) });
    expect(res.statusCode).toBe(404);
    expect((await prisma.quoteDocument.findUniqueOrThrow({ where: { id: quoteId } })).status).toBe("SENT");
  });

  it("rejects unauthenticated and customer-scoped callers", async () => {
    const account = await businessAccount(app);
    const { quoteId } = await sendQuote(app, account.token);
    expect((await app.inject({ method: "POST", url: `/quotes/${quoteId}/cancel` })).statusCode).toBe(401);
    const cust = await app.inject({ method: "POST", url: "/customer/auth/register", payload: { email: `c${Date.now()}@x.com`, password: "password123", fullName: "C" } });
    const res = await app.inject({ method: "POST", url: `/quotes/${quoteId}/cancel`, headers: authHeader(cust.json().accessToken) });
    expect(res.statusCode).toBe(401);
  });

  it("resolves a concurrent business-cancel vs customer-accept to exactly one winner", async () => {
    const account = await businessAccount(app);
    const { quoteId, rawToken } = await sendQuote(app, account.token);
    const [cancelRes, acceptRes] = await Promise.all([
      app.inject({ method: "POST", url: `/quotes/${quoteId}/cancel`, headers: authHeader(account.token) }),
      app.inject({ method: "POST", url: `/public/quotes/${rawToken}/accept` }),
    ]);
    expect([cancelRes.statusCode, acceptRes.statusCode].sort()).toEqual([200, 409]);
    const doc = await prisma.quoteDocument.findUniqueOrThrow({ where: { id: quoteId } });
    expect(["CANCELED", "ACCEPTED"]).toContain(doc.status);
    const terminalEvents = await prisma.quoteEvent.count({ where: { quoteDocumentId: quoteId, eventType: { in: ["CANCELED", "ACCEPTED"] } } });
    expect(terminalEvents).toBe(1);
  });
});
