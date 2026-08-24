import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import type { MessagingProvider } from "../src/lib/messaging/messagingProvider.js";
import { createTestApp, registerAccount, resetDatabase } from "./helpers.js";

const provider: MessagingProvider = {
  id: "fake",
  supportsChannel: () => true,
  send: async () => ({ accepted: true, permanentFailure: false }),
  verifyWebhookSignature: () => true,
  parseDeliveryWebhook: body => ({ providerMessageId: (body as { MessageSid: string }).MessageSid, status: (body as { status: "delivered" | "undelivered" }).status, errorCode: (body as { errorCode?: string }).errorCode, occurredAt: new Date("2026-09-01T10:00:00.000Z") }),
  parseInboundWebhook: body => ({ from: (body as { From: string }).From, to: "+15005550006", body: (body as { Body: string }).Body, channel: "sms", receivedAt: new Date() }),
};

describe("messaging provider webhooks", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp({ messagingProvider: provider }); });
  afterEach(resetDatabase);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it("persists delivered and undelivered provider outcomes", async () => {
    const account = await registerAccount(app, { email: "delivery-webhook@example.com" });
    const customer = await prisma.customer.create({ data: { businessId: account.businessId, name: "Delivery Customer", phone: "+15551234567", phoneE164: "+15551234567" } });
    await prisma.message.create({ data: { businessId: account.businessId, customerId: customer.id, messageType: "custom", body: "Hello", status: "sent", provider: "fake", providerMessageId: "SM-delivery" } });
    expect((await app.inject({ method: "POST", url: "/webhooks/twilio/status", payload: { MessageSid: "SM-delivery", status: "delivered" } })).statusCode).toBe(200);
    expect(await prisma.message.findFirst({ where: { providerMessageId: "SM-delivery" }, select: { status: true, deliveredAt: true } })).toMatchObject({ status: "delivered", deliveredAt: new Date("2026-09-01T10:00:00.000Z") });
    await app.inject({ method: "POST", url: "/webhooks/twilio/status", payload: { MessageSid: "SM-delivery", status: "undelivered", errorCode: "30005" } });
    expect(await prisma.message.findFirst({ where: { providerMessageId: "SM-delivery" }, select: { status: true, providerErrorCode: true } })).toMatchObject({ status: "undelivered", providerErrorCode: "30005" });
  });

  it("records STOP as a tenant-scoped opt-out", async () => {
    const account = await registerAccount(app, { email: "stop-webhook@example.com" });
    await prisma.customer.create({ data: { businessId: account.businessId, name: "Opted Out", phone: "+15557654321", phoneE164: "+15557654321" } });
    expect((await app.inject({ method: "POST", url: "/webhooks/twilio/inbound", payload: { From: "+15557654321", Body: "STOP" } })).statusCode).toBe(200);
    expect(await prisma.customerOptOut.findFirst({ where: { businessId: account.businessId, phone: "+15557654321" } })).toMatchObject({ channel: "SMS", source: "provider_webhook" });
  });
});
