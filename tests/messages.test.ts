import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, resetDatabase, registerAccount, authHeader, setPlan } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { ApiError } from "../src/lib/errors.js";
import { sendMessage } from "../src/modules/messages/messages.service.js";
import { sendMessageSchema } from "../src/modules/messages/messages.schemas.js";
import type { MessagingProvider, OutboundMessage, SendResult } from "../src/lib/messaging/messagingProvider.js";

function makeFakeProvider(sendImpl?: (message: OutboundMessage) => Promise<SendResult>) {
  const calls: OutboundMessage[] = [];
  const provider: MessagingProvider = {
    id: "fake-test-provider",
    supportsChannel: () => true,
    send: async (message) => {
      calls.push(message);
      return sendImpl ? sendImpl(message) : { accepted: true, providerMessageId: "fake-msg-1", permanentFailure: false };
    },
    parseDeliveryWebhook: () => null,
    parseInboundWebhook: () => null,
    verifyWebhookSignature: () => false,
  };
  return { provider, calls };
}

async function createCustomerWithPhone(app: FastifyInstance, token: string, phone = "+263771234567") {
  const response = await app.inject({
    method: "POST",
    url: "/customers",
    headers: authHeader(token),
    payload: { name: "Test Customer", phone },
  });
  return response.json() as { id: string; phoneE164: string | null };
}

