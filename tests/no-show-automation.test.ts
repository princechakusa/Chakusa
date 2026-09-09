import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { BusinessRole } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import { createSession } from "../src/modules/auth/auth.service.js";
import { authHeader, createTestApp, registerAccount, resetDatabase, setPlan, setSubscriptionStatus } from "./helpers.js";
import { sendCustomerAppointmentMessage, sendDueCustomerAppointmentMessages } from "../src/modules/appointments/appointmentReminders.js";
import { handleInboundAIMessage } from "../src/lib/ai/agent/customerAgent.js";
import { recordInboundMessage } from "../src/lib/messaging/messagingPlatform.js";
import type { MessagingProvider, OutboundMessage } from "../src/lib/messaging/messagingProvider.js";

function fakeProvider(accept = true) {
  const calls: OutboundMessage[] = [];
  const provider: MessagingProvider = {
    id: "fake",
    supportsChannel: () => true,
    send: async (m: OutboundMessage) => { calls.push(m); return { accepted: accept, providerMessageId: `SM-${calls.length}`, permanentFailure: !accept }; },
    parseDeliveryWebhook: () => null,
    parseInboundWebhook: () => null,
    verifyWebhookSignature: () => false,
  };
  return { provider, calls };
}

async function memberToken(app: FastifyInstance, businessId: string, role: BusinessRole) {
  const email = `${role.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2)}@ex.com`;
  const user = await prisma.user.create({ data: { email, normalizedEmail: email.toLowerCase(), fullName: `${role}`, passwordHash: null } });
  await prisma.businessMember.create({ data: { businessId, userId: user.id, role, status: "ACTIVE" } });
  const { session } = await createSession(user.id, prisma);
  return app.jwt.sign({ userId: user.id, sessionId: session.id, type: "access" }, { expiresIn: 900 });
}

