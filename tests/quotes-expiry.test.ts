import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, resetDatabase, registerAccount, authHeader, setPlan, setSubscriptionStatus } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { sweepExpiredQuotes } from "../src/lib/quotes/quoteExpiry.js";

// PROGRAM 3 LOOP 3F.2: worker-driven expiration of over-deadline SENT quotes.

async function businessAccount(app: FastifyInstance) {
  const account = await registerAccount(app);
  await setPlan(account.businessId, "BUSINESS");
  await setSubscriptionStatus(account.businessId, "ACTIVE");
  return account;
}

async function sendQuote(app: FastifyInstance, token: string) {
  const inAWeek = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const body = { documentType: "QUOTE", expiresAt: inAWeek, lineItems: [{ description: "Labor", quantity: 1, unitPrice: "100.00" }] };
  const draft = await app.inject({ method: "POST", url: "/quotes", headers: authHeader(token), payload: body });
  const sent = await app.inject({ method: "POST", url: `/quotes/${draft.json().id}/send`, headers: authHeader(token) });
  if (sent.statusCode !== 200) throw new Error(`send failed: ${sent.body}`);
  return { quoteId: draft.json().id as string, revisionId: draft.json().currentRevision.id as string, rawToken: sent.json().acceptanceToken as string };
}

/** Simulates the commercial deadline passing. */
function backdateExpiry(quoteId: string) {
  return prisma.quoteDocument.update({ where: { id: quoteId }, data: { expiresAt: new Date(Date.now() - 60_000) } });
}

describe("Quote expiration sweep (Program 3, Loop 3F.2)", () => {
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

  it("expires a SENT quote past its deadline: EXPIRED status, tokens revoked, one SYSTEM event", async () => {
    const account = await businessAccount(app);
    const { quoteId, revisionId, rawToken } = await sendQuote(app, account.token);
    await backdateExpiry(quoteId);

    const result = await sweepExpiredQuotes();
    expect(result.expired).toBe(1);

    const doc = await prisma.quoteDocument.findUniqueOrThrow({ where: { id: quoteId } });
    expect(doc.status).toBe("EXPIRED");

    const token = await prisma.quoteAcceptanceToken.findFirstOrThrow({ where: { quoteRevisionId: revisionId } });
    expect(token.revokedAt).not.toBeNull();

    const events = await prisma.quoteEvent.findMany({ where: { quoteDocumentId: quoteId, eventType: "EXPIRED" } });
    expect(events).toHaveLength(1);
    expect(events[0]!.actorType).toBe("SYSTEM");
    expect(events[0]!.actorId).toBeNull();

    // Business + customer surfaces reflect the terminal state.
    const detail = await app.inject({ method: "GET", url: `/quotes/${quoteId}`, headers: authHeader(account.token) });
    expect(detail.json().status).toBe("EXPIRED");
    const read = await app.inject({ method: "GET", url: `/public/quotes/${rawToken}` });
    expect(read.json().state).toBe("expired");
    expect((await app.inject({ method: "POST", url: `/public/quotes/${rawToken}/accept` })).statusCode).toBe(409);
  });

  it("leaves a SENT quote with a future deadline untouched", async () => {
    const account = await businessAccount(app);
    const { quoteId } = await sendQuote(app, account.token);
    const result = await sweepExpiredQuotes();
    expect(result.expired).toBe(0);
    expect((await prisma.quoteDocument.findUniqueOrThrow({ where: { id: quoteId } })).status).toBe("SENT");
    expect(await prisma.quoteEvent.count({ where: { quoteDocumentId: quoteId, eventType: "EXPIRED" } })).toBe(0);
  });

  it("ignores quotes with no deadline and quotes already in a terminal state", async () => {
    const account = await businessAccount(app);

    // No deadline.
    const noDeadlineDraft = await app.inject({ method: "POST", url: "/quotes", headers: authHeader(account.token), payload: { documentType: "QUOTE", lineItems: [{ description: "x", quantity: 1, unitPrice: "1.00" }] } });
    await app.inject({ method: "POST", url: `/quotes/${noDeadlineDraft.json().id}/send`, headers: authHeader(account.token) });

    // Accepted, then backdated - must NOT be swept (not SENT).
    const accepted = await sendQuote(app, account.token);
    await app.inject({ method: "POST", url: `/public/quotes/${accepted.rawToken}/accept` });
    await prisma.quoteDocument.update({ where: { id: accepted.quoteId }, data: { expiresAt: new Date(Date.now() - 60_000) } });

    const result = await sweepExpiredQuotes();
    expect(result.expired).toBe(0);
    expect((await prisma.quoteDocument.findUniqueOrThrow({ where: { id: accepted.quoteId } })).status).toBe("ACCEPTED");
  });

  it("is idempotent across repeated sweeps", async () => {
    const account = await businessAccount(app);
    const { quoteId, revisionId } = await sendQuote(app, account.token);
    await backdateExpiry(quoteId);

    expect((await sweepExpiredQuotes()).expired).toBe(1);
    const tokenAfterFirst = await prisma.quoteAcceptanceToken.findFirstOrThrow({ where: { quoteRevisionId: revisionId } });

    expect((await sweepExpiredQuotes()).expired).toBe(0);
    expect(await prisma.quoteEvent.count({ where: { quoteDocumentId: quoteId, eventType: "EXPIRED" } })).toBe(1);
    const tokenAfterSecond = await prisma.quoteAcceptanceToken.findFirstOrThrow({ where: { quoteRevisionId: revisionId } });
    expect(tokenAfterSecond.revokedAt!.getTime()).toBe(tokenAfterFirst.revokedAt!.getTime());
  });

  it("respects the batch size bound", async () => {
    const account = await businessAccount(app);
    for (let i = 0; i < 3; i++) {
      const { quoteId } = await sendQuote(app, account.token);
      await backdateExpiry(quoteId);
    }
    expect((await sweepExpiredQuotes(new Date(), 2)).expired).toBe(2);
    expect((await sweepExpiredQuotes(new Date(), 2)).expired).toBe(1);
    expect((await sweepExpiredQuotes(new Date(), 2)).expired).toBe(0);
  });
});
