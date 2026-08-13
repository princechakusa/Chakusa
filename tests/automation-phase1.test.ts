import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { createTestApp, resetDatabase, registerAccount, authHeader } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { parsePhoneNumber, toE164OrNull, isValidCountryCode } from "../src/lib/phone.js";
import { hasFeature, assertFeatureAvailable } from "../src/lib/entitlements.js";
import { ApiError } from "../src/lib/errors.js";
import type {
  MessagingProvider,
  OutboundMessage,
  SendResult,
  DeliveryEvent,
  InboundEvent,
  DeliveryStatus,
} from "../src/lib/messaging/messagingProvider.js";

describe("automation phase 1 foundations", () => {
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
  // Business location fields
  // ---------------------------------------------------------------------

  describe("business location fields", () => {
    it("accepts a valid country, timezone, and currency via PATCH /business", async () => {
      const { token } = await registerAccount(app);

      const response = await app.inject({
        method: "PATCH",
        url: "/business",
        headers: authHeader(token),
        payload: { country: "zw", timezone: "Africa/Harare", currency: "usd" },
      });

      expect(response.statusCode).toBe(200);
      // Country/currency are canonicalized to uppercase; timezone passes through as given.
      expect(response.json().country).toBe("ZW");
      expect(response.json().timezone).toBe("Africa/Harare");
      expect(response.json().currency).toBe("USD");
    });

    it("rejects an invalid country code", async () => {
      const { token } = await registerAccount(app);

      const response = await app.inject({
        method: "PATCH",
        url: "/business",
        headers: authHeader(token),
        payload: { country: "ZZ" },
      });

      expect(response.statusCode).toBe(400);
    });

    it("rejects an invalid IANA timezone", async () => {
      const { token } = await registerAccount(app);

      const response = await app.inject({
        method: "PATCH",
        url: "/business",
        headers: authHeader(token),
        payload: { timezone: "Not/AZone" },
      });

      expect(response.statusCode).toBe(400);
    });

    it("rejects a malformed currency code", async () => {
      const { token } = await registerAccount(app);

      const response = await app.inject({
        method: "PATCH",
        url: "/business",
        headers: authHeader(token),
        payload: { currency: "US" },
      });

      expect(response.statusCode).toBe(400);
    });

    it("leaves existing businesses fully compatible with null location fields", async () => {
      const { token, businessId } = await registerAccount(app);

      const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
      expect(business.country).toBeNull();
      expect(business.timezone).toBeNull();
      expect(business.currency).toBeNull();

      // The existing manual workflow must keep working with no location set.
      const response = await app.inject({ method: "GET", url: "/business", headers: authHeader(token) });
      expect(response.statusCode).toBe(200);
      expect(response.json().country).toBeNull();
    });
  });

  // ---------------------------------------------------------------------
  // Phone normalization
  // ---------------------------------------------------------------------

  describe("phone normalization", () => {
    it("normalizes a valid international number to E.164", () => {
      const result = parsePhoneNumber("+263 77 123 4567");
      expect(result.valid).toBe(true);
      expect(result.e164).toBe("+263771234567");
      expect(result.country).toBe("ZW");
    });

    it("normalizes a valid local number when a default region is supplied", () => {
      const result = parsePhoneNumber("0771234567", "ZW");
      expect(result.valid).toBe(true);
      expect(result.e164).toBe("+263771234567");
    });

    it("cannot normalize a bare local number without a default region", () => {
      const result = parsePhoneNumber("0771234567");
      expect(result.valid).toBe(false);
      expect(result.e164).toBeNull();
    });

    it("rejects an invalid number", () => {
      const result = parsePhoneNumber("not a phone number", "ZW");
      expect(result.valid).toBe(false);
      expect(result.e164).toBeNull();
    });

    it("toE164OrNull returns null instead of throwing for garbage input", () => {
      expect(toE164OrNull("")).toBeNull();
      expect(toE164OrNull(null)).toBeNull();
      expect(toE164OrNull(undefined)).toBeNull();
      expect(toE164OrNull("banana")).toBeNull();
    });

    it("validates real ISO 3166-1 alpha-2 country codes", () => {
      expect(isValidCountryCode("ZW")).toBe(true);
      expect(isValidCountryCode("US")).toBe(true);
      expect(isValidCountryCode("ZZ")).toBe(false);
    });

    it("derives phoneE164 on customer creation using the business's country", async () => {
      const { token, businessId } = await registerAccount(app);
      await prisma.business.update({ where: { id: businessId }, data: { country: "ZW" } });

      const response = await app.inject({
        method: "POST",
        url: "/customers",
        headers: authHeader(token),
        payload: { name: "Local number", phone: "0771234567" },
      });

      expect(response.statusCode).toBe(201);
      const customer = await prisma.customer.findUniqueOrThrow({ where: { id: response.json().id } });
      expect(customer.phone).toBe("0771234567"); // raw value untouched
      expect(customer.phoneE164).toBe("+263771234567");
    });

    it("does not reject customer creation when the phone can't be normalized (existing behavior preserved)", async () => {
      const { token } = await registerAccount(app);

      // No business country set, and the number isn't in international
      // form — this must still succeed exactly as it did before this phase.
      const response = await app.inject({
        method: "POST",
        url: "/customers",
        headers: authHeader(token),
        payload: { name: "Ungeocodable", phone: "not-a-real-number" },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().phone).toBe("not-a-real-number");
      const customer = await prisma.customer.findUniqueOrThrow({ where: { id: response.json().id } });
      expect(customer.phoneE164).toBeNull();
    });

    it("does not require a phone at all — existing customers without one are unaffected", async () => {
      const { token } = await registerAccount(app);

      const response = await app.inject({
        method: "POST",
        url: "/customers",
        headers: authHeader(token),
        payload: { name: "No phone" },
      });

      expect(response.statusCode).toBe(201);
      const customer = await prisma.customer.findUniqueOrThrow({ where: { id: response.json().id } });
      expect(customer.phone).toBeNull();
      expect(customer.phoneE164).toBeNull();
    });
  });

  // ---------------------------------------------------------------------
  // Messaging provider abstraction (compile-time + shape tests only —
  // no implementation exists yet, this proves the contract is usable)
  // ---------------------------------------------------------------------

  describe("messaging provider abstraction", () => {
    function makeFakeProvider(): { provider: MessagingProvider; sent: OutboundMessage[] } {
      const sent: OutboundMessage[] = [];
      const provider: MessagingProvider = {
        id: "fake-test-provider",
        supportsChannel: (channel) => channel === "sms",
        send: async (message) => {
          sent.push(message);
          return { accepted: true, providerMessageId: "fake-1", permanentFailure: false };
        },
        parseDeliveryWebhook: () => null,
        parseInboundWebhook: () => null,
        verifyWebhookSignature: () => false,
      };
      return { provider, sent };
    }

    it("is a usable, self-contained contract with no network calls", async () => {
      const { provider, sent } = makeFakeProvider();

      expect(provider.supportsChannel("sms")).toBe(true);
      expect(provider.supportsChannel("whatsapp")).toBe(false);

      const message: OutboundMessage = {
        to: "+263771234567",
        channel: "sms",
        body: "Test",
        countryCode: "ZW",
        idempotencyKey: "run-1",
      };
      const result = await provider.send(message);

      expect(result.accepted).toBe(true);
      expect(sent).toEqual([message]);
    });

    it("SendResult distinguishes permanent from transient failure", () => {
      const permanent: SendResult = { accepted: false, errorCode: "INVALID_NUMBER", permanentFailure: true };
      const transient: SendResult = { accepted: false, errorCode: "RATE_LIMITED", permanentFailure: false };

      expect(permanent.permanentFailure).toBe(true);
      expect(transient.permanentFailure).toBe(false);
    });

    it("constrains DeliveryStatus to the defined vocabulary", () => {
      const statuses: DeliveryStatus[] = ["queued", "sent", "delivered", "undelivered", "failed"];
      const event: DeliveryEvent = {
        providerMessageId: "fake-1",
        status: "delivered",
        occurredAt: new Date(),
      };
      expect(statuses).toContain(event.status);

      // @ts-expect-error — not part of the DeliveryStatus contract.
      const invalid: DeliveryStatus = "in_transit";
      void invalid;
    });

    it("supports a normalized InboundEvent shape for future replies/opt-outs", () => {
      const inbound: InboundEvent = {
        providerMessageId: "fake-1",
        from: "+263771234567",
        to: "+15005550006",
        body: "STOP",
        channel: "sms",
        receivedAt: new Date(),
      };
      expect(inbound.body).toBe("STOP");
      expect(inbound.channel).toBe("sms");
    });
  });

  // ---------------------------------------------------------------------
  // CustomerOptOut
  // ---------------------------------------------------------------------

  describe("customer opt-out", () => {
    it("scopes opt-out to a single business — Business A's opt-out does not affect Business B", async () => {
      const businessA = await registerAccount(app, { email: "optout-a@example.com" });
      const businessB = await registerAccount(app, { email: "optout-b@example.com" });
      const phone = "+263771234567";

      await prisma.customerOptOut.create({
        data: { businessId: businessA.businessId, phone, channel: "SMS", source: "manual" },
      });

      const optOutsForA = await prisma.customerOptOut.findMany({ where: { businessId: businessA.businessId, phone } });
      const optOutsForB = await prisma.customerOptOut.findMany({ where: { businessId: businessB.businessId, phone } });

      expect(optOutsForA).toHaveLength(1);
      expect(optOutsForB).toHaveLength(0);
    });

    it("prevents a duplicate opt-out for the same business/phone/channel", async () => {
      const { businessId } = await registerAccount(app);
      const phone = "+263771234567";

      await prisma.customerOptOut.create({
        data: { businessId, phone, channel: "SMS", source: "manual" },
      });

      await expect(
        prisma.customerOptOut.create({ data: { businessId, phone, channel: "SMS", source: "manual" } }),
      ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    });

    it("allows the same phone to opt out of different channels independently", async () => {
      const { businessId } = await registerAccount(app);
      const phone = "+263771234567";

      await prisma.customerOptOut.create({ data: { businessId, phone, channel: "SMS", source: "manual" } });
      await prisma.customerOptOut.create({ data: { businessId, phone, channel: "WHATSAPP", source: "manual" } });

      expect(await prisma.customerOptOut.count({ where: { businessId, phone } })).toBe(2);
    });

    it("supports an ALL-channel opt-out as a single row", async () => {
      const { businessId } = await registerAccount(app);
      const phone = "+263771234567";

      const optOut = await prisma.customerOptOut.create({
        data: { businessId, phone, channel: "ALL", source: "manual" },
      });

      expect(optOut.channel).toBe("ALL");
    });

    it("works with an optional customer relation, and without one", async () => {
      const { token, businessId } = await registerAccount(app);
      const created = await app.inject({
        method: "POST",
        url: "/customers",
        headers: authHeader(token),
        payload: { name: "Opts out", phone: "+263771234567" },
      });
      const customerId = created.json().id;

      const linked = await prisma.customerOptOut.create({
        data: { businessId, customerId, phone: "+263771234567", channel: "SMS", source: "customer_reply" },
      });
      const unlinked = await prisma.customerOptOut.create({
        data: { businessId, phone: "+263779999999", channel: "SMS", source: "manual" },
      });

      expect(linked.customerId).toBe(customerId);
      expect(unlinked.customerId).toBeNull();
    });

    it("survives the linked customer being deleted (customerId set null, row kept)", async () => {
      // A permanent opt-out record must outlive the Customer row it was
      // originally linked to — deleting the customer must never silently
      // resurrect their eligibility to be messaged.
      const { token, businessId } = await registerAccount(app);
      const created = await app.inject({
        method: "POST",
        url: "/customers",
        headers: authHeader(token),
        payload: { name: "Will be deleted", phone: "+263771234567" },
      });
      const customerId = created.json().id;

      const optOut = await prisma.customerOptOut.create({
        data: { businessId, customerId, phone: "+263771234567", channel: "SMS", source: "manual" },
      });

      await prisma.customer.delete({ where: { id: customerId } });

      const stillThere = await prisma.customerOptOut.findUniqueOrThrow({ where: { id: optOut.id } });
      expect(stillThere.customerId).toBeNull();
      expect(stillThere.phone).toBe("+263771234567");
    });
  });

  // ---------------------------------------------------------------------
  // Entitlement regression — automation gating unchanged by this phase
  // ---------------------------------------------------------------------

  describe("entitlement regression", () => {
    it("still denies AUTOMATION on FREE", () => {
      expect(hasFeature("FREE", "AUTOMATION")).toBe(false);
      expect(() => assertFeatureAvailable("FREE", "AUTOMATION")).toThrow(ApiError);
    });

    it("still allows AUTOMATION on PRO", () => {
      expect(hasFeature("PRO", "AUTOMATION")).toBe(true);
      expect(() => assertFeatureAvailable("PRO", "AUTOMATION")).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------
  // Critical regression: the manual product works exactly as before
  // ---------------------------------------------------------------------

  describe("manual workflow regression (no automation, no provider, no worker involved)", () => {
    it("lets a Free business create a lead, create a customer, generate a message, and keep working", async () => {
      const { token } = await registerAccount(app);

      const customer = await app.inject({
        method: "POST",
        url: "/customers",
        headers: authHeader(token),
        payload: { name: "Manual Flow Customer", phone: "+263771234567" },
      });
      expect(customer.statusCode).toBe(201);

      const lead = await app.inject({
        method: "POST",
        url: "/leads",
        headers: authHeader(token),
        payload: { customerId: customer.json().id, serviceRequested: "haircut" },
      });
      expect(lead.statusCode).toBe(201);

      const generated = await app.inject({
        method: "POST",
        url: `/leads/${lead.json().id}/generate-message`,
        headers: authHeader(token),
      });
      expect(generated.statusCode).toBe(200);
      expect(typeof generated.json().message).toBe("string");

      // Nothing about this flow required Twilio, a provider, a worker, or
      // any subscription beyond the default FREE one.
      const business = await app.inject({ method: "GET", url: "/business", headers: authHeader(token) });
      expect(business.statusCode).toBe(200);
    });
  });
});
