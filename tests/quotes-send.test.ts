import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { BusinessRole } from "@prisma/client";
import { createTestApp, resetDatabase, registerAccount, authHeader, setPlan, setSubscriptionStatus } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { createSession } from "../src/modules/auth/auth.service.js";
import { canSendQuote } from "../src/lib/quotes/quotes.domain.js";
import { hashToken } from "../src/lib/authTokens.js";

// PROGRAM 3 LOOP 3C: secure DRAFT -> SENT + acceptance-token foundation.

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
  const token = app.jwt.sign({ userId: user.id, sessionId: session.id, type: "access" }, { expiresIn: 900 });
  return { userId: user.id, token };
}

async function registerCustomerToken(app: FastifyInstance) {
  const email = `cust-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const res = await app.inject({ method: "POST", url: "/customer/auth/register", payload: { email, password: "password123", fullName: "Casey Customer" } });
  if (res.statusCode !== 201) throw new Error(`customer register failed: ${res.body}`);
  return res.json().accessToken as string;
}

function createBody(over: Record<string, unknown> = {}) {
  return { documentType: "QUOTE", lineItems: [{ description: "Labor", quantity: 2, unitPrice: "50.00", discountAmount: "10.00" }], ...over };
}

async function createDraft(app: FastifyInstance, token: string, over: Record<string, unknown> = {}) {
  const res = await app.inject({ method: "POST", url: "/quotes", headers: authHeader(token), payload: createBody(over) });
  if (res.statusCode !== 201) throw new Error(`draft create failed: ${res.body}`);
  return res.json();
}

describe("Quote send: DRAFT -> SENT (Program 3, Loop 3C)", () => {
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

  // --- successful send -------------------------------------------------

  it("transitions DRAFT to SENT, freezes the current revision, issues one hashed token and one SENT event", async () => {
    const account = await businessAccount(app);
    const h = authHeader(account.token);
    const draft = await createDraft(app, account.token);
    const revisionId = draft.currentRevision.id;
    const lineItemsBefore = await prisma.quoteLineItem.findMany({ where: { quoteRevisionId: revisionId }, orderBy: { sortOrder: "asc" } });

    const res = await app.inject({ method: "POST", url: `/quotes/${draft.id}/send`, headers: h });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Response shape: safe quote detail + one-time raw token.
    expect(body.quote.status).toBe("SENT");
    expect(body.quote.id).toBe(draft.id);
    expect(typeof body.acceptanceToken).toBe("string");
    expect(body.acceptanceToken.length).toBeGreaterThan(40);
    expect(JSON.stringify(body.quote)).not.toContain("tokenHash");
    expect(JSON.stringify(body.quote)).not.toContain(body.acceptanceToken);

    // Document transitioned; revision pointer unchanged; commercial fields untouched.
    const doc = await prisma.quoteDocument.findUniqueOrThrow({ where: { id: draft.id } });
    expect(doc.status).toBe("SENT");
    expect(doc.currentRevisionId).toBe(revisionId);
    expect(doc.acceptedRevisionId).toBeNull();
    expect(doc.documentNumber).toBe(draft.documentNumber);
    expect(doc.currency).toBe(draft.currency);

    // Revision + line items are byte-for-byte unchanged (immutable snapshot).
    const revisionAfter = await prisma.quoteRevision.findUniqueOrThrow({ where: { id: revisionId } });
    expect(revisionAfter.total.toFixed(2)).toBe("90.00");
    const lineItemsAfter = await prisma.quoteLineItem.findMany({ where: { quoteRevisionId: revisionId }, orderBy: { sortOrder: "asc" } });
    expect(lineItemsAfter).toEqual(lineItemsBefore);

    // Exactly one acceptance token, bound to the sent revision, stored as a hash only.
    const tokens = await prisma.quoteAcceptanceToken.findMany({ where: { quoteRevision: { quoteDocumentId: draft.id } } });
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.quoteRevisionId).toBe(revisionId);
    expect(tokens[0]!.tokenHash).toBe(hashToken(body.acceptanceToken));
    expect(tokens[0]!.tokenHash).not.toBe(body.acceptanceToken);
    expect(tokens[0]!.revokedAt).toBeNull();
    expect(tokens[0]!.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(Object.keys(tokens[0]!)).not.toContain("rawToken");
    expect(Object.keys(tokens[0]!)).not.toContain("token");

    // Exactly one SENT event, truthful actor, no raw token in metadata.
    const events = await prisma.quoteEvent.findMany({ where: { quoteDocumentId: draft.id, eventType: "SENT" } });
    expect(events).toHaveLength(1);
    expect(events[0]!.actorType).toBe("BUSINESS_MEMBER");
    expect(events[0]!.quoteRevisionId).toBe(revisionId);
    expect(JSON.stringify(events[0]!.metadata ?? {})).not.toContain(body.acceptanceToken);
  });

  it("allows OWNER, ADMIN and STAFF to send", async () => {
    const owner = await businessAccount(app);
    // owner
    const d1 = await createDraft(app, owner.token);
    expect((await app.inject({ method: "POST", url: `/quotes/${d1.id}/send`, headers: authHeader(owner.token) })).statusCode).toBe(200);
    for (const role of ["ADMIN", "STAFF"] as const) {
      const member = await addMember(app, owner.businessId, role);
      const d = await createDraft(app, member.token);
      const res = await app.inject({ method: "POST", url: `/quotes/${d.id}/send`, headers: authHeader(member.token) });
      expect(res.statusCode).toBe(200);
    }
  });

  it("binds token expiry to the quote's commercial expiry when that is sooner than the default TTL", async () => {
    const account = await businessAccount(app);
    const soon = new Date(Date.now() + 5 * 86_400_000);
    const draft = await createDraft(app, account.token, { expiresAt: soon.toISOString() });
    const res = await app.inject({ method: "POST", url: `/quotes/${draft.id}/send`, headers: authHeader(account.token) });
    expect(res.statusCode).toBe(200);
    const token = await prisma.quoteAcceptanceToken.findFirstOrThrow({ where: { quoteRevision: { quoteDocumentId: draft.id } } });
    // Equal to the document's own expiry (well under the 30-day default).
    expect(token.expiresAt.toISOString()).toBe(soon.toISOString());
  });

  it("applies the bounded default TTL when the quote has no commercial expiry (never a permanent token)", async () => {
    const account = await businessAccount(app);
    const draft = await createDraft(app, account.token);
    const before = Date.now();
    await app.inject({ method: "POST", url: `/quotes/${draft.id}/send`, headers: authHeader(account.token) });
    const token = await prisma.quoteAcceptanceToken.findFirstOrThrow({ where: { quoteRevision: { quoteDocumentId: draft.id } } });
    const ttlMs = token.expiresAt.getTime() - before;
    expect(ttlMs).toBeGreaterThan(29 * 86_400_000);
    expect(ttlMs).toBeLessThan(31 * 86_400_000);
  });

  // --- eligibility ---------------------------------------------------

  it("rejects sending a zero-line DRAFT with a safe 4xx", async () => {
    const account = await businessAccount(app);
    const draft = await app.inject({ method: "POST", url: "/quotes", headers: authHeader(account.token), payload: { documentType: "QUOTE" } });
    const id = draft.json().id;
    const res = await app.inject({ method: "POST", url: `/quotes/${id}/send`, headers: authHeader(account.token) });
    expect(res.statusCode).toBe(400);
    expect(await prisma.quoteAcceptanceToken.count()).toBe(0);
    expect(await prisma.quoteEvent.count({ where: { eventType: "SENT" } })).toBe(0);
    expect((await prisma.quoteDocument.findUniqueOrThrow({ where: { id } })).status).toBe("DRAFT");
  });

  it("rejects re-sending an already SENT document with 409 and creates no second token or event", async () => {
    const account = await businessAccount(app);
    const draft = await createDraft(app, account.token);
    expect((await app.inject({ method: "POST", url: `/quotes/${draft.id}/send`, headers: authHeader(account.token) })).statusCode).toBe(200);
    const again = await app.inject({ method: "POST", url: `/quotes/${draft.id}/send`, headers: authHeader(account.token) });
    expect(again.statusCode).toBe(409);
    expect(await prisma.quoteAcceptanceToken.count({ where: { quoteRevision: { quoteDocumentId: draft.id } } })).toBe(1);
    expect(await prisma.quoteEvent.count({ where: { quoteDocumentId: draft.id, eventType: "SENT" } })).toBe(1);
  });

  it("cannot send an edited draft using a stale expectedCurrentRevisionId (edit/send race)", async () => {
    const account = await businessAccount(app);
    const h = authHeader(account.token);
    const draft = await createDraft(app, account.token);
    const staleRevisionId = draft.currentRevision.id;
    await app.inject({ method: "PATCH", url: `/quotes/${draft.id}`, headers: h, payload: { expectedCurrentRevisionId: staleRevisionId, lineItems: [{ description: "Revised", quantity: 1, unitPrice: "10.00" }] } });
    const res = await app.inject({ method: "POST", url: `/quotes/${draft.id}/send`, headers: h, payload: { expectedCurrentRevisionId: staleRevisionId } });
    expect(res.statusCode).toBe(409);
    expect((await prisma.quoteDocument.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("DRAFT");
    expect(await prisma.quoteAcceptanceToken.count()).toBe(0);
  });

  it("sends successfully when expectedCurrentRevisionId matches the current revision", async () => {
    const account = await businessAccount(app);
    const draft = await createDraft(app, account.token);
    const res = await app.inject({ method: "POST", url: `/quotes/${draft.id}/send`, headers: authHeader(account.token), payload: { expectedCurrentRevisionId: draft.currentRevision.id } });
    expect(res.statusCode).toBe(200);
  });

  // --- authentication ----------------------------------------------

  it("rejects an unauthenticated send", async () => {
    const account = await businessAccount(app);
    const draft = await createDraft(app, account.token);
    expect((await app.inject({ method: "POST", url: `/quotes/${draft.id}/send` })).statusCode).toBe(401);
  });

  it("rejects a customer-scoped token", async () => {
    const account = await businessAccount(app);
    const draft = await createDraft(app, account.token);
    const custToken = await registerCustomerToken(app);
    expect((await app.inject({ method: "POST", url: `/quotes/${draft.id}/send`, headers: authHeader(custToken) })).statusCode).toBe(401);
  });

  // --- entitlement -----------------------------------------------

  it("returns 403 FEATURE_NOT_AVAILABLE for FREE and PRO, allows BUSINESS", async () => {
    const biz = await businessAccount(app, "BUSINESS");
    const draft = await createDraft(app, biz.token);
    // Downgrade AFTER the draft exists so we isolate the send check.
    for (const plan of ["FREE", "PRO"] as const) {
      await setPlan(biz.businessId, plan);
      const res = await app.inject({ method: "POST", url: `/quotes/${draft.id}/send`, headers: authHeader(biz.token) });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("FEATURE_NOT_AVAILABLE");
    }
    await setPlan(biz.businessId, "BUSINESS");
    await setSubscriptionStatus(biz.businessId, "ACTIVE");
    expect((await app.inject({ method: "POST", url: `/quotes/${draft.id}/send`, headers: authHeader(biz.token) })).statusCode).toBe(200);
  });

  // --- tenant isolation ----------------------------------------

  it("does not let Business B send Business A's quote, and changes no state", async () => {
    const a = await businessAccount(app);
    const b = await businessAccount(app);
    const draft = await createDraft(app, a.token);
    const res = await app.inject({ method: "POST", url: `/quotes/${draft.id}/send`, headers: authHeader(b.token) });
    expect(res.statusCode).toBe(404);
    expect((await prisma.quoteDocument.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("DRAFT");
    expect(await prisma.quoteAcceptanceToken.count()).toBe(0);
    expect(await prisma.quoteEvent.count({ where: { eventType: "SENT" } })).toBe(0);
  });

  it("returns 404 for a nonexistent quote id", async () => {
    const account = await businessAccount(app);
    const res = await app.inject({ method: "POST", url: "/quotes/00000000-0000-4000-8000-000000000000/send", headers: authHeader(account.token) });
    expect(res.statusCode).toBe(404);
  });

  // --- concurrency ---------------------------------------------

  it("resolves concurrent sends to exactly one winner: one token, one SENT event", async () => {
    const account = await businessAccount(app);
    const h = authHeader(account.token);
    const draft = await createDraft(app, account.token);
    const [r1, r2] = await Promise.all([
      app.inject({ method: "POST", url: `/quotes/${draft.id}/send`, headers: h }),
      app.inject({ method: "POST", url: `/quotes/${draft.id}/send`, headers: h }),
    ]);
    expect([r1.statusCode, r2.statusCode].sort()).toEqual([200, 409]);
    expect(await prisma.quoteAcceptanceToken.count({ where: { quoteRevision: { quoteDocumentId: draft.id } } })).toBe(1);
    expect(await prisma.quoteEvent.count({ where: { quoteDocumentId: draft.id, eventType: "SENT" } })).toBe(1);
    expect((await prisma.quoteDocument.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("SENT");
  });

  it("keeps delete/send deterministic: whichever wins, no orphan token or event", async () => {
    const account = await businessAccount(app);
    const h = authHeader(account.token);
    const draft = await createDraft(app, account.token);
    const [sendRes, deleteRes] = await Promise.all([
      app.inject({ method: "POST", url: `/quotes/${draft.id}/send`, headers: h }),
      app.inject({ method: "DELETE", url: `/quotes/${draft.id}`, headers: h }),
    ]);
    const outcomes = [sendRes.statusCode, deleteRes.statusCode].sort();
    // Either send wins (200) and delete then sees non-DRAFT (409),
    // or delete wins (204) and send sees a missing document (404).
    expect([[200, 409], [204, 404]]).toContainEqual(outcomes);
    const doc = await prisma.quoteDocument.findUnique({ where: { id: draft.id } });
    if (doc) {
      expect(doc.status).toBe("SENT");
      expect(await prisma.quoteAcceptanceToken.count({ where: { quoteRevision: { quoteDocumentId: draft.id } } })).toBe(1);
      expect(await prisma.quoteEvent.count({ where: { quoteDocumentId: draft.id, eventType: "SENT" } })).toBe(1);
    } else {
      expect(await prisma.quoteAcceptanceToken.count()).toBe(0);
      expect(await prisma.quoteEvent.count({ where: { eventType: "SENT" } })).toBe(0);
    }
  });

  // --- token leakage ------------------------------------------

  it("never exposes the raw token or its hash through any read path", async () => {
    const account = await businessAccount(app);
    const h = authHeader(account.token);
    const draft = await createDraft(app, account.token);
    const raw = (await app.inject({ method: "POST", url: `/quotes/${draft.id}/send`, headers: h })).json().acceptanceToken as string;

    const list = await app.inject({ method: "GET", url: "/quotes", headers: h });
    expect(list.body).not.toContain(raw);
    expect(list.body).not.toContain("tokenHash");
    expect(list.body).not.toContain("acceptanceToken");

    const detail = await app.inject({ method: "GET", url: `/quotes/${draft.id}`, headers: h });
    expect(detail.body).not.toContain(raw);
    expect(detail.body).not.toContain("tokenHash");
    expect(detail.body).not.toContain(hashToken(raw));
    expect(detail.body).not.toContain("acceptanceToken");

    // Raw token must not have landed in any persisted quote row.
    const doc = await prisma.quoteDocument.findUniqueOrThrow({ where: { id: draft.id } });
    const rev = await prisma.quoteRevision.findUniqueOrThrow({ where: { id: draft.currentRevision.id } });
    const evts = await prisma.quoteEvent.findMany({ where: { quoteDocumentId: draft.id } });
    expect(JSON.stringify(doc)).not.toContain(raw);
    expect(JSON.stringify(rev)).not.toContain(raw);
    expect(JSON.stringify(evts)).not.toContain(raw);
  });

  // --- domain regression guard -------------------------------

  it("canSendQuote still forbids sending anything that is not a DRAFT", () => {
    const line = [{ quantity: "1", unitPrice: "10.00" }];
    expect(canSendQuote({ status: "SENT", lineItems: line }).ok).toBe(false);
    expect(canSendQuote({ status: "ACCEPTED", lineItems: line }).ok).toBe(false);
    expect(canSendQuote({ status: "DRAFT", lineItems: [] }).ok).toBe(false);
    expect(canSendQuote({ status: "DRAFT", lineItems: line }).ok).toBe(true);
  });
});
