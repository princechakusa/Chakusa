import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { BusinessRole } from "@prisma/client";
import { createTestApp, resetDatabase, registerAccount, authHeader, setPlan, setSubscriptionStatus } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { createSession } from "../src/modules/auth/auth.service.js";
import { buildPublicQuoteUrl } from "../src/lib/quotes/publicQuoteLinks.js";

// PROGRAM 3 LOOP 3G: quote delivery boundary - customer link assembly +
// re-issue. Provider-channel auto-delivery is intentionally out of scope.

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

async function draftAndSend(app: FastifyInstance, token: string) {
  const body = { documentType: "QUOTE", lineItems: [{ description: "Labor", quantity: 2, unitPrice: "50.00", discountAmount: "10.00" }] };
  const draft = await app.inject({ method: "POST", url: "/quotes", headers: authHeader(token), payload: body });
  const sent = await app.inject({ method: "POST", url: `/quotes/${draft.json().id}/send`, headers: authHeader(token) });
  if (sent.statusCode !== 200) throw new Error(`send failed: ${sent.body}`);
  return { quoteId: draft.json().id as string, revisionId: draft.json().currentRevision.id as string, sent: sent.json() };
}

const tokenFromUrl = (url: string) => url.split("/q/")[1]!;

describe("Quote delivery boundary (Program 3, Loop 3G)", () => {
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

  it("buildPublicQuoteUrl produces <base>/q/<token>", () => {
    expect(buildPublicQuoteUrl("abc.def")).toBe("http://localhost:19006/q/abc.def");
  });

  it("send response carries acceptanceUrl that resolves to the same quote", async () => {
    const account = await businessAccount(app);
    const { sent } = await draftAndSend(app, account.token);
    expect(sent.acceptanceUrl).toBe(`http://localhost:19006/q/${sent.acceptanceToken}`);

    const read = await app.inject({ method: "GET", url: `/public/quotes/${tokenFromUrl(sent.acceptanceUrl)}` });
    expect(read.statusCode).toBe(200);
    expect(read.json().state).toBe("open");
  });

  it("revise response carries acceptanceUrl for the new revision token", async () => {
    const account = await businessAccount(app);
    const { quoteId, revisionId } = await draftAndSend(app, account.token);
    const revised = await app.inject({
      method: "POST",
      url: `/quotes/${quoteId}/revise`,
      headers: authHeader(account.token),
      payload: { expectedCurrentRevisionId: revisionId, lineItems: [{ description: "New", quantity: 1, unitPrice: "10.00" }] },
    });
    expect(revised.json().acceptanceUrl).toBe(`http://localhost:19006/q/${revised.json().acceptanceToken}`);
    const read = await app.inject({ method: "GET", url: `/public/quotes/${tokenFromUrl(revised.json().acceptanceUrl)}` });
    expect(read.json().state).toBe("open");
    expect(read.json().revision.totals.total).toBe("10.00");
  });

  it("resend re-issues the link for a SENT quote: old link dies, new link works, revision unchanged", async () => {
    const account = await businessAccount(app);
    const { quoteId, revisionId, sent } = await draftAndSend(app, account.token);
    const oldToken = sent.acceptanceToken as string;

    const res = await app.inject({ method: "POST", url: `/quotes/${quoteId}/resend`, headers: authHeader(account.token) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.acceptanceToken).not.toBe(oldToken);
    expect(body.acceptanceUrl).toBe(`http://localhost:19006/q/${body.acceptanceToken}`);
    expect(body.quote.status).toBe("SENT");
    expect(body.quote.currentRevision.id).toBe(revisionId);
    expect(body.quote.currentRevision.revisionNumber).toBe(1);

    // Old link: revoked.
    expect((await app.inject({ method: "GET", url: `/public/quotes/${oldToken}` })).json().state).toBe("expired");
    expect((await app.inject({ method: "POST", url: `/public/quotes/${oldToken}/accept` })).statusCode).toBe(409);

    // New link: live and acceptable.
    const newToken = body.acceptanceToken as string;
    expect((await app.inject({ method: "GET", url: `/public/quotes/${newToken}` })).json().state).toBe("open");
    expect((await app.inject({ method: "POST", url: `/public/quotes/${newToken}/accept` })).statusCode).toBe(200);

    // Exactly one extra SENT event, flagged as a resend.
    const sentEvents = await prisma.quoteEvent.findMany({ where: { quoteDocumentId: quoteId, eventType: "SENT" }, orderBy: { createdAt: "asc" } });
    expect(sentEvents).toHaveLength(2);
    expect(sentEvents[0]!.metadata).toBeNull();
    expect(sentEvents[1]!.metadata).toEqual({ resend: true });
  });

  it("rejects resend for a quote that has passed its expiry date", async () => {
    const account = await businessAccount(app);
    const { quoteId } = await draftAndSend(app, account.token);
    await prisma.quoteDocument.update({ where: { id: quoteId }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    const res = await app.inject({ method: "POST", url: `/quotes/${quoteId}/resend`, headers: authHeader(account.token) });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toContain("expiry date");
  });

  it("rejects resend for a DRAFT or any terminal document", async () => {
    const account = await businessAccount(app);
    const draft = await app.inject({ method: "POST", url: "/quotes", headers: authHeader(account.token), payload: { documentType: "QUOTE", lineItems: [{ description: "x", quantity: 1, unitPrice: "1.00" }] } });
    expect((await app.inject({ method: "POST", url: `/quotes/${draft.json().id}/resend`, headers: authHeader(account.token) })).statusCode).toBe(409);

    const { quoteId } = await draftAndSend(app, account.token);
    await app.inject({ method: "POST", url: `/quotes/${quoteId}/cancel`, headers: authHeader(account.token) });
    expect((await app.inject({ method: "POST", url: `/quotes/${quoteId}/resend`, headers: authHeader(account.token) })).statusCode).toBe(409);
  });

  it("allows OWNER/ADMIN/STAFF to resend; blocks FREE/PRO by entitlement", async () => {
    const owner = await businessAccount(app);
    const staffToken = await addMember(app, owner.businessId, "STAFF");
    const q1 = await draftAndSend(app, owner.token);
    expect((await app.inject({ method: "POST", url: `/quotes/${q1.quoteId}/resend`, headers: authHeader(staffToken) })).statusCode).toBe(200);

    const q2 = await draftAndSend(app, owner.token);
    await setPlan(owner.businessId, "PRO");
    expect((await app.inject({ method: "POST", url: `/quotes/${q2.quoteId}/resend`, headers: authHeader(owner.token) })).statusCode).toBe(403);
  });

  it("does not let another tenant resend, and rejects unauthenticated / customer callers", async () => {
    const a = await businessAccount(app);
    const b = await businessAccount(app);
    const { quoteId } = await draftAndSend(app, a.token);
    expect((await app.inject({ method: "POST", url: `/quotes/${quoteId}/resend`, headers: authHeader(b.token) })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/quotes/${quoteId}/resend` })).statusCode).toBe(401);
    const cust = await app.inject({ method: "POST", url: "/customer/auth/register", payload: { email: `c${Date.now()}@x.com`, password: "password123", fullName: "C" } });
    expect((await app.inject({ method: "POST", url: `/quotes/${quoteId}/resend`, headers: authHeader(cust.json().accessToken) })).statusCode).toBe(401);
  });

  it("resolves a concurrent resend + accept(current link) to exactly one winner", async () => {
    const account = await businessAccount(app);
    const { quoteId, sent } = await draftAndSend(app, account.token);
    const [resendRes, acceptRes] = await Promise.all([
      app.inject({ method: "POST", url: `/quotes/${quoteId}/resend`, headers: authHeader(account.token) }),
      app.inject({ method: "POST", url: `/public/quotes/${sent.acceptanceToken}/accept` }),
    ]);
    const doc = await prisma.quoteDocument.findUniqueOrThrow({ where: { id: quoteId } });
    if (acceptRes.statusCode === 200) {
      expect(doc.status).toBe("ACCEPTED");
      expect(resendRes.statusCode).toBe(409);
    } else {
      expect(doc.status).toBe("SENT");
      expect(resendRes.statusCode).toBe(200);
      expect(acceptRes.statusCode).toBe(409);
      const liveTokens = await prisma.quoteAcceptanceToken.count({ where: { quoteRevision: { quoteDocumentId: quoteId }, revokedAt: null } });
      expect(liveTokens).toBe(1);
    }
  });
});
