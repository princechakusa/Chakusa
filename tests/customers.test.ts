import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, resetDatabase, registerAccount, authHeader, setPlan } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { sendMessage } from "../src/modules/messages/messages.service.js";
import { sendMessageSchema } from "../src/modules/messages/messages.schemas.js";
import type { MessagingProvider, OutboundMessage, SendResult } from "../src/lib/messaging/messagingProvider.js";

function makeFakeProvider(sendImpl?: (message: OutboundMessage) => Promise<SendResult>): MessagingProvider {
  return {
    id: "fake-test-provider",
    supportsChannel: () => true,
    send: async (message) => (sendImpl ? sendImpl(message) : { accepted: true, providerMessageId: "fake-msg-1", permanentFailure: false }),
    parseDeliveryWebhook: () => null,
    parseInboundWebhook: () => null,
    verifyWebhookSignature: () => false,
  };
}

describe("customers", () => {
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

  it("creates a customer scoped to the caller's business", async () => {
    const { token, businessId } = await registerAccount(app);

    const response = await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(token),
      payload: { name: "Jane Doe", phone: "555-1234" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().businessId).toBe(businessId);
  });

  it("computes lifetime value from won leads only", async () => {
    const { token } = await registerAccount(app);

    const customer = await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(token),
      payload: { name: "Big Spender" },
    });
    const customerId = customer.json().id;

    const wonLead = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: { customerId, estimatedValue: 150 },
    });
    await app.inject({
      method: "POST",
      url: `/leads/${wonLead.json().id}/mark-won`,
      headers: authHeader(token),
    });

    const lostLead = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: { customerId, estimatedValue: 999 },
    });
    await app.inject({
      method: "POST",
      url: `/leads/${lostLead.json().id}/mark-lost`,
      headers: authHeader(token),
    });

    const profile = await app.inject({
      method: "GET",
      url: `/customers/${customerId}`,
      headers: authHeader(token),
    });

    expect(profile.json().lifetimeValue).toBe(150);
    expect(typeof profile.json().lifetimeValue).toBe("number");

    for (const lead of profile.json().leads) {
      expect(typeof lead.estimatedValue).toBe("number");
    }
  });

  it("records CUSTOMER_UPDATED activity when a customer is updated", async () => {
    const { token } = await registerAccount(app);

    const created = await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(token),
      payload: { name: "Original Name" },
    });
    const customerId = created.json().id;

    const updated = await app.inject({
      method: "PATCH",
      url: `/customers/${customerId}`,
      headers: authHeader(token),
      payload: { name: "Updated Name" },
    });
    expect(updated.json().name).toBe("Updated Name");

    const events = await prisma.activityEvent.findMany({
      where: { entityType: "customer", entityId: customerId },
      orderBy: { createdAt: "asc" },
    });

    expect(events.map((e) => e.eventType)).toEqual(["CUSTOMER_CREATED", "CUSTOMER_UPDATED"]);
  });

  it("returns 404 for a nonexistent customer", async () => {
    const { token } = await registerAccount(app);

    const response = await app.inject({
      method: "GET",
      url: "/customers/00000000-0000-0000-0000-000000000000",
      headers: authHeader(token),
    });

    expect(response.statusCode).toBe(404);
  });

  describe("bulk import", () => {
    it("imports every valid row and returns the created customers", async () => {
      const { token, businessId } = await registerAccount(app);

      const response = await app.inject({
        method: "POST",
        url: "/customers/bulk-import",
        headers: authHeader(token),
        payload: {
          customers: [
            { name: "Import One", phone: "+263771111111" },
            { name: "Import Two", email: "two@example.com" },
          ],
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().created).toHaveLength(2);
      expect(response.json().skipped).toEqual([]);
      expect(response.json().failed).toEqual([]);
      expect(await prisma.customer.count({ where: { businessId } })).toBe(2);
    });

    it("skips a row whose phone already matches an existing customer", async () => {
      const { token, businessId } = await registerAccount(app);
      await app.inject({
        method: "POST",
        url: "/customers",
        headers: authHeader(token),
        payload: { name: "Already Here", phone: "+263772222222" },
      });

      const response = await app.inject({
        method: "POST",
        url: "/customers/bulk-import",
        headers: authHeader(token),
        payload: { customers: [{ name: "Duplicate Row", phone: "+263772222222" }] },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().created).toEqual([]);
      expect(response.json().skipped).toEqual([{ name: "Duplicate Row", reason: "duplicate_phone" }]);
      expect(await prisma.customer.count({ where: { businessId } })).toBe(1);
    });

    it("stops creating once the plan's customer limit is reached, without failing the whole batch", async () => {
      const { token, businessId } = await registerAccount(app);
      await setPlan(businessId, "FREE");
      await prisma.customer.createMany({
        data: Array.from({ length: 199 }, (_, i) => ({ businessId, name: `Existing ${i}` })),
      });

      const response = await app.inject({
        method: "POST",
        url: "/customers/bulk-import",
        headers: authHeader(token),
        payload: { customers: [{ name: "Fits Under Limit" }, { name: "Over The Limit" }] },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().created).toEqual([{ id: expect.any(String), name: "Fits Under Limit" }]);
      expect(response.json().skipped).toEqual([{ name: "Over The Limit", reason: "limit_reached" }]);
      expect(await prisma.customer.count({ where: { businessId } })).toBe(200);
    });

    it("rejects an empty import and an oversized import", async () => {
      const { token } = await registerAccount(app);

      const empty = await app.inject({
        method: "POST",
        url: "/customers/bulk-import",
        headers: authHeader(token),
        payload: { customers: [] },
      });
      expect(empty.statusCode).toBe(400);

      const oversized = await app.inject({
        method: "POST",
        url: "/customers/bulk-import",
        headers: authHeader(token),
        payload: { customers: Array.from({ length: 501 }, (_, i) => ({ name: `Row ${i}` })) },
      });
      expect(oversized.statusCode).toBe(400);
    });

    it("rejects a row missing a name", async () => {
      const { token } = await registerAccount(app);

      const response = await app.inject({
        method: "POST",
        url: "/customers/bulk-import",
        headers: authHeader(token),
        payload: { customers: [{ phone: "+263773333333" }] },
      });

      expect(response.statusCode).toBe(400);
    });

    it("records one CUSTOMER_CREATED activity event per imported customer", async () => {
      const { token, businessId } = await registerAccount(app);

      await app.inject({
        method: "POST",
        url: "/customers/bulk-import",
        headers: authHeader(token),
        payload: { customers: [{ name: "Activity One" }, { name: "Activity Two" }] },
      });

      const events = await prisma.activityEvent.findMany({ where: { businessId, eventType: "CUSTOMER_CREATED" } });
      expect(events).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------
  // Conversation & Communication Center (Stage 9)
  // ---------------------------------------------------------------------

  describe("conversation & communication center fields on GET /customers/:id", () => {
    it("includes every message sent to this customer", async () => {
      const { token, businessId } = await registerAccount(app);
      await setPlan(businessId, "PRO");
      const customer = await app.inject({ method: "POST", url: "/customers", headers: authHeader(token), payload: { name: "Messaged Customer", phone: "+263771234567" } });
      const customerId = customer.json().id;

      await sendMessage(businessId, sendMessageSchema.parse({ customerId, body: "Hi there" }), "PRO", "ACTIVE", makeFakeProvider());

      const profile = await app.inject({ method: "GET", url: `/customers/${customerId}`, headers: authHeader(token) });

      expect(profile.json().messages).toHaveLength(1);
      expect(profile.json().messages[0].status).toBe("sent");
    });

    it("classifies lifecycle stage from this customer's own leads", async () => {
      const { token } = await registerAccount(app);
      const customer = await app.inject({ method: "POST", url: "/customers", headers: authHeader(token), payload: { name: "New Lead Customer" } });
      const customerId = customer.json().id;
      await app.inject({ method: "POST", url: "/leads", headers: authHeader(token), payload: { customerId } });

      const profile = await app.inject({ method: "GET", url: `/customers/${customerId}`, headers: authHeader(token) });

      expect(profile.json().lifecycleStage).toBe("new_lead");
    });

    it("flags payment_outstanding and waiting_for_follow_up as communication statuses from real data", async () => {
      const { token } = await registerAccount(app);
      const customer = await app.inject({ method: "POST", url: "/customers", headers: authHeader(token), payload: { name: "Owes Money" } });
      const customerId = customer.json().id;
      const wonLead = await app.inject({ method: "POST", url: "/leads", headers: authHeader(token), payload: { customerId, estimatedValue: 100 } });
      await app.inject({ method: "POST", url: `/leads/${wonLead.json().id}/mark-won`, headers: authHeader(token) });
      await app.inject({ method: "POST", url: "/leads", headers: authHeader(token), payload: { customerId } });

      const profile = await app.inject({ method: "GET", url: `/customers/${customerId}`, headers: authHeader(token) });

      expect(profile.json().communicationStatuses).toContain("payment_outstanding");
      expect(profile.json().communicationStatuses).toContain("waiting_for_follow_up");
    });

    it("builds a unified communication timeline covering leads, reviews, and reminders together", async () => {
      const { token } = await registerAccount(app);
      const customer = await app.inject({ method: "POST", url: "/customers", headers: authHeader(token), payload: { name: "Full History" } });
      const customerId = customer.json().id;
      await app.inject({ method: "POST", url: "/leads", headers: authHeader(token), payload: { customerId } });
      await app.inject({ method: "POST", url: "/review-requests", headers: authHeader(token), payload: { customerId } });
      await app.inject({ method: "POST", url: "/reminders", headers: authHeader(token), payload: { customerId, dueDate: new Date().toISOString() } });

      const profile = await app.inject({ method: "GET", url: `/customers/${customerId}`, headers: authHeader(token) });
      const kinds = profile.json().communicationTimeline.map((entry: { kind: string }) => entry.kind);

      expect(kinds).toContain("lead_created");
      expect(kinds).toContain("reminder_created");
    });

    it("surfaces a single assistant highlight for a dormant customer", async () => {
      const { token, businessId } = await registerAccount(app);
      const customer = await prisma.customer.create({ data: { businessId, name: "Dormant Customer" } });
      await prisma.lead.create({
        data: { businessId, customerId: customer.id, source: "missed_call", status: "won", estimatedValue: 100, paidAmount: 100, paymentStatus: "paid", createdAt: new Date(Date.now() - 90 * 86_400_000) },
      });

      const profile = await app.inject({ method: "GET", url: `/customers/${customer.id}`, headers: authHeader(token) });

      expect(profile.json().assistantHighlight?.quickAction).toBe("createReminder");
    });

    it("never leaks another business's messages, timeline, or highlight", async () => {
      const businessA = await registerAccount(app, { email: "conv-a@example.com" });
      const businessB = await registerAccount(app, { email: "conv-b@example.com" });
      await setPlan(businessB.businessId, "PRO");
      const customerB = await app.inject({ method: "POST", url: "/customers", headers: authHeader(businessB.token), payload: { name: "Business B Customer", phone: "+263771234567" } });
      await sendMessage(businessB.businessId, sendMessageSchema.parse({ customerId: customerB.json().id, body: "Secret message" }), "PRO", "ACTIVE", makeFakeProvider());

      const customerA = await app.inject({ method: "POST", url: "/customers", headers: authHeader(businessA.token), payload: { name: "Business A Customer" } });
      const profile = await app.inject({ method: "GET", url: `/customers/${customerA.json().id}`, headers: authHeader(businessA.token) });

      expect(profile.json().messages).toEqual([]);
      expect(JSON.stringify(profile.json())).not.toContain("Secret message");
    });
  });
});
