import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import { MetaWhatsAppProvider, type MetaFetch } from "../src/lib/messaging/metaWhatsAppProvider.js";
import type { OutboundMessage } from "../src/lib/messaging/messagingProvider.js";
import { createTestApp, registerAccount, resetDatabase } from "./helpers.js";

const SECRET = "meta-app-secret-for-tests";
const settings = { accessToken: "token", phoneNumberId: "1234567890", appSecret: SECRET, apiVersion: "v25.0", templateLanguage: "en" };
const message: OutboundMessage = { to: "+263771234567", channel: "whatsapp", body: "Hello", countryCode: "ZW", idempotencyKey: "k1" };

type Call = { url: string; body: Record<string, unknown>; auth: string };

function fakeFetch(status: number, body: unknown, calls: Call[] = []): MetaFetch {
  return async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization ?? "" });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
}

const sign = (raw: string) => `sha256=${createHmac("sha256", SECRET).update(raw).digest("hex")}`;

describe("MetaWhatsAppProvider", () => {
  it("only supports WhatsApp, and only once configured", () => {
    expect(new MetaWhatsAppProvider(settings).supportsChannel("whatsapp")).toBe(true);
    expect(new MetaWhatsAppProvider(settings).supportsChannel("sms")).toBe(false);
    expect(new MetaWhatsAppProvider({ ...settings, accessToken: undefined }).supportsChannel("whatsapp")).toBe(false);
  });

  it("sends free-form text with a bearer token and no plus in the recipient", async () => {
    const calls: Call[] = [];
    const result = await new MetaWhatsAppProvider(settings, fakeFetch(200, { messages: [{ id: "wamid.1" }] }, calls)).send(message);
    expect(result).toEqual({ accepted: true, providerMessageId: "wamid.1", permanentFailure: false });
    expect(calls[0]).toMatchObject({ url: "https://graph.facebook.com/v25.0/1234567890/messages", auth: "Bearer token", body: { messaging_product: "whatsapp", to: "263771234567", type: "text", text: { body: "Hello" } } });
  });

  it("sends a template with ordered body parameters", async () => {
    const calls: Call[] = [];
    await new MetaWhatsAppProvider(settings, fakeFetch(200, { messages: [{ id: "wamid.2" }] }, calls)).send({ ...message, template: { contentSid: "review_request", variables: { "2": "Ada Hair", "1": "Chipo", "3": "https://x.test/r" } } });
    expect(calls[0]?.body).toMatchObject({ type: "template", template: { name: "review_request", language: { code: "en" }, components: [{ type: "body", parameters: [{ type: "text", text: "Chipo" }, { type: "text", text: "Ada Hair" }, { type: "text", text: "https://x.test/r" }] }] } });
  });

  it("classifies permanent and transient failures", async () => {
    expect(await new MetaWhatsAppProvider(settings, fakeFetch(400, { error: { code: 131047 } })).send(message)).toMatchObject({ accepted: false, errorCode: "131047", permanentFailure: true });
    expect(await new MetaWhatsAppProvider(settings, fakeFetch(401, { error: { code: 190 } })).send(message)).toMatchObject({ permanentFailure: true });
    expect(await new MetaWhatsAppProvider(settings, fakeFetch(500, { error: { code: 2 } })).send(message)).toMatchObject({ errorCode: "2", permanentFailure: false });
    expect(await new MetaWhatsAppProvider(settings, async () => { throw new Error("down"); }).send(message)).toMatchObject({ errorCode: "NETWORK_ERROR", permanentFailure: false });
    expect(await new MetaWhatsAppProvider({ ...settings, accessToken: undefined }).send(message)).toMatchObject({ errorCode: "PROVIDER_NOT_CONFIGURED", permanentFailure: true });
  });

  it("verifies the webhook HMAC over the raw body", () => {
    const provider = new MetaWhatsAppProvider(settings);
    const raw = JSON.stringify({ entry: [] });
    expect(provider.verifyWebhookSignature(raw, new Headers({ "x-hub-signature-256": sign(raw) }))).toBe(true);
    expect(provider.verifyWebhookSignature(raw, new Headers({ "x-hub-signature-256": sign(`${raw} `) }))).toBe(false);
    expect(provider.verifyWebhookSignature(raw, new Headers())).toBe(false);
    expect(new MetaWhatsAppProvider({ ...settings, appSecret: undefined }).verifyWebhookSignature(raw, new Headers({ "x-hub-signature-256": sign(raw) }))).toBe(false);
  });

  it("parses inbound messages and delivery statuses", () => {
    const payload = { entry: [{ changes: [{ value: { metadata: { display_phone_number: "15551234567" }, messages: [{ from: "263771234567", id: "wamid.in", timestamp: "1790000000", type: "text", text: { body: "Hi" } }, { from: "1", id: "x", type: "image" }], statuses: [{ id: "wamid.1", status: "read", timestamp: "1790000001" }, { id: "wamid.2", status: "failed", errors: [{ code: 131026 }] }] } }] }] };
    const provider = new MetaWhatsAppProvider(settings);
    expect(provider.parseInboundWebhooks(payload)).toEqual([{ providerMessageId: "wamid.in", from: "+263771234567", to: "+15551234567", body: "Hi", channel: "whatsapp", receivedAt: new Date(1790000000000) }]);
    expect(provider.parseDeliveryWebhooks(payload).map((event) => [event.providerMessageId, event.status, event.errorCode])).toEqual([["wamid.1", "delivered", undefined], ["wamid.2", "failed", "131026"]]);
    expect(provider.parseInboundWebhook({})).toBeNull();
  });
});

