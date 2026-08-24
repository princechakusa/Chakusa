import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import { authHeader, createTestApp, registerAccount, resetDatabase } from "./helpers.js";
import { sendAppointmentConfirmation, sendDueAppointmentReminders, sendDueCustomerAppointmentMessages } from "../src/modules/appointments/appointmentReminders.js";
import type { PushProvider } from "../src/lib/push/pushProvider.js";
import type { MessagingProvider, OutboundMessage } from "../src/lib/messaging/messagingProvider.js";

describe("appointments", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterEach(resetDatabase);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  async function fixture(email = "calendar@example.com") {
    const account = await registerAccount(app, { email });
    const member = await prisma.businessMember.findFirstOrThrow({ where: { businessId: account.businessId, userId: account.userId } });
    const customer = await prisma.customer.create({ data: { businessId: account.businessId, name: "Pat Customer" } });
    return { ...account, member, customer };
  }

  it("creates and lists tenant-scoped appointments with customer and assignee", async () => {
    const account = await fixture();
    const created = await app.inject({ method: "POST", url: "/appointments", headers: authHeader(account.token), payload: { customerId: account.customer.id, assignedMemberId: account.member.id, serviceName: "Haircut", startsAt: "2026-09-01T09:00:00.000Z", endsAt: "2026-09-01T10:00:00.000Z", price: 35, reminderMinutes: 60 } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ serviceName: "Haircut", status: "SCHEDULED", customer: { name: "Pat Customer" } });
    const listed = await app.inject({ method: "GET", url: "/appointments?from=2026-09-01T00:00:00.000Z&to=2026-09-02T00:00:00.000Z", headers: authHeader(account.token) });
    expect(listed.statusCode).toBe(200); expect(listed.json()).toHaveLength(1);
  });

  it("prevents overlapping active appointments for the same member", async () => {
    const account = await fixture(); const headers = authHeader(account.token);
    const base = { assignedMemberId: account.member.id, serviceName: "Service", startsAt: "2026-09-01T09:00:00.000Z", endsAt: "2026-09-01T10:00:00.000Z" };
    expect((await app.inject({ method: "POST", url: "/appointments", headers, payload: base })).statusCode).toBe(201);
    const conflict = await app.inject({ method: "POST", url: "/appointments", headers, payload: { ...base, startsAt: "2026-09-01T09:30:00.000Z", endsAt: "2026-09-01T10:30:00.000Z" } });
    expect(conflict.statusCode).toBe(409);
  });

  it("enforces tenant ownership for linked customers", async () => {
    const first = await fixture("first-calendar@example.com"); const second = await fixture("second-calendar@example.com");
    const response = await app.inject({ method: "POST", url: "/appointments", headers: authHeader(first.token), payload: { customerId: second.customer.id, serviceName: "Service", startsAt: "2026-09-01T09:00:00.000Z", endsAt: "2026-09-01T10:00:00.000Z" } });
    expect(response.statusCode).toBe(400);
  });

  it("supports a controlled appointment lifecycle and closes terminal records", async () => {
    const account = await fixture(); const headers = authHeader(account.token);
    const created = await app.inject({ method: "POST", url: "/appointments", headers, payload: { serviceName: "Service", startsAt: "2026-09-01T09:00:00.000Z", endsAt: "2026-09-01T10:00:00.000Z" } }); const id = created.json().id;
    expect((await app.inject({ method: "POST", url: `/appointments/${id}/status`, headers, payload: { status: "CONFIRMED" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/appointments/${id}/status`, headers, payload: { status: "COMPLETED" } })).json().status).toBe("COMPLETED");
    expect((await app.inject({ method: "PATCH", url: `/appointments/${id}`, headers, payload: { notes: "late edit" } })).statusCode).toBe(409);
  });

  it("tracks appointment deposits and collected revenue deterministically", async () => {
    const account = await fixture("appointment-payment@example.com"); const headers = authHeader(account.token);
    const service = await prisma.serviceOffering.create({ data: { businessId: account.businessId, name: "Color", durationMinutes: 60, price: 100, depositAmount: 25 } });
    const created = await app.inject({ method: "POST", url: "/appointments", headers, payload: { customerId: account.customer.id, assignedMemberId: account.member.id, serviceOfferingId: service.id, serviceName: "Color", startsAt: "2026-09-02T09:00:00.000Z", endsAt: "2026-09-02T10:00:00.000Z" } });
    expect(created.json()).toMatchObject({ price: "100", depositAmount: "25", paidAmount: "0", paymentStatus: "unpaid" });
    const partial = await app.inject({ method: "PATCH", url: `/appointments/${created.json().id}/payment`, headers, payload: { paidAmount: 25 } });
    expect(partial.json()).toMatchObject({ paidAmount: "25", paymentStatus: "partially_paid" });
    const paid = await app.inject({ method: "PATCH", url: `/appointments/${created.json().id}/payment`, headers, payload: { paidAmount: 100 } });
    expect(paid.json()).toMatchObject({ paidAmount: "100", paymentStatus: "paid" });
    const dashboard = await app.inject({ method: "GET", url: "/dashboard/summary", headers });
    expect(dashboard.json().recoveredRevenue).toMatchObject({ appointmentCollected: 100, appointmentOutstanding: 0 });
    expect((await app.inject({ method: "PATCH", url: `/appointments/${created.json().id}/payment`, headers, payload: { paidAmount: 101 } })).statusCode).toBe(400);
  });

  it("delivers an upcoming owner reminder at most once", async () => {
    const account = await fixture(); const now = new Date("2026-09-01T08:00:00.000Z");
    await prisma.deviceToken.create({ data: { userId: account.userId, token: "ExponentPushToken[appointment-reminder]", platform: "ios", provider: "expo" } });
    await prisma.appointment.create({ data: { businessId: account.businessId, createdByUserId: account.userId, serviceName: "Haircut", startsAt: new Date("2026-09-01T09:00:00.000Z"), endsAt: new Date("2026-09-01T10:00:00.000Z"), reminderMinutes: 60 } });
    const calls: string[][] = []; const provider: PushProvider = { isValidToken: () => true, sendToDevice: async token => ({ token, accepted: true, invalidToken: false }), sendToDevices: async tokens => { calls.push(tokens); return tokens.map(token => ({ token, accepted: true, invalidToken: false })); } };
    expect(await sendDueAppointmentReminders(provider, 10, now)).toBe(1);
    expect(await sendDueAppointmentReminders(provider, 10, now)).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it("sends an explicitly requested customer confirmation at most once", async () => {
    const account = await fixture("confirmation@example.com");
    await prisma.subscription.update({ where: { businessId: account.businessId }, data: { plan: "PRO", status: "ACTIVE" } });
    await prisma.customer.update({ where: { id: account.customer.id }, data: { phone: "+15551234567", phoneE164: "+15551234567" } });
    const appointment = await prisma.appointment.create({ data: { businessId: account.businessId, customerId: account.customer.id, createdByUserId: account.userId, serviceName: "Haircut", startsAt: new Date("2026-09-01T09:00:00.000Z"), endsAt: new Date("2026-09-01T10:00:00.000Z") } });
    const calls: OutboundMessage[] = []; const provider: MessagingProvider = { id: "fake", supportsChannel: () => true, send: async message => { calls.push(message); return { accepted: true, providerMessageId: "confirmation-1", permanentFailure: false }; }, parseDeliveryWebhook: () => null, parseInboundWebhook: () => null, verifyWebhookSignature: () => false };
    expect(await sendAppointmentConfirmation(appointment.id, provider)).toBe(true);
    expect(await sendAppointmentConfirmation(appointment.id, provider)).toBe(false);
    expect(calls).toHaveLength(1);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).confirmationSentAt).not.toBeNull();
  });

  it("sends upcoming, same-day, and post-appointment customer messages once", async () => {
    const account = await fixture("appointment-lifecycle@example.com");
    await prisma.subscription.update({ where: { businessId: account.businessId }, data: { plan: "PRO", status: "ACTIVE" } });
    await prisma.business.update({ where: { id: account.businessId }, data: { timezone: "UTC" } });
    await prisma.customer.update({ where: { id: account.customer.id }, data: { phone: "+15551234568", phoneE164: "+15551234568" } });
    await prisma.appointment.create({ data: { businessId: account.businessId, customerId: account.customer.id, createdByUserId: account.userId, serviceName: "Haircut", startsAt: new Date("2026-09-01T09:00:00.000Z"), endsAt: new Date("2026-09-01T10:00:00.000Z"), reminderMinutes: 60 } });
    await prisma.appointment.create({ data: { businessId: account.businessId, customerId: account.customer.id, createdByUserId: account.userId, serviceName: "Completed visit", startsAt: new Date("2026-08-31T07:00:00.000Z"), endsAt: new Date("2026-08-31T08:00:00.000Z"), status: "COMPLETED" } });
    const calls: OutboundMessage[] = []; const provider: MessagingProvider = { id: "fake", supportsChannel: () => true, send: async message => { calls.push(message); return { accepted: true, providerMessageId: `message-${calls.length}`, permanentFailure: false }; }, parseDeliveryWebhook: () => null, parseInboundWebhook: () => null, verifyWebhookSignature: () => false };
    const now = new Date("2026-09-01T08:00:00.000Z");
    expect(await sendDueCustomerAppointmentMessages(provider, 10, now)).toBe(3);
    expect(await sendDueCustomerAppointmentMessages(provider, 10, now)).toBe(0);
    expect(calls.map(call => call.body)).toEqual(expect.arrayContaining([expect.stringContaining("reminder"), expect.stringContaining("today"), expect.stringContaining("thank you")]));
  });
});
