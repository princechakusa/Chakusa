import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { BusinessRole } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import { createSession } from "../src/modules/auth/auth.service.js";
import { authHeader, createTestApp, registerAccount, resetDatabase, setPlan, setSubscriptionStatus } from "./helpers.js";
import { receptionistGate } from "../src/lib/ai/agent/receptionistSettings.js";
import { handleInboundAIMessage } from "../src/lib/ai/agent/customerAgent.js";
import { recordInboundMessage } from "../src/lib/messaging/messagingPlatform.js";

async function memberToken(app: FastifyInstance, businessId: string, role: BusinessRole) {
  const email = `${role.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2)}@ex.com`;
  const user = await prisma.user.create({ data: { email, normalizedEmail: email.toLowerCase(), fullName: `${role}`, passwordHash: null } });
  await prisma.businessMember.create({ data: { businessId, userId: user.id, role, status: "ACTIVE" } });
  const { session } = await createSession(user.id, prisma);
  return app.jwt.sign({ userId: user.id, sessionId: session.id, type: "access" }, { expiresIn: 900 });
}

describe("AI receptionist settings + gate", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterEach(resetDatabase);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  async function business(email = "recept-owner@ex.com", plan: "BUSINESS" | "PRO" | "FREE" = "BUSINESS") {
    const account = await registerAccount(app, { email });
    await setPlan(account.businessId, plan);
    await setSubscriptionStatus(account.businessId, "ACTIVE");
    return account;
  }

  it("returns safe defaults (disabled) and reflects effective state", async () => {
    const account = await business();
    const res = await app.inject({ method: "GET", url: "/ai/receptionist", headers: authHeader(account.token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().settings).toMatchObject({ enabled: false, smsEnabled: true, whatsappEnabled: true });
    expect(res.json().status).toMatchObject({ entitled: true, platformEnabled: false, effective: false });
  });

  it("owner can enable it; effective only once the platform switch is also on", async () => {
    const account = await business("recept-enable@ex.com");
    const patched = await app.inject({ method: "PATCH", url: "/ai/receptionist", headers: authHeader(account.token), payload: { enabled: true, whatsappEnabled: false } });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({ enabled: true, whatsappEnabled: false, smsEnabled: true });

    let status = (await app.inject({ method: "GET", url: "/ai/receptionist", headers: authHeader(account.token) })).json().status;
    expect(status.effective).toBe(false); // platform FeatureFlag not set

    await prisma.featureFlag.create({ data: { key: "ai.customer_agent", scope: "BUSINESS", businessId: account.businessId, enabled: true, status: "ENABLED" } });
    status = (await app.inject({ method: "GET", url: "/ai/receptionist", headers: authHeader(account.token) })).json().status;
    expect(status.effective).toBe(true);
  });

  it("PATCH is gated by the AI_RECEPTIONIST entitlement", async () => {
    const pro = await business("recept-pro@ex.com", "PRO");
    expect((await app.inject({ method: "PATCH", url: "/ai/receptionist", headers: authHeader(pro.token), payload: { enabled: true } })).statusCode).toBe(403);
  });

  it("STAFF cannot read or change receptionist settings", async () => {
    const account = await business("recept-staff@ex.com");
    const staff = await memberToken(app, account.businessId, "STAFF");
    expect((await app.inject({ method: "GET", url: "/ai/receptionist", headers: authHeader(staff) })).statusCode).toBe(403);
    expect((await app.inject({ method: "PATCH", url: "/ai/receptionist", headers: authHeader(staff), payload: { enabled: true } })).statusCode).toBe(403);
  });

  it("settings are per business", async () => {
    const a = await business("recept-tenantA@ex.com");
    const b = await business("recept-tenantB@ex.com");
    await app.inject({ method: "PATCH", url: "/ai/receptionist", headers: authHeader(a.token), payload: { enabled: true } });
    expect((await app.inject({ method: "GET", url: "/ai/receptionist", headers: authHeader(b.token) })).json().settings.enabled).toBe(false);
  });

  it("receptionistGate enforces entitlement, opt-in and channel independently", async () => {
    const account = await business("recept-gate@ex.com");
    // no settings row, BUSINESS plan
    expect(await receptionistGate(account.businessId, "sms", "BUSINESS", "ACTIVE")).toMatchObject({ ok: false, reason: "receptionist_disabled" });
    expect(await receptionistGate(account.businessId, "sms", "PRO", "ACTIVE")).toMatchObject({ ok: false, reason: "not_entitled" });

    await prisma.aiReceptionistSettings.create({ data: { businessId: account.businessId, enabled: true, smsEnabled: false, whatsappEnabled: true } });
    expect(await receptionistGate(account.businessId, "sms", "BUSINESS", "ACTIVE")).toMatchObject({ ok: false, reason: "channel_disabled" });
    expect(await receptionistGate(account.businessId, "whatsapp", "BUSINESS", "ACTIVE")).toEqual({ ok: true });
  });

  it("inbound handler will not run the agent when the business has not opted in or is not entitled", async () => {
    const account = await business("recept-inbound@ex.com");
    await prisma.featureFlag.create({ data: { key: "ai.customer_agent", scope: "BUSINESS", businessId: account.businessId, enabled: true, status: "ENABLED" } });
    const customer = await prisma.customer.create({ data: { businessId: account.businessId, name: "Pat", phone: "+15005550009", phoneE164: "+15005550009" } });
    const inbound = await recordInboundMessage({ businessId: account.businessId, customerId: customer.id, from: "+15005550009", channel: "sms", body: "Are you open today?", provider: "fake", providerMessageId: `IN-${Date.now()}` });

    // opted out (no settings row)
    let r = await handleInboundAIMessage({ businessId: account.businessId, conversationId: inbound.conversationId!, customerId: customer.id, providerMessageId: `IN-${Date.now()}-a`, channel: "sms", body: "hi" });
    expect(r).toMatchObject({ handled: false, reason: "receptionist_disabled" });

    // opted in but not entitled (downgrade to PRO)
    await prisma.aiReceptionistSettings.create({ data: { businessId: account.businessId, enabled: true } });
    await setPlan(account.businessId, "PRO");
    r = await handleInboundAIMessage({ businessId: account.businessId, conversationId: inbound.conversationId!, customerId: customer.id, providerMessageId: `IN-${Date.now()}-b`, channel: "sms", body: "hi" });
    expect(r).toMatchObject({ handled: false, reason: "not_entitled" });

    // no AIConversationRun was ever created for this conversation
    expect(await prisma.aIConversationRun.count({ where: { businessId: account.businessId } })).toBe(0);
    // the inbound message itself is still on record
    expect(await prisma.message.count({ where: { businessId: account.businessId, direction: "INBOUND" } })).toBeGreaterThanOrEqual(1);
  });
});