describe("manual outbound SMS (Phase 2)", () => {
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

  // ---------------------------------------------------------------------
  // Entitlement gating
  // ---------------------------------------------------------------------

  it("1. blocks a FREE business from using manual outbound provider SMS", async () => {
    const { token } = await registerAccount(app);
    const customer = await createCustomerWithPhone(app, token);

    const response = await app.inject({
      method: "POST",
      url: "/messages/send",
      headers: authHeader(token),
      payload: { customerId: customer.id, body: "Hello" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("FEATURE_NOT_AVAILABLE");
    expect(response.json().error.details).toMatchObject({ feature: "OUTBOUND_MESSAGING", plan: "FREE" });
  });

  it("2. lets a PRO business send through the service with a fake provider", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const customer = await createCustomerWithPhone(app, token);
    const { provider, calls } = makeFakeProvider();

    const message = await sendMessage(businessId, sendMessageSchema.parse({ customerId: customer.id, body: "Hi there" }), "PRO", provider);

    expect(calls).toHaveLength(1);
    expect(message.status).toBe("sent");
  });

  it("3. does not let a client-supplied plan field elevate FREE to PRO", async () => {
    const { token } = await registerAccount(app);
    const customer = await createCustomerWithPhone(app, token);

    const response = await app.inject({
      method: "POST",
      url: "/messages/send",
      headers: authHeader(token),
      // sendMessageSchema has no `plan` field — Zod strips it, and the
      // service only ever reads plan from request.plan (tenant.ts).
      payload: { customerId: customer.id, body: "Hello", plan: "PRO" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("FEATURE_NOT_AVAILABLE");
  });

  // ---------------------------------------------------------------------
  // Phone validation
  // ---------------------------------------------------------------------

  it("4. sends to the customer's phoneE164", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const customer = await createCustomerWithPhone(app, token, "+263771234567");
    expect(customer.phoneE164).toBe("+263771234567");
    const { provider, calls } = makeFakeProvider();

    await sendMessage(businessId, sendMessageSchema.parse({ customerId: customer.id, body: "Hi" }), "PRO", provider);

    expect(calls[0]?.to).toBe("+263771234567");
  });

  it("5. rejects a customer with no resolvable E.164 phone without calling the provider", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    // No business.country set and not international form — phoneE164 stays null (Phase 1 behavior).
    const customer = await createCustomerWithPhone(app, token, "0771234567");
    expect(customer.phoneE164).toBeNull();
    const { provider, calls } = makeFakeProvider();

    await expect(sendMessage(businessId, sendMessageSchema.parse({ customerId: customer.id, body: "Hi" }), "PRO", provider)).rejects.toBeInstanceOf(ApiError);
    expect(calls).toHaveLength(0);
    expect(await prisma.message.count({ where: { businessId } })).toBe(0);
  });

  it("6. rejects an empty message body without calling the provider", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const customer = await createCustomerWithPhone(app, token);

    const response = await app.inject({
      method: "POST",
      url: "/messages/send",
      headers: authHeader(token),
      payload: { customerId: customer.id, body: "" },
    });

    expect(response.statusCode).toBe(400);
    expect(await prisma.message.count({ where: { businessId } })).toBe(0);
  });

  // ---------------------------------------------------------------------
  // Opt-out enforcement
  // ---------------------------------------------------------------------

  it("7. blocks sending when an SMS opt-out exists for the phone", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const customer = await createCustomerWithPhone(app, token);
    await prisma.customerOptOut.create({
      data: { businessId, phone: customer.phoneE164!, channel: "SMS", source: "manual" },
    });
    const { provider, calls } = makeFakeProvider();

    await expect(sendMessage(businessId, sendMessageSchema.parse({ customerId: customer.id, body: "Hi" }), "PRO", provider)).rejects.toBeInstanceOf(ApiError);
    expect(calls).toHaveLength(0);
  });

  it("8. blocks sending when an ALL-channel opt-out exists for the phone", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const customer = await createCustomerWithPhone(app, token);
    await prisma.customerOptOut.create({
      data: { businessId, phone: customer.phoneE164!, channel: "ALL", source: "manual" },
    });
    const { provider, calls } = makeFakeProvider();

    await expect(sendMessage(businessId, sendMessageSchema.parse({ customerId: customer.id, body: "Hi" }), "PRO", provider)).rejects.toBeInstanceOf(ApiError);
    expect(calls).toHaveLength(0);
  });

  it("9. does not let a different business's opt-out block the current business", async () => {
    const businessA = await registerAccount(app, { email: "optout-send-a@example.com" });
    const businessB = await registerAccount(app, { email: "optout-send-b@example.com" });
    await setPlan(businessA.businessId, "PRO");
    const customer = await createCustomerWithPhone(app, businessA.token, "+263771234567");

    // Business B has an opt-out for the exact same phone number.
    await prisma.customerOptOut.create({
      data: { businessId: businessB.businessId, phone: "+263771234567", channel: "ALL", source: "manual" },
    });

    const { provider, calls } = makeFakeProvider();
    const message = await sendMessage(businessA.businessId, sendMessageSchema.parse({ customerId: customer.id, body: "Hi" }), "PRO", provider);

    expect(calls).toHaveLength(1);
    expect(message.status).toBe("sent");
  });

  // ---------------------------------------------------------------------
  // Message persistence
  // ---------------------------------------------------------------------

  it("10. creates the correct Message record on a successful send", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const customer = await createCustomerWithPhone(app, token);
    const lead = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: { customerId: customer.id },
    });
    const { provider } = makeFakeProvider(async () => ({ accepted: true, providerMessageId: "SM999", permanentFailure: false }));

    const message = await sendMessage(
      businessId,
      { customerId: customer.id, leadId: lead.json().id, body: "Following up", messageType: "missed_call" },
      "PRO",
      provider,
    );

    expect(message).toMatchObject({
      businessId,
      customerId: customer.id,
      leadId: lead.json().id,
      messageType: "missed_call",
      channel: "sms",
      status: "sent",
      body: "Following up",
      provider: "twilio",
      providerMessageId: "SM999",
    });
    expect(message.sentAt).not.toBeNull();
  });

  it("11. does not treat a permanent provider failure as successful", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const customer = await createCustomerWithPhone(app, token);
    const { provider } = makeFakeProvider(async () => ({ accepted: false, errorCode: "21211", permanentFailure: true }));

    await expect(sendMessage(businessId, sendMessageSchema.parse({ customerId: customer.id, body: "Hi" }), "PRO", provider)).rejects.toMatchObject({
      code: "PROVIDER_SEND_FAILED",
      details: expect.objectContaining({ permanentFailure: true, errorCode: "21211" }),
    });

    const message = await prisma.message.findFirstOrThrow({ where: { businessId } });
    expect(message.status).toBe("failed");
    expect(message.sentAt).toBeNull();
  });

  it("12. represents a transient provider failure correctly in the error contract", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const customer = await createCustomerWithPhone(app, token);
    const { provider } = makeFakeProvider(async () => ({ accepted: false, errorCode: "20500", permanentFailure: false }));

    await expect(sendMessage(businessId, sendMessageSchema.parse({ customerId: customer.id, body: "Hi" }), "PRO", provider)).rejects.toMatchObject({
      code: "PROVIDER_SEND_FAILED",
      details: expect.objectContaining({ permanentFailure: false, errorCode: "20500" }),
    });

    const message = await prisma.message.findFirstOrThrow({ where: { businessId } });
    expect(message.status).toBe("failed");
  });

  // ---------------------------------------------------------------------
  // Critical regression: Free manual workflow untouched
  // ---------------------------------------------------------------------

  it("16. leaves Free manual message generation working exactly as before", async () => {
    const { token } = await registerAccount(app);

    const customer = await createCustomerWithPhone(app, token);
    const lead = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: { customerId: customer.id, serviceRequested: "haircut" },
    });
    expect(lead.statusCode).toBe(201);

    const generated = await app.inject({
      method: "POST",
      url: `/leads/${lead.json().id}/generate-message`,
      headers: authHeader(token),
    });
    expect(generated.statusCode).toBe(200);
    expect(typeof generated.json().message).toBe("string");

    // Generating a message must never itself create a Message row or send
    // anything — it only ever returns text for the owner to copy.
    expect(await prisma.message.count()).toBe(0);
  });

  it("does not create a lead/customer that automatically sends anything", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO"); // even on PRO — creation alone must never trigger a send.

    await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(token),
      payload: { name: "No auto-send", phone: "+263771234567" },
    });
    await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: {},
    });

    expect(await prisma.message.count({ where: { businessId } })).toBe(0);
  });
});
