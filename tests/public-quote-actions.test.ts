import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, resetDatabase, registerAccount, authHeader, setPlan, setSubscriptionStatus } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

// PROGRAM 3 LOOP 3E: customer accept / decline of a SENT quote.

async function businessAccount(app: FastifyInstance) {
  const account = await registerAccount(app);
  await setPlan(account.businessId, "BUSINESS");
  await setSubscriptionStatus(account.businessId, "ACTIVE");
  return account;
}

async function sendQuote(app: FastifyInstance, token: string, over: Record<string, unknown> = {}) {
  const body = { documentType: "QUOTE", lineItems: [{ description: "Labor", quantity: 2, unitPrice: "50.00", discountAmount: "10.00" }], ...over };
  const draft = await app.inject({ method: "POST", url: "/quotes", headers: authHeader(token), payload: body });
  if (draft.statusCode !== 201) throw new Error(`draft create failed: ${draft.body}`);
  const sent = await app.inject({ method: "POST", url: `/quotes/${draft.json().id}/send`, headers: authHeader(token) });
  if (sent.statusCode !== 200) throw new Error(`send failed: ${sent.body}`);
  return {
    quoteId: draft.json().id as string,
    revisionId: draft.json().currentRevision.id as string,
    rawToken: sent.json().acceptanceToken as string,
  };
}

