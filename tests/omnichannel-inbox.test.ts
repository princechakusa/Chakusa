import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import { authHeader, createTestApp, registerAccount, resetDatabase, setPlan, setSubscriptionStatus } from "./helpers.js";
import { recordInboundMessage } from "../src/lib/messaging/messagingPlatform.js";
import { sendDueCustomerAppointmentMessages } from "../src/modules/appointments/appointmentReminders.js";
import type { MessagingProvider, OutboundMessage } from "../src/lib/messaging/messagingProvider.js";

function fake(accept = true) {
  const calls: OutboundMessage[] = [];
  const provider: MessagingProvider = {
    id: "fake",
    supportsChannel: () => true,
    send: async (m: OutboundMessage) => { calls.push(m); return { accepted: accept, providerMessageId: `SM-${calls.length}`, permanentFailure: !accept }; },
    parseDeliveryWebhook: () => null,
    parseInboundWebhook: (body: unknown) => {
      const b = body as { From: string; Body: string };
      return { from: b.From, to: "+15005550006", body: b.Body, channel: "sms" as const, receivedAt: new Date() };
    },
    verifyWebhookSignature: () => true,
  };
  return { provider, calls };
}

describe("omnichannel inbox (#18)", () => {
  let app: FastifyInstance;
  const { provider: inboundProvider } = fake();
  beforeAll(async () => { app = await createTestApp({ messagingProvider: inboundProvider }); });
  afterEach(resetDatabase);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  async function biz(email = "oc-owner@ex.com", opts: { noShow?: boolean } = {}) {
    const account = await registerAccount(app, { email });
    await setPlan(account.businessId, "BUSINESS");
    await setSubscriptionStatus(account.businessId, "ACTIVE");
    await prisma.business.update({ where: { id: account.businessId }, data: { messagingConsentConfirmedAt: new Date(), noShowFollowUpEnabled: opts.noShow ?? true } });
    const customer = await prisma.customer.create({ data: { businessId: account.businessId, name: "Pat", phone: "+15005550040", phoneE164: "+15005550040" } });
    return { ...account, customer };
  }
  const pastAppt = (businessId: string, customerId: string, status = "NO_SHOW") =>
    prisma.appointment.create({ data: { businessId, customerId, serviceName: "Cut", startsAt: new Date(Date.now() - 90 * 60_000), endsAt: new Date(Date.now() - 30 * 60_000), status: status as never, createdByUserId: "seed" } });

  // ---- A. inbound idempotency -------------------------------------------------

  it("records an inbound message once; a retry of the same provider id is a no-op replay", async () => {
    const b = await biz();
    const args = { businessId: b.businessId, customerId: b.customer.id, from: "+15005550040", channel: "sms" as const, body: "hello", provider: "twilio", providerMessageId: "IN-DEDUPE-1" };
    const first = await recordInboundMessage(args);
    expect(first.replayed).toBe(false);
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: first.conversationId } });
    const waitingSince1 = conv.waitingSince;

    await new Promise(r => setTimeout(r, 10));
    const second = await recordInboundMessage(args);
    expect(second.replayed).toBe(true);
    expect(second.conversationId).toBe(first.conversationId);

    expect(await prisma.message.count({ where: { businessId: b.businessId, direction: "INBOUND", providerMessageId: "IN-DEDUPE-1" } })).toBe(1);
    const conv2 = await prisma.conversation.findUniqueOrThrow({ where: { id: first.conversationId } });
    expect(conv2.waitingSince?.getTime()).toBe(waitingSince1?.getTime()); // not re-bumped
  });

  it("a duplicate inbound webhook POST yields one message and one AI run", async () => {
    const b = await biz("oc-webhook@ex.com");
    await prisma.featureFlag.create({ data: { key: "ai.customer_agent", scope: "BUSINESS", businessId: b.businessId, enabled: true, status: "ENABLED" } });
    const payload = { From: "+15005550040", Body: "are you open?", MessageSid: "IN-WEBHOOK-1" };
    const r1 = await app.inject({ method: "POST", url: "/webhooks/twilio/inbound", payload });
    const r2 = await app.inject({ method: "POST", url: "/webhooks/twilio/inbound", payload });
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(await prisma.message.count({ where: { businessId: b.businessId, direction: "INBOUND" } })).toBe(1);
    expect(await prisma.aIConversationRun.count({ where: { businessId: b.businessId } })).toBeLessThanOrEqual(1);
  });

  // ---- B. durable terminal-outcome dispatch --------------------------------

  it("the worker sweep durably sends the no-show follow-up exactly once", async () => {
    const b = await biz("oc-noshow@ex.com", { noShow: true });
    const appt = await pastAppt(b.businessId, b.customer.id, "NO_SHOW");
    const { provider, calls } = fake();
    expect(await sendDueCustomerAppointmentMessages(provider, 50, new Date())).toBeGreaterThanOrEqual(1);
    expect(calls.filter(c => c.body.toLowerCase().includes("we missed you"))).toHaveLength(1);
    // idempotent: a second sweep sends nothing more
    const before = calls.length;
    await sendDueCustomerAppointmentMessages(provider, 50, new Date());
    expect(calls.length).toBe(before);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } })).noShowFollowUpSentAt).not.toBeNull();
  });

  it("the sweep does not send a no-show follow-up when the business has it disabled", async () => {
    const b = await biz("oc-noshow-off@ex.com", { noShow: false });
    await pastAppt(b.businessId, b.customer.id, "NO_SHOW");
    const { provider, calls } = fake();
    await sendDueCustomerAppointmentMessages(provider, 50, new Date());
    expect(calls.filter(c => c.body.toLowerCase().includes("we missed you"))).toHaveLength(0);
  });

  it("a provider soft-failure leaves the claim clear so the next sweep retries", async () => {
    const b = await biz("oc-noshow-retry@ex.com", { noShow: true });
    const appt = await pastAppt(b.businessId, b.customer.id, "NO_SHOW");
    const failing = fake(false);
    await sendDueCustomerAppointmentMessages(failing.provider, 50, new Date());
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } })).noShowFollowUpSentAt).toBeNull(); // reverted
    const ok = fake(true);
    await sendDueCustomerAppointmentMessages(ok.provider, 50, new Date());
    expect(ok.calls).toHaveLength(1);
  });

  it("the sweep is the backstop for the cancellation confirmation too", async () => {
    const b = await biz("oc-cancel@ex.com");
    await pastAppt(b.businessId, b.customer.id, "CANCELED");
    const { provider, calls } = fake();
    await sendDueCustomerAppointmentMessages(provider, 50, new Date());
    expect(calls.filter(c => c.body.toLowerCase().includes("canceled"))).toHaveLength(1);
  });

  // ---- C. server-side unread ---------------------------------------------------

  it("unread is derived server-side and cleared by opening the conversation", async () => {
    const b = await biz("oc-unread@ex.com");
    const inbound = await recordInboundMessage({ businessId: b.businessId, customerId: b.customer.id, from: "+15005550040", channel: "sms", body: "hi", provider: "twilio", providerMessageId: "IN-UNREAD-1" });

    let list = (await app.inject({ method: "GET", url: "/messages/conversations", headers: authHeader(b.token) })).json();
    expect(list.find((c: { id: string }) => c.id === inbound.conversationId).unread).toBe(true);
    expect((await app.inject({ method: "GET", url: "/messages/conversations?unread=true", headers: authHeader(b.token) })).json()).toHaveLength(1);

    const detail = await app.inject({ method: "GET", url: `/messages/conversations/${inbound.conversationId}`, headers: authHeader(b.token) });
    expect(detail.json().unread).toBe(false);

    list = (await app.inject({ method: "GET", url: "/messages/conversations", headers: authHeader(b.token) })).json();
    expect(list.find((c: { id: string }) => c.id === inbound.conversationId).unread).toBe(false);

    // a new inbound flips it back to unread
    await new Promise(r => setTimeout(r, 5));
    await recordInboundMessage({ businessId: b.businessId, customerId: b.customer.id, from: "+15005550040", channel: "sms", body: "still there?", provider: "twilio", providerMessageId: "IN-UNREAD-2" });
    list = (await app.inject({ method: "GET", url: "/messages/conversations", headers: authHeader(b.token) })).json();
    expect(list.find((c: { id: string }) => c.id === inbound.conversationId).unread).toBe(true);

    // explicit mark-read
    expect((await app.inject({ method: "POST", url: `/messages/conversations/${inbound.conversationId}/read`, headers: authHeader(b.token) })).json()).toEqual({ read: true });
    list = (await app.inject({ method: "GET", url: "/messages/conversations", headers: authHeader(b.token) })).json();
    expect(list.find((c: { id: string }) => c.id === inbound.conversationId).unread).toBe(false);
  });

  it("the inbox and mark-read are tenant scoped", async () => {
    const a = await biz("oc-isoA@ex.com");
    const other = await biz("oc-isoB@ex.com");
    const inbound = await recordInboundMessage({ businessId: a.businessId, customerId: a.customer.id, from: "+15005550040", channel: "sms", body: "hi", provider: "twilio", providerMessageId: "IN-ISO-1" });
    expect((await app.inject({ method: "GET", url: `/messages/conversations/${inbound.conversationId}`, headers: authHeader(other.token) })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/messages/conversations/${inbound.conversationId}/read`, headers: authHeader(other.token) })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/messages/conversations", headers: authHeader(other.token) })).json()).toHaveLength(0);
  });
});