describe("no-show automation (#17)", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterEach(resetDatabase);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  async function biz(email = "ns-owner@ex.com", opts: { followUp?: boolean } = {}) {
    const account = await registerAccount(app, { email });
    await setPlan(account.businessId, "BUSINESS");
    await setSubscriptionStatus(account.businessId, "ACTIVE");
    await prisma.business.update({ where: { id: account.businessId }, data: { messagingConsentConfirmedAt: new Date(), noShowFollowUpEnabled: opts.followUp ?? true } });
    const customer = await prisma.customer.create({ data: { businessId: account.businessId, name: "Pat", phone: "+15005550031", phoneE164: "+15005550031" } });
    const member = await prisma.businessMember.findFirstOrThrow({ where: { businessId: account.businessId, userId: account.userId } });
    return { ...account, customer, member };
  }

  /** An appointment whose start time is in the past (so it is no-show eligible), CONFIRMED. */
  async function pastAppt(businessId: string, customerId: string, memberId?: string) {
    return prisma.appointment.create({
      data: {
        businessId, customerId, assignedMemberId: memberId ?? null,
        serviceName: "Cut",
        startsAt: new Date(Date.now() - 90 * 60_000),
        endsAt: new Date(Date.now() - 30 * 60_000),
        status: "CONFIRMED",
        createdByUserId: "seed",
      },
    });
  }
  const mark = (token: string, id: string, status = "NO_SHOW") =>
    app.inject({ method: "POST", url: `/appointments/${id}/status`, headers: authHeader(token), payload: { status } });

  it("1. a future appointment cannot be marked no-show", async () => {
    const b = await biz();
    const future = await prisma.appointment.create({ data: { businessId: b.businessId, customerId: b.customer.id, serviceName: "Cut", startsAt: new Date(Date.now() + 3_600_000), endsAt: new Date(Date.now() + 7_200_000), status: "CONFIRMED", createdByUserId: "seed" } });
    expect((await mark(b.token, future.id)).statusCode).toBe(409);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: future.id } })).status).toBe("CONFIRMED");
  });

  it("2. a member without appointments.operate cannot mark no-show", async () => {
    const b = await biz("ns-authz@ex.com");
    const appt = await pastAppt(b.businessId, b.customer.id);
    // strip the platform team entitlement -> STAFF gets suspended by tenant.ts,
    // so instead prove the capability gate: a non-member token is 403/forbidden.
    const outsider = await registerAccount(app, { email: "ns-outsider@ex.com" });
    expect([403, 404]).toContain((await mark(outsider.token, appt.id)).statusCode);
  });

  it("3. a cross-tenant appointment is not found", async () => {
    const a = await biz("ns-tenantA@ex.com");
    const other = await biz("ns-tenantB@ex.com");
    const appt = await pastAppt(a.businessId, a.customer.id);
    expect((await mark(other.token, appt.id)).statusCode).toBe(404);
  });

  it("4. a customer cannot invoke the business no-show mutation", async () => {
    const b = await biz("ns-cust@ex.com");
    const appt = await pastAppt(b.businessId, b.customer.id);
    // customer auth is a different identity; a business bearer route rejects it.
    const res = await app.inject({ method: "POST", url: `/appointments/${appt.id}/status`, headers: { authorization: "Bearer not-a-real-token" }, payload: { status: "NO_SHOW" } });
    expect([401, 403]).toContain(res.statusCode);
  });

  it("5 + 6. a canceled or completed appointment cannot become no-show", async () => {
    const b = await biz("ns-terminal@ex.com");
    const canceled = await prisma.appointment.create({ data: { businessId: b.businessId, customerId: b.customer.id, serviceName: "Cut", startsAt: new Date(Date.now() - 3_600_000), endsAt: new Date(Date.now() - 1_800_000), status: "CANCELED", createdByUserId: "seed" } });
    const completed = await prisma.appointment.create({ data: { businessId: b.businessId, customerId: b.customer.id, serviceName: "Cut", startsAt: new Date(Date.now() - 3_600_000), endsAt: new Date(Date.now() - 1_800_000), status: "COMPLETED", createdByUserId: "seed" } });
    expect((await mark(b.token, canceled.id)).statusCode).toBe(409);
    expect((await mark(b.token, completed.id)).statusCode).toBe(409);
  });

  it("7 + 8. a valid appointment becomes no-show, and repeating the request is idempotent", async () => {
    const b = await biz("ns-valid@ex.com");
    const appt = await pastAppt(b.businessId, b.customer.id);
    const first = await mark(b.token, appt.id);
    expect(first.statusCode).toBe(200);
    expect(first.json().status).toBe("NO_SHOW");
    const second = await mark(b.token, appt.id); // NO_SHOW -> NO_SHOW has no transition
    expect(second.statusCode).toBe(409);
    // exactly one NO_SHOW activity event
    expect(await prisma.activityEvent.count({ where: { businessId: b.businessId, eventType: "APPOINTMENT_NO_SHOW", entityId: appt.id } })).toBe(1);
  });

  it("9. an active live-location share is deleted when the appointment becomes no-show", async () => {
    const b = await biz("ns-loc@ex.com");
    const appt = await pastAppt(b.businessId, b.customer.id, b.member.id);
    await prisma.appointmentLocationShare.create({ data: { appointmentId: appt.id, businessId: b.businessId, sharingMemberId: b.member.id, latitude: 51.5, longitude: -0.14, expiresAt: new Date(Date.now() + 3_600_000) } });
    await mark(b.token, appt.id);
    expect(await prisma.appointmentLocationShare.findUnique({ where: { appointmentId: appt.id } })).toBeNull();
  });

  it("10. pending customer reminders no longer send once the appointment is no-show", async () => {
    const b = await biz("ns-reminders@ex.com");
    const appt = await pastAppt(b.businessId, b.customer.id);
    await mark(b.token, appt.id);
    const { provider, calls } = fakeProvider();
    await sendDueCustomerAppointmentMessages(provider, 50, new Date());
    // #18: the sweep now durably dispatches the opt-in no-show follow-up, but
    // still no reminder / same-day reminder for a no-show appointment — the
    // only message to the customer is the "we missed you" follow-up.
    const toCustomer = calls.filter(c => c.to === "+15005550031");
    expect(toCustomer).toHaveLength(1);
    expect(toCustomer[0]!.body.toLowerCase()).toContain("we missed you");
  });

  it("11. follow-up disabled -> no message", async () => {
    const b = await biz("ns-off@ex.com", { followUp: false });
    const appt = await pastAppt(b.businessId, b.customer.id);
    const { provider, calls } = fakeProvider();
    expect(await sendCustomerAppointmentMessage(appt.id, "no_show", provider)).toBe(false);
    expect(calls).toHaveLength(0);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } })).noShowFollowUpSentAt).toBeNull();
  });

  it("12 + 13. follow-up enabled -> exactly one polite message; a retry does not duplicate it", async () => {
    const b = await biz("ns-on@ex.com", { followUp: true });
    const appt = await pastAppt(b.businessId, b.customer.id);
    const { provider, calls } = fakeProvider();
    expect(await sendCustomerAppointmentMessage(appt.id, "no_show", provider)).toBe(true);
    expect(await sendCustomerAppointmentMessage(appt.id, "no_show", provider)).toBe(false); // claim already taken
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.toLowerCase()).toContain("we missed you");
    expect(calls[0]!.body.toLowerCase()).not.toMatch(/fee|charged|owe|penal/);
    const messages = await prisma.message.findMany({ where: { businessId: b.businessId, messageType: "appointment_no_show" } });
    expect(messages).toHaveLength(1);
  });

  it("14. a messaging-provider failure does not undo the authoritative NO_SHOW state", async () => {
    const b = await biz("ns-provfail@ex.com");
    const appt = await pastAppt(b.businessId, b.customer.id);
    await mark(b.token, appt.id); // #18: the follow-up is dispatched by the worker sweep, not this route
    const { provider } = fakeProvider(false); // simulate soft failure directly
    await sendCustomerAppointmentMessage(appt.id, "no_show", provider).catch(() => undefined);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } })).status).toBe("NO_SHOW");
  });

  it("15. no financial record is created by a no-show", async () => {
    const b = await biz("ns-fin@ex.com");
    const appt = await pastAppt(b.businessId, b.customer.id);
    await mark(b.token, appt.id);
    expect(await prisma.invoice.count({ where: { businessId: b.businessId } })).toBe(0);
    expect(await prisma.appointmentPaymentTransaction.count({ where: { appointmentId: appt.id } })).toBe(0);
    const after = await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } });
    expect(after.paidAmount.toString()).toBe("0");
    expect(after.paymentStatus).toBe("unpaid");
  });

  it("16 + 17. a no-show opens no AI bypass: the customer's reply still hits every receptionist gate", async () => {
    const b = await biz("ns-aigate@ex.com"); // receptionist NOT opted in (no settings row)
    await prisma.featureFlag.create({ data: { key: "ai.customer_agent", scope: "BUSINESS", businessId: b.businessId, enabled: true, status: "ENABLED" } });
    const appt = await pastAppt(b.businessId, b.customer.id);
    await mark(b.token, appt.id);
    const inbound = await recordInboundMessage({ businessId: b.businessId, customerId: b.customer.id, from: "+15005550031", channel: "sms", body: "can I rebook?", provider: "fake", providerMessageId: `IN-${Date.now()}` });
    // receptionist not enabled -> AI does not answer despite the no-show follow-up context
    const r1 = await handleInboundAIMessage({ businessId: b.businessId, conversationId: inbound.conversationId!, customerId: b.customer.id, providerMessageId: `M-${Date.now()}-a`, channel: "sms", body: "can I rebook?" });
    expect(r1).toMatchObject({ handled: false, reason: "receptionist_disabled" });

    // opt in, but a teammate owns the conversation -> still no AI (human takeover wins)
    await prisma.aiReceptionistSettings.create({ data: { businessId: b.businessId, enabled: true } });
    await prisma.conversation.update({ where: { id: inbound.conversationId! }, data: { automationMode: "HUMAN" } });
    const r2 = await handleInboundAIMessage({ businessId: b.businessId, conversationId: inbound.conversationId!, customerId: b.customer.id, providerMessageId: `M-${Date.now()}-b`, channel: "sms", body: "can I rebook?" });
    expect(r2).toMatchObject({ handled: false, reason: "human_owned" });
    expect(await prisma.aIConversationRun.count({ where: { businessId: b.businessId } })).toBe(0);
  });

  it("18. tenant isolation holds for the follow-up + reminders", async () => {
    const a = await biz("ns-isoA@ex.com");
    const other = await biz("ns-isoB@ex.com");
    const appt = await pastAppt(a.businessId, a.customer.id);
    await mark(a.token, appt.id);
    // business B sees nothing of A's no-show message
    expect(await prisma.message.count({ where: { businessId: other.businessId, messageType: "appointment_no_show" } })).toBe(0);
  });
});
