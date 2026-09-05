import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, resetDatabase, registerAccount, authHeader, setPlan, setSubscriptionStatus } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { hashToken } from "../src/lib/authTokens.js";

// PROGRAM 3 LOOP 3D: account-less customer quote access via the
// revision-bound bearer token from POST /quotes/:id/send.

async function businessAccount(app: FastifyInstance) {
  const account = await registerAccount(app);
  await setPlan(account.businessId, "BUSINESS");
  await setSubscriptionStatus(account.businessId, "ACTIVE");
  return account;
}

function createBody(over: Record<string, unknown> = {}) {
  return { documentType: "QUOTE", notes: "Thanks for your business", terms: "Valid 30 days", lineItems: [{ description: "Labor", quantity: 2, unitPrice: "50.00", discountAmount: "10.00" }], ...over };
}

async function sendQuote(app: FastifyInstance, token: string, over: Record<string, unknown> = {}) {
  const draft = await app.inject({ method: "POST", url: "/quotes", headers: authHeader(token), payload: createBody(over) });
  if (draft.statusCode !== 201) throw new Error(`draft create failed: ${draft.body}`);
  const sent = await app.inject({ method: "POST", url: `/quotes/${draft.json().id}/send`, headers: authHeader(token) });
  if (sent.statusCode !== 200) throw new Error(`send failed: ${sent.body}`);
  return { quoteId: draft.json().id as string, documentNumber: draft.json().documentNumber as string, currentRevisionId: draft.json().currentRevision.id as string, rawToken: sent.json().acceptanceToken as string };
}

describe("Public quote access (Program 3, Loop 3D)", () => {
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

  it("resolves a valid token to a safe read model of the bound revision", async () => {
    const account = await businessAccount(app);
    const { documentNumber, rawToken } = await sendQuote(app, account.token);

    const res = await app.inject({ method: "GET", url: `/public/quotes/${rawToken}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.state).toBe("open");
    expect(body.documentType).toBe("QUOTE");
    expect(body.documentNumber).toBe(documentNumber);
    expect(body.currency).toBe("USD");
    expect(body.business).toEqual({ name: "Test Business" });
    expect(body.revision.notes).toBe("Thanks for your business");
    expect(body.revision.terms).toBe("Valid 30 days");
    expect(body.revision.totals).toEqual({ subtotal: "100.00", discountTotal: "10.00", taxTotal: "0.00", total: "90.00" });
    expect(body.revision.lineItems).toEqual([
      { description: "Labor", quantity: "2.00", unitPrice: "50.00", discountAmount: "10.00", taxable: false, lineTotal: "90.00" },
    ]);
  });

  it("never exposes internal identifiers, token metadata, or tenant data", async () => {
    const account = await businessAccount(app);
    const { rawToken, quoteId, currentRevisionId } = await sendQuote(app, account.token);
    const res = await app.inject({ method: "GET", url: `/public/quotes/${rawToken}` });

    const raw = res.body;
    for (const forbidden of ["tokenHash", "token_hash", "businessId", "business_id", "customerId", "createdByMemberId", "revokedAt", account.businessId, quoteId, currentRevisionId, hashToken(rawToken)]) {
      expect(raw).not.toContain(forbidden);
    }
    // The document id / revision id / any id key must be absent from the model.
    const body = res.json();
    expect(body).not.toHaveProperty("id");
    expect(body.revision).not.toHaveProperty("id");
    expect(body.business).not.toHaveProperty("id");
  });

  it("returns a generic 404 for a malformed token", async () => {
    const res = await app.inject({ method: "GET", url: "/public/quotes/not-a-real-token" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.message).toBe("This link is invalid or no longer available");
  });

  it("returns a generic 404 for a well-formed but unknown token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/public/quotes/00000000-0000-4000-8000-000000000000.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns a generic 404 when the token id is real but the secret is wrong (hash mismatch)", async () => {
    const account = await businessAccount(app);
    const { rawToken } = await sendQuote(app, account.token);
    const tokenId = rawToken.split(".")[0];
    const forged = `${tokenId}.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`;
    const res = await app.inject({ method: "GET", url: `/public/quotes/${forged}` });
    expect(res.statusCode).toBe(404);
  });

  it("still resolves an expired token but reports state 'expired' with the content", async () => {
    const account = await businessAccount(app);
    const { rawToken } = await sendQuote(app, account.token);
    await prisma.quoteAcceptanceToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    const res = await app.inject({ method: "GET", url: `/public/quotes/${rawToken}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().state).toBe("expired");
    expect(res.json().revision.totals.total).toBe("90.00");
  });

  it("reports state 'expired' for a revoked token", async () => {
    const account = await businessAccount(app);
    const { rawToken } = await sendQuote(app, account.token);
    await prisma.quoteAcceptanceToken.updateMany({ data: { revokedAt: new Date() } });

    const res = await app.inject({ method: "GET", url: `/public/quotes/${rawToken}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().state).toBe("expired");
  });

  it("returns 404 (no leak) when the owning business is suspended by Chakusa", async () => {
    const account = await businessAccount(app);
    const { rawToken } = await sendQuote(app, account.token);
    await prisma.business.update({ where: { id: account.businessId }, data: { platformStatus: "SUSPENDED" } });

    const res = await app.inject({ method: "GET", url: `/public/quotes/${rawToken}` });
    expect(res.statusCode).toBe(404);
  });

  it("maps terminal document statuses to the matching state", async () => {
    const account = await businessAccount(app);
    const { rawToken, quoteId, currentRevisionId } = await sendQuote(app, account.token);

    for (const [status, expected] of [["DECLINED", "declined"], ["CANCELED", "canceled"], ["EXPIRED", "expired"]] as const) {
      await prisma.quoteDocument.update({ where: { id: quoteId }, data: { status } });
      const res = await app.inject({ method: "GET", url: `/public/quotes/${rawToken}` });
      expect(res.statusCode).toBe(200);
      expect(res.json().state).toBe(expected);
    }

    // ACCEPTED additionally requires acceptedRevisionId (Loop 3A CHECK constraint).
    await prisma.quoteDocument.update({ where: { id: quoteId }, data: { status: "ACCEPTED", acceptedRevisionId: currentRevisionId } });
    const accepted = await app.inject({ method: "GET", url: `/public/quotes/${rawToken}` });
    expect(accepted.json().state).toBe("accepted");
  });

  it("each token resolves only its own quote (no cross-token bleed)", async () => {
    const a = await businessAccount(app);
    const b = await businessAccount(app);
    const qa = await sendQuote(app, a.token);
    const qb = await sendQuote(app, b.token, { lineItems: [{ description: "Other work", quantity: 1, unitPrice: "999.00" }] });

    const ra = await app.inject({ method: "GET", url: `/public/quotes/${qa.rawToken}` });
    const rb = await app.inject({ method: "GET", url: `/public/quotes/${qb.rawToken}` });
    expect(ra.json().documentNumber).toBe(qa.documentNumber);
    expect(ra.body).not.toContain("Other work");
    expect(rb.json().documentNumber).toBe(qb.documentNumber);
    expect(rb.json().revision.lineItems[0].description).toBe("Other work");
  });

  it("does not require authentication", async () => {
    const account = await businessAccount(app);
    const { rawToken } = await sendQuote(app, account.token);
    // No Authorization header at all.
    const res = await app.inject({ method: "GET", url: `/public/quotes/${rawToken}` });
    expect(res.statusCode).toBe(200);
  });
});
