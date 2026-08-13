/**
 * Developer-only manual verification script.
 *
 * Sends exactly ONE real SMS through the configured Twilio account. This is
 * NEVER run automatically — it is not part of `npm test`, `npm run build`,
 * `npm run lint`, or application startup, and requires the developer to
 * explicitly provide a destination number on the command line every time.
 *
 * Usage:
 *   npm run send-test-sms -- +15551234567 "Test message from Chakusa"
 *
 * Requires (via .env or the environment — see src/lib/config.ts):
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_FROM_NUMBER  (or TWILIO_MESSAGING_SERVICE_SID)
 *
 * Never logs TWILIO_AUTH_TOKEN or any other credential — only the send
 * outcome (accepted/rejected, provider message id, error code) is printed.
 */
import { TwilioMessagingProvider } from "../src/lib/messaging/twilioProvider.js";

async function main() {
  const [to, ...bodyParts] = process.argv.slice(2);

  if (!to) {
    console.error("Usage: npm run send-test-sms -- <E.164 destination> [message body]");
    console.error('Example: npm run send-test-sms -- +15551234567 "Hello from Chakusa"');
    process.exitCode = 1;
    return;
  }

  const body = bodyParts.join(" ").trim() || "Chakusa Twilio test message";

  console.log(`Sending to ${to}…`);
  const provider = new TwilioMessagingProvider();
  const result = await provider.send({
    to,
    channel: "sms",
    body,
    countryCode: "ZZ",
    idempotencyKey: `manual-test-${Date.now()}`,
  });

  if (result.accepted) {
    console.log(`Accepted. Provider message id: ${result.providerMessageId}`);
  } else {
    console.error(`Not accepted. errorCode=${result.errorCode ?? "unknown"} permanentFailure=${result.permanentFailure}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Failed to send test SMS:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