describe("Public quote accept / decline (Program 3, Loop 3E)", () => {
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

  it("accepts a SENT quote: ACCEPTED status, acceptedRevisionId bound to the offered revision, one CUSTOMER event, token spent", async () => {
    const account = await businessAccount(app);
    const { quoteId, revisionId, rawToken } = await sendQuote(app, account.token);

    const res = await app.inject({ method: "POST", url: `/public/quotes/${rawToken}/accept` });
    expect(res.statusCode).toBe(200);
    expect(res.json().state).toBe("accepted");

    const doc = await prisma.quoteDocument.findUniqueOrThrow({ where: { id: quoteId } });
    expect(doc.status).toBe("ACCEPTED");
    expect(doc.acceptedRevisionId).toBe(revisionId);
    expect(doc.currentRevisionId).toBe(revisionId);

    const events = await prisma.quoteEvent.findMany({ where: { quoteDocumentId: quoteId, eventType: "ACCEPTED" } });
    expect(events).toHaveLength(1);
    expect(events[0]!.actorType).toBe("CUSTOMER");
    expect(events[0]!.actorId).toBeNull();
    expect(events[0]!.quoteRevisionId).toBe(revisionId);

    const tokens = await prisma.quoteAcceptanceToken.findMany({ where: { quoteRevisionId: revisionId } });
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.revokedAt).not.toBeNull();
  });

  it("declines a SENT quote: DECLINED status, acceptedRevisionId stays null, one CUSTOMER event, token spent", async () => {
    const account = await businessAccount(app);
    const { quoteId, revisionId, rawToken } = await sendQuote(app, account.token);

    const res = await app.inject({ method: "POST", url: `/public/quotes/${rawToken}/decline`, payload: { note: "Too expensive right now" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().state).toBe("declined");

    const doc = await prisma.quoteDocument.findUniqueOrThrow({ where: { id: quoteId } });
    expect(doc.status).toBe("DECLINED");
    expect(doc.acceptedRevisionId).toBeNull();

    const events = await prisma.quoteEvent.findMany({ where: { quoteDocumentId: quoteId, eventType: "DECLINED" } });
    expect(events).toHaveLength(1);
    expect(events[0]!.actorType).toBe("CUSTOMER");
    expect(events[0]!.metadata).toEqual({ note: "Too expensive right now" });

    const token = await prisma.quoteAcceptanceToken.findFirstOrThrow({ where: { quoteRevisionId: revisionId } });
    expect(token.revokedAt).not.toBeNull();
  });

  it("preserves the immutable revision snapshot on accept", async () => {
    const account = await businessAccount(app);
    const { revisionId, rawToken } = await sendQuote(app, account.token);
    const revBefore = await prisma.quoteRevision.findUniqueOrThrow({ where: { id: revisionId } });
    const itemsBefore = await prisma.quoteLineItem.findMany({ where: { quoteRevisionId: revisionId }, orderBy: { sortOrder: "asc" } });

    await app.inject({ method: "POST", url: `/public/quotes/${rawToken}/accept` });

    expect(await prisma.quoteRevision.findUniqueOrThrow({ where: { id: revisionId } })).toEqual(revBefore);
    expect(await prisma.quoteLineItem.findMany({ where: { quoteRevisionId: revisionId }, orderBy: { sortOrder: "asc" } })).toEqual(itemsBefore);
  });

  it("rejects a second accept (no double-accept), keeping exactly one event", async () => {
    const account = await businessAccount(app);
    const { quoteId, rawToken } = await sendQuote(app, account.token);
    expect((await app.inject({ method: "POST", url: `/public/quotes/${rawToken}/accept` })).statusCode).toBe(200);
    const again = await app.inject({ method: "POST", url: `/public/quotes/${rawToken}/accept` });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.message).toBe("This quote has already been accepted");
    expect(await prisma.quoteEvent.count({ where: { quoteDocumentId: quoteId, eventType: "ACCEPTED" } })).toBe(1);
  });

  it("rejects accept-after-decline and decline-after-accept", async () => {
    const account = await businessAccount(app);
    const declined = await sendQuote(app, account.token);
    await app.inject({ method: "POST", url: `/public/quotes/${declined.rawToken}/decline` });
    const acceptAfterDecline = await app.inject({ method: "POST", url: `/public/quotes/${declined.rawToken}/accept` });
    expect(acceptAfterDecline.statusCode).toBe(409);
    expect(acceptAfterDecline.json().error.message).toBe("This quote has already been declined");

    const accepted = await sendQuote(app, account.token);
    await app.inject({ method: "POST", url: `/public/quotes/${accepted.rawToken}/accept` });
    const declineAfterAccept = await app.inject({ method: "POST", url: `/public/quotes/${accepted.rawToken}/decline` });
    expect(declineAfterAccept.statusCode).toBe(409);
    expect(declineAfterAccept.json().error.message).toBe("This quote has already been accepted");
  });

  it("rejects action on an expired token", async () => {
    const account = await businessAccount(app);
    const { quoteId, rawToken } = await sendQuote(app, account.token);
    await prisma.quoteAcceptanceToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await app.inject({ method: "POST", url: `/public/quotes/${rawToken}/accept` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toBe("This quote has expired and can no longer be actioned");
    expect((await prisma.quoteDocument.findUniqueOrThrow({ where: { id: quoteId } })).status).toBe("SENT");
  });

  it("rejects action on a revoked token without changing state", async () => {
    const account = await businessAccount(app);
    const { quoteId, rawToken } = await sendQuote(app, account.token);
    await prisma.quoteAcceptanceToken.updateMany({ data: { revokedAt: new Date() } });
    const res = await app.inject({ method: "POST", url: `/public/quotes/${rawToken}/accept` });
    expect(res.statusCode).toBe(409);
    expect((await prisma.quoteDocument.findUniqueOrThrow({ where: { id: quoteId } })).status).toBe("SENT");
    expect(await prisma.quoteEvent.count({ where: { quoteDocumentId: quoteId, eventType: "ACCEPTED" } })).toBe(0);
  });

  it("returns a generic 404 for malformed / unknown / forged tokens", async () => {
    const account = await businessAccount(app);
    const { rawToken } = await sendQuote(app, account.token);
    const tokenId = rawToken.split(".")[0];

    expect((await app.inject({ method: "POST", url: "/public/quotes/not-a-token/accept" })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/public/quotes/00000000-0000-4000-8000-000000000000.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/accept" })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/public/quotes/${tokenId}.wrongsecretwrongsecretwrongsecretwrongsecretwrongsecretwrong/accept` })).statusCode).toBe(404);
  });

  it("returns 404 (no leak) when the owning business is suspended", async () => {
    const account = await businessAccount(app);
    const { rawToken } = await sendQuote(app, account.token);
    await prisma.business.update({ where: { id: account.businessId }, data: { platformStatus: "SUSPENDED" } });
    expect((await app.inject({ method: "POST", url: `/public/quotes/${rawToken}/accept` })).statusCode).toBe(404);
  });

  it("resolves exactly one winner for concurrent accepts", async () => {
    const account = await businessAccount(app);
    const { quoteId, rawToken } = await sendQuote(app, account.token);
    const [r1, r2] = await Promise.all([
      app.inject({ method: "POST", url: `/public/quotes/${rawToken}/accept` }),
      app.inject({ method: "POST", url: `/public/quotes/${rawToken}/accept` }),
    ]);
    expect([r1.statusCode, r2.statusCode].sort()).toEqual([200, 409]);
    expect(await prisma.quoteEvent.count({ where: { quoteDocumentId: quoteId, eventType: "ACCEPTED" } })).toBe(1);
    expect((await prisma.quoteDocument.findUniqueOrThrow({ where: { id: quoteId } })).status).toBe("ACCEPTED");
  });

  it("resolves exactly one winner for a concurrent accept + decline", async () => {
    const account = await businessAccount(app);
    const { quoteId, rawToken } = await sendQuote(app, account.token);
    const [acc, dec] = await Promise.all([
      app.inject({ method: "POST", url: `/public/quotes/${rawToken}/accept` }),
      app.inject({ method: "POST", url: `/public/quotes/${rawToken}/decline` }),
    ]);
    expect([acc.statusCode, dec.statusCode].sort()).toEqual([200, 409]);
    const doc = await prisma.quoteDocument.findUniqueOrThrow({ where: { id: quoteId } });
    expect(["ACCEPTED", "DECLINED"]).toContain(doc.status);
    const totalDecisionEvents = await prisma.quoteEvent.count({ where: { quoteDocumentId: quoteId, eventType: { in: ["ACCEPTED", "DECLINED"] } } });
    expect(totalDecisionEvents).toBe(1);
  });

  it("does not create any invoice / appointment / payment side effects", async () => {
    const account = await businessAccount(app);
    const apptBefore = await prisma.appointment.count();
    const txBefore = await prisma.appointmentPaymentTransaction.count();
    const { rawToken } = await sendQuote(app, account.token);
    await app.inject({ method: "POST", url: `/public/quotes/${rawToken}/accept` });
    expect(await prisma.appointment.count()).toBe(apptBefore);
    expect(await prisma.appointmentPaymentTransaction.count()).toBe(txBefore);
  });

  it("keeps the read link working after a decision, showing the terminal state", async () => {
    const account = await businessAccount(app);
    const { rawToken } = await sendQuote(app, account.token);
    await app.inject({ method: "POST", url: `/public/quotes/${rawToken}/accept` });
    const read = await app.inject({ method: "GET", url: `/public/quotes/${rawToken}` });
    expect(read.statusCode).toBe(200);
    expect(read.json().state).toBe("accepted");
  });

  it("does not require authentication", async () => {
    const account = await businessAccount(app);
    const { rawToken } = await sendQuote(app, account.token);
    const res = await app.inject({ method: "POST", url: `/public/quotes/${rawToken}/decline` });
    expect(res.statusCode).toBe(200);
  });
});
