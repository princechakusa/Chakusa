# Meta WhatsApp Cloud API adapter (WhatsApp without Twilio)

**Status:** code complete and tested behind a flag (`META_WHATSAPP_ENABLED`, off by default). Switching it on needs the Meta credentials in OA-12.

## Why

Twilio's toll-free SMS verification was rejected (see the 30474/30513 report) and a US toll-free number cannot text Zimbabwe or the UAE anyway. WhatsApp is the channel the missed-call text-back, review requests and AI booking assistant need, so it now goes to Meta's Cloud API directly, with no reseller.

## Baseline inspected

- `MessagingProvider` interface and `providerRegistry`. The provider is already pluggable.
- Twilio adapter, `messagingService` default provider, `messagingPlatform` dispatch (provider id is stored per dispatch), review automation, WhatsApp template helper.
- Inbound webhook that records the message, gives the AI customer agent one turn, and honours STOP.

## Implementation

- `src/lib/messaging/metaWhatsAppProvider.ts`: `MetaWhatsAppProvider` (id `meta_whatsapp`, WhatsApp only).
  - Sends text or approved templates through `graph.facebook.com/{version}/{phone-number-id}/messages`.
  - Classifies permanent failures (outside the 24-hour window, template missing or paused, bad token) versus transient ones.
  - Verifies `X-Hub-Signature-256` with a timing-safe HMAC of the raw body, keyed by the app secret.
  - Parses inbound messages and delivery statuses.
  - Registers itself in the provider registry so queued dispatches resolve it.
- `src/lib/messaging/defaultMessagingProvider.ts`: app-wide default. WhatsApp goes to Meta when `META_WHATSAPP_ENABLED` and credentials exist; everything else, and WhatsApp when Meta is off, stays on Twilio. Nothing changes until the flag is on.
- Webhooks: `GET /webhooks/meta/whatsapp` (Meta's subscription check against `META_WHATSAPP_VERIFY_TOKEN`) and `POST /webhooks/meta/whatsapp`. Inbound handling was extracted into one shared function used by both Twilio and Meta, so STOP, per-business recording and the AI turn behave identically.
- Templates: when Meta is active, missed-call and review-request messages use `META_WHATSAPP_MISSED_CALL_TEMPLATE` and `META_WHATSAPP_REVIEW_REQUEST_TEMPLATE` (Meta template names; variables `{{1}}..` are the same as the Twilio ones).
- Config: new `META_WHATSAPP_*` and `META_GRAPH_API_VERSION` (default `v25.0`) settings, validated in production when the flag is on.

## Authorization / tenant / security model

- The webhook is unauthenticated by design and authenticates by signature. A missing or wrong signature returns 401 and nothing is recorded. The subscription check needs the verify token.
- Inbound messages are recorded per business that has the customer, idempotent on Meta's message id. The AI turn goes to a single business, as for Twilio.
- Opt-outs (STOP) are per business and per channel (`WHATSAPP`).
- No secrets are in the repo. Credentials are environment variables only.

## Migrations

None.

## Tests

- `tests/meta-whatsapp.test.ts`: send (text, template ordering, failure classification), signature verification, inbound and status parsing, webhook route (bad signature, verify token, idempotent inbound, STOP, delivery status).
- Full backend suite, typecheck and lint are run before each push.

## Meta setup done

- Meta app "Chakusa" (app id 986964310502058) created in the owner's PaMarket App portfolio with the WhatsApp use case, and a WhatsApp test number claimed (phone number ID 1440054135853374, WhatsApp Business Account 1107315785264094).

## Unresolved limitations

- Only the Meta test number exists. It can message at most 5 allow-listed recipients. A real business number must be added in Meta (Step 2 Production setup) before customers can be reached.
- Business verification is not done (the portfolio is "PaMarket App"; see OA-12).
- The free-form AI reply works only inside the customer's 24-hour window; business-initiated messages need approved templates.
- WhatsApp consent wording for opt-in is not written yet.

## Owner actions

See OA-12.

## Next stage

Production hardening: turn the flag on once OA-12 is complete and run the live end-to-end check.
