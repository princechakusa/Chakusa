import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import { sendBusinessInquiryReply } from "../src/lib/marketplace/inquiries.js";
import { createTestApp, registerAccount, resetDatabase } from "./helpers.js";

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function setup(app: FastifyInstance) {
  const email = `cust-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const res = await app.inject({ method: "POST", url: "/customer/auth/register", payload: { ageConfirmed: true, email, password: "password123", fullName: "Casey Customer" } });
  const body = res.json();
  const account = await registerAccount(app, { businessName: "Block Test Studio", email: `owner-${Date.now()}@example.com` });
  const biz = await prisma.business.findUniqueOrThrow({ where: { id: account.businessId }, select: { publicSlug: true } });
  const started = await app.inject({ method: "POST", url: "/customer/inquiries", headers: auth(body.accessToken), payload: { slug: biz.publicSlug, body: "Hello, are you open?" } });
  return { token: body.accessToken as string, businessId: account.businessId as string, slug: biz.publicSlug as string, threadId: started.json().threadId as string };
}

describe("customer report and block on message threads (Apple 1.2 / Play UGC)", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterEach(resetDatabase);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it("a customer reports a thread into the moderation queue", async () => {
    const t = await setup(app);
    const res = await app.inject({ method: "POST", url: `/customer/inquiries/${t.threadId}/report`, headers: auth(t.token), payload: { reason: "inappropriate", detail: "Rude reply" } });
    expect(res.statusCode).toBe(201);
    const report = await prisma.businessReport.findFirstOrThrow({ where: { businessId: t.businessId } });
    expect(report).toMatchObject({ reason: "inappropriate", status: "OPEN" });
    expect(report.detail).toContain(t.threadId);
  });

  it("blocking stops the business replying and the customer sending, and can be undone", async () => {
    const t = await setup(app);
    expect((await app.inject({ method: "PUT", url: `/customer/inquiries/${t.threadId}/block`, headers: auth(t.token), payload: { blocked: true } })).json()).toEqual({ blocked: true });
    await expect(sendBusinessInquiryReply(t.businessId, t.threadId, "Hi")).rejects.toThrow(/blocked/i);
    const send = await app.inject({ method: "POST", url: `/customer/inquiries/${t.threadId}/messages`, headers: auth(t.token), payload: { body: "More" } });
    expect(send.statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: `/customer/inquiries/${t.threadId}`, headers: auth(t.token) })).json().blocked).toBe(true);

    await app.inject({ method: "PUT", url: `/customer/inquiries/${t.threadId}/block`, headers: auth(t.token), payload: { blocked: false } });
    await expect(sendBusinessInquiryReply(t.businessId, t.threadId, "Hi again")).resolves.toMatchObject({ body: "Hi again" });
  });

  it("another customer cannot report or block someone else's thread", async () => {
    const t = await setup(app);
    const other = await app.inject({ method: "POST", url: "/customer/auth/register", payload: { ageConfirmed: true, email: `other-${Date.now()}@example.com`, password: "password123", fullName: "Other" } });
    const token = other.json().accessToken as string;
    expect((await app.inject({ method: "PUT", url: `/customer/inquiries/${t.threadId}/block`, headers: auth(token), payload: { blocked: true } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/customer/inquiries/${t.threadId}/report`, headers: auth(token), payload: { reason: "spam" } })).statusCode).toBe(404);
  });
});
