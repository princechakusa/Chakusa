import { describe, expect, it } from "vitest";
import twilio from "twilio";
import { TwilioMessagingProvider, type TwilioRestClient } from "../src/lib/messaging/twilioProvider.js";
import type { MessagingProvider, OutboundMessage } from "../src/lib/messaging/messagingProvider.js";

const baseMessage: OutboundMessage = {
  to: "+263771234567",
  channel: "sms",
  body: "Test message",
  countryCode: "ZW",
  idempotencyKey: "test-key-1",
};

function restError(statusCode: number, code: number, message: string) {
  return new twilio.RestException({ statusCode, body: JSON.stringify({ code, message }) });
}

// Sender config is injected explicitly rather than read from the real
// config module (which has no Twilio credentials in the test environment
// by design — see .env.example) so these tests are self-contained and
// never depend on ambient environment state.
function makeProvider(client: TwilioRestClient) {
  return new TwilioMessagingProvider(client, { fromNumber: "+15005550006" });
}

describe("TwilioMessagingProvider", () => {
  it("reports SMS as a supported channel", () => {
    const provider = makeProvider({ messages: { create: async () => ({ sid: "SM1", status: "queued" }) } });
    expect(provider.supportsChannel("sms")).toBe(true);
  });

  it("reports WhatsApp as unsupported", () => {
    const provider = makeProvider({ messages: { create: async () => ({ sid: "SM1", status: "queued" }) } });
    expect(provider.supportsChannel("whatsapp")).toBe(false);
  });

  it("does not call the client at all for an unsupported channel", async () => {
    let called = false;
    const provider = makeProvider({ messages: { create: async () => { called = true; return { sid: "SM1", status: "queued" }; } } });

    const result = await provider.send({ ...baseMessage, channel: "whatsapp" });

    expect(called).toBe(false);
    expect(result.accepted).toBe(false);
    expect(result.permanentFailure).toBe(true);
  });

  it("returns a provider-neutral SendResult with no Twilio-specific fields on success", async () => {
    const provider = makeProvider({ messages: { create: async () => ({ sid: "SM123", status: "queued" }) } });

    const result = await provider.send(baseMessage);

    expect(result.accepted).toBe(true);
    expect(result.providerMessageId).toBe("SM123");
    expect(result.permanentFailure).toBe(false);
    // Nothing beyond the MessagingProvider contract's own fields — proves
    // the adapter doesn't leak Twilio's MessageInstance shape (accountSid,
    // dateSent, uri, subresourceUris, ...) through the service boundary.
    expect(Object.keys(result).sort()).toEqual(["accepted", "permanentFailure", "providerMessageId"].sort());
  });

  it("exposes id \"twilio\" and satisfies the MessagingProvider contract", () => {
    const provider: MessagingProvider = makeProvider({ messages: { create: async () => ({ sid: "SM1", status: "queued" }) } });
    expect(provider.id).toBe("twilio");
  });

  it("classifies a known permanent Twilio error code as permanent, non-network-retryable", async () => {
    const provider = makeProvider({
      messages: { create: async () => { throw restError(400, 21211, "Invalid 'To' Phone Number"); } },
    });

    const result = await provider.send(baseMessage);

    expect(result.accepted).toBe(false);
    expect(result.permanentFailure).toBe(true);
    expect(result.errorCode).toBe("21211");
  });

  it("classifies a Twilio authentication error (401) as permanent", async () => {
    const provider = makeProvider({
      messages: { create: async () => { throw restError(401, 20003, "Authentication Error"); } },
    });

    const result = await provider.send(baseMessage);

    expect(result.permanentFailure).toBe(true);
  });

  it("classifies an unrecognized Twilio error code as transient", async () => {
    const provider = makeProvider({
      messages: { create: async () => { throw restError(500, 20500, "Internal Server Error"); } },
    });

    const result = await provider.send(baseMessage);

    expect(result.accepted).toBe(false);
    expect(result.permanentFailure).toBe(false);
    expect(result.errorCode).toBe("20500");
  });

  it("classifies a non-Twilio error (e.g. network failure) as transient", async () => {
    const provider = makeProvider({
      messages: { create: async () => { throw new Error("ECONNRESET"); } },
    });

    const result = await provider.send(baseMessage);

    expect(result.accepted).toBe(false);
    expect(result.permanentFailure).toBe(false);
  });

  it("never calls the client and reports a configuration error when no sender is configured", async () => {
    let called = false;
    const provider = new TwilioMessagingProvider(
      { messages: { create: async () => { called = true; return { sid: "SM1", status: "queued" }; } } },
      {}, // no fromNumber, no messagingServiceSid
    );

    const result = await provider.send(baseMessage);

    expect(called).toBe(false);
    expect(result.accepted).toBe(false);
    expect(result.errorCode).toBe("PROVIDER_NOT_CONFIGURED");
    expect(result.permanentFailure).toBe(true);
  });
});
