import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { MessagingProvider, OutboundMessage } from "../src/lib/messaging/messagingProvider.js";
import { enqueueMessage, processMessageDispatches, recordDeliveryReceipt, recordInboundMessage } from "../src/lib/messaging/messagingPlatform.js";
import { prisma } from "../src/lib/prisma.js";
import { createTestApp, registerAccount, resetDatabase, setPlan } from "./helpers.js";

function provider(send: (message: OutboundMessage) => Promise<{ accepted: boolean; providerMessageId?: string; errorCode?: string; permanentFailure: boolean }>): MessagingProvider {
  return { id: "test", supportsChannel: () => true, send, parseDeliveryWebhook: () => null, parseInboundWebhook: () => null, verifyWebhookSignature: () => true };
}

describe("messaging platform core", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterEach(async () => { await resetDatabase(); });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  async function setup() {
    const account = await registerAccount(app); await setPlan(account.businessId, "PRO");
    const customer = await prisma.customer.create({ data: { businessId: account.businessId, name: "Message Customer", phone: "+263771234567", phoneE164: "+263771234567" } });
    return { ...account, customer };
  }

  it("deduplicates a logical request and creates one conversation dispatch", async () => {
    const account = await setup();
    const request = { businessId: account.businessId, customerId: account.customer.id, body: "Your booking is confirmed", messageType: "booking_confirmation" as const, idempotencyKey: "booking-123456", actorType: "AUTOMATION" as const };
    const first = await enqueueMessage(request, "PRO", "ACTIVE");
    const second = await enqueueMessage(request, "PRO", "ACTIVE");
    expect(second.id).toBe(first.id);
    expect(await prisma.message.count({ where: { businessId: account.businessId } })).toBe(1);
    expect(await prisma.messageDispatch.count({ where: { businessId: account.businessId } })).toBe(1);
    expect(await prisma.conversation.count({ where: { businessId: account.businessId } })).toBe(1);
  });

  it("leases, retries, then accepts without duplicating the dispatch", async () => {
    const account = await setup(); let calls = 0;
    await enqueueMessage({ businessId: account.businessId, customerId: account.customer.id, body: "Hello", messageType: "custom", idempotencyKey: "retry-123456" }, "PRO", "ACTIVE");
    const fake = provider(async () => { calls += 1; return calls === 1 ? { accepted: false, errorCode: "TEMP", permanentFailure: false } : { accepted: true, providerMessageId: "provider-1", permanentFailure: false }; });
    expect(await processMessageDispatches(fake)).toBe(1);
    const dispatch = await prisma.messageDispatch.findFirstOrThrow();
    expect(dispatch.status).toBe("RETRY");
    await prisma.messageDispatch.update({ where: { id: dispatch.id }, data: { nextAttemptAt: new Date(0) } });
    expect(await processMessageDispatches(fake)).toBe(1);
    expect((await prisma.messageDispatch.findUniqueOrThrow({ where: { id: dispatch.id } })).status).toBe("ACCEPTED");
    expect(await prisma.messageDispatchAttempt.count({ where: { dispatchId: dispatch.id } })).toBe(2);
  });

  it("records delivery webhooks idempotently and advances delivery state", async () => {
    const account = await setup();
    await enqueueMessage({ businessId: account.businessId, customerId: account.customer.id, body: "Hello", messageType: "custom", idempotencyKey: "receipt-123456" }, "PRO", "ACTIVE");
    await processMessageDispatches(provider(async () => ({ accepted: true, providerMessageId: "provider-2", permanentFailure: false })));
    const event = { provider: "twilio", providerEventId: "event-1", providerMessageId: "provider-2", status: "DELIVERED", payload: { MessageStatus: "delivered" } };
    await recordDeliveryReceipt(event); await recordDeliveryReceipt(event);
    expect(await prisma.messageReceipt.count()).toBe(1);
    expect((await prisma.message.findFirstOrThrow()).deliveredAt).not.toBeNull();
  });

  it("turns inbound STOP into a tenant-scoped suppression", async () => {
    const account = await setup();
    await recordInboundMessage({ businessId: account.businessId, customerId: account.customer.id, from: account.customer.phoneE164!, channel: "sms", body: "STOP", provider: "twilio", providerMessageId: "inbound-1" });
    expect(await prisma.suppression.findFirst({ where: { businessId: account.businessId, address: account.customer.phoneE164! } })).toMatchObject({ active: true, reason: "CUSTOMER_REPLY" });
    await expect(enqueueMessage({ businessId: account.businessId, customerId: account.customer.id, body: "Blocked", messageType: "custom", idempotencyKey: "blocked-123456" }, "PRO", "ACTIVE")).rejects.toMatchObject({ statusCode: 403 });
  });
});