describe("Meta WhatsApp webhook route", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp({ metaWhatsAppProvider: new MetaWhatsAppProvider(settings) }); });
  afterEach(resetDatabase);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  const post = (payload: unknown, signature?: string) => {
    const raw = JSON.stringify(payload);
    return app.inject({ method: "POST", url: "/webhooks/meta/whatsapp", headers: { "content-type": "application/json", "x-hub-signature-256": signature ?? sign(raw) }, payload: raw });
  };

  it("rejects a bad signature and an unsigned call", async () => {
    expect((await post({ entry: [] }, "sha256=deadbeef")).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/webhooks/meta/whatsapp", payload: { entry: [] } })).statusCode).toBe(401);
  });

  it("refuses the subscription check without the verify token", async () => {
    expect((await app.inject({ method: "GET", url: "/webhooks/meta/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=42" })).statusCode).toBe(403);
  });

  it("records an inbound WhatsApp message once and honours STOP per business", async () => {
    const account = await registerAccount(app, { email: "meta-inbound@example.com" });
    await prisma.customer.create({ data: { businessId: account.businessId, name: "Chipo", phone: "+263771234567", phoneE164: "+263771234567" } });
    const payload = (id: string, text: string) => ({ entry: [{ changes: [{ value: { metadata: { display_phone_number: "15551234567" }, messages: [{ from: "263771234567", id, timestamp: "1790000000", type: "text", text: { body: text } }] } }] }] });
    expect((await post(payload("wamid.A", "hello"))).statusCode).toBe(200);
    expect((await post(payload("wamid.A", "hello"))).statusCode).toBe(200);
    expect(await prisma.message.count({ where: { businessId: account.businessId, direction: "INBOUND", providerMessageId: "wamid.A" } })).toBe(1);
    await post(payload("wamid.B", "STOP"));
    expect(await prisma.customerOptOut.findFirst({ where: { businessId: account.businessId, phone: "+263771234567" } })).toMatchObject({ channel: "WHATSAPP", source: "provider_webhook" });
  });

  it("updates a message from a delivery status", async () => {
    const account = await registerAccount(app, { email: "meta-status@example.com" });
    const customer = await prisma.customer.create({ data: { businessId: account.businessId, name: "S", phone: "+263771111111", phoneE164: "+263771111111" } });
    await prisma.message.create({ data: { businessId: account.businessId, customerId: customer.id, messageType: "custom", body: "Hi", status: "sent", provider: "meta_whatsapp", providerMessageId: "wamid.S" } });
    await post({ entry: [{ changes: [{ value: { statuses: [{ id: "wamid.S", status: "delivered", timestamp: "1790000000" }] } }] }] });
    expect(await prisma.message.findFirst({ where: { providerMessageId: "wamid.S" }, select: { status: true } })).toMatchObject({ status: "delivered" });
  });
});
