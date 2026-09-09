# Stage #18 — Omnichannel Communications

**Status:** IMPLEMENTED — audit closed the real gaps on the existing messaging
platform. Tests/typechecks: see below.
**Next stage:** #19 Marketplace & Discovery Completion.

---

## Baseline inspected (already substantially built)

The messaging subsystem is mature and was **not** rebuilt:

- `Conversation` + `ConversationParticipant` / `ConversationAssignment` /
  `ConversationLifecycleEvent` / `ConversationSLA` / `InternalConversationNote`.
- `Message` + `MessageContent` + `MessageAttachment` (malware-scanned) +
  `MessageDispatch` + `MessageDispatchAttempt` (lease/retry/DEAD queue) +
  `MessageReceipt` (delivery receipts, idempotent on `(provider, providerEventId)`).
- `MessagingChannelAccount` (provider, channel, health, capabilities) + encrypted,
  verified `ProviderCredential`; `providerRegistry.ts` — provider-neutral abstraction.
- `MessagingTemplate` + versions + locales + publish/rollback + preview.
- Inbound webhook (`POST /webhooks/twilio/inbound`) — **signature-verified**, STOP/START
  opt-out handling, feeds `handleInboundAIMessage` (AI eligibility + human takeover
  already wired via `automationMode`).
- Outbound: `enqueueMessage` enforces `OUTBOUND_MESSAGING` entitlement, messaging
  budget, `Suppression` + legacy `customerOptOut`, marketing consent, and is idempotent
  on `idempotencyKey`; durable dispatch with retry/DEAD + `/messages/failures` retry.
- `bulkConversationUpdate` / `mergeConversations` / `splitConversation` / SLA engine
  (`processConversationSLAs` breach → supervisor task).
- Mobile: `MessagesInboxScreen` (filters incl. unread, assignment, `automationMode`),
  `MessageThreadScreen`, `messagingApi`.

## Architecture reused

Everything above. `PlatformChannel` stays `"sms" | "whatsapp"` — the roadmap forbids
adding email/social/voice for feature count, and the provider registry +
`MessagingChannelAccount` already give a provider-neutral channel abstraction. No new
subsystem, no parallel inbox.

## Gaps found and closed

### A — Inbound message idempotency (was P1)
`recordInboundMessage` created a new `Message` on every call with no dedupe. A Twilio
webhook retry produced a **duplicate inbound row** and re-bumped
`conversation.waitingSince` / `lastInboundAt`. (The AI run and STOP/START were already
idempotent, so the blast radius was the duplicate + conversation churn.)

Fix (code only — no migration):
- `recordInboundMessage` now takes a **transaction-scoped advisory lock** on
  `hashtext('inbound:' + provider + ':' + providerMessageId)` and, before inserting,
  checks for an existing `INBOUND` message with the same `(businessId, provider,
  providerMessageId)`. If found it returns `{ message, conversationId, replayed: true }`
  and does nothing else. Concurrent deliveries of the same id serialize on the lock.
- The webhook loop skips `handleInboundAIMessage` on a replay (`inbound.replayed`).

### B — Durable terminal-outcome dispatch (roadmap §18 + deferred-cleanup register)
The #17 no-show follow-up (and the older cancellation confirmation) were fired
best-effort from the `POST /appointments/:id/status` request path. A transient provider
failure or a process crash mid-send **lost the message** — and the atomic claim on
`noShowFollowUpSentAt` would (for a hard failure) revert, but a crash between claim and
revert could strand it.

Fix:
- `sendDueCustomerAppointmentMessages` (the existing worker sweep in
  `scheduledWorkTrigger.ts`) gained two branches:
  `status = NO_SHOW` + `noShowFollowUpSentAt IS NULL` + `noShowFollowUpEnabled` +
  `startsAt` within 7 days → `sendCustomerAppointmentMessage(id, "no_show")`;
  `status = CANCELED` + `cancellationConfirmationSentAt IS NULL` + recent →
  `sendCustomerAppointmentMessage(id, "canceled")`.
- The **no-show route-level fire is removed** — it is now dispatched only by the
  durable sweep (a "we missed you" message is not time-critical to the second; ~1 min
  latency is fine, and it is now crash-safe and retried).
- The **cancellation route-level fire stays** (a "your appointment is off" message
  wants immediacy) with the sweep as a pure backstop.
- Idempotency is unchanged: the atomic `updateMany({ where: { [field]: null } })` claim
  inside `sendCustomerAppointmentMessage` guarantees the route fire and the sweep can
  never double-send; a soft provider failure reverts the claim so the next sweep retries.

### C — Server-side unread state
The inbox had no real unread signal; mobile derived it from `status`/`priority`.

Fix (additive migration `20260909140000_conversation_last_read`):
- `Conversation.last_read_at TIMESTAMP(3)` (nullable).
- `unread` is **derived**: `lastInboundAt != null && (lastReadAt == null || lastInboundAt
  > lastReadAt)` — computed in the `GET /messages/conversations` serializer.
- `GET /messages/conversations/:id` sets `lastReadAt = now()` (opening marks read for
  the business). New `POST /messages/conversations/:id/read` for mark-read without
  opening. `?unread=true` filter on the list.
- Mobile `isUnread` prefers `c.unread` (falls back to the old proxy for an older
  backend). Opening a thread already hits `GET /conversations/:id` → marks read.

## Authorization / tenant / security model

- Inbox routes remain under `fastify.authenticate` + `fastify.requireBusiness`; every
  query is `where: { …, businessId: request.businessId }`. `GET /conversations/:id`,
  `POST /conversations/:id/read` → 404 cross-tenant. `/conversations` list is
  business-scoped.
- Outbound consent/opt-out/budget/entitlement enforcement is unchanged (`enqueueMessage`
  + `sendCustomerAppointmentMessage` both enforce; the no-show sweep goes through the
  latter).
- Inbound webhook signature verification unchanged; idempotency added.
- AI gating unchanged — a customer reply to any of these messages still passes the full
  #15/#16 receptionist gate + human-takeover check; a webhook replay no longer even
  reaches the AI trigger.
- No cross-channel identity merging was added.

## Migrations

`20260909140000_conversation_last_read` — additive: `conversations.last_read_at`
(nullable). Ninth pending on Render (`docs/OWNER_ACTIONS.md` OA-1 batch grows by one).

## Tests / regressions / typechecks

`tests/omnichannel-inbox.test.ts` (new): inbound dedupe (direct + duplicate webhook
POST → 1 message, ≤1 AI run, `waitingSince` not re-bumped); durable no-show sweep
(sends once, idempotent second sweep, disabled → none, provider soft-fail → claim
reverts → next sweep retries); cancellation backstop sweep; unread lifecycle (inbound →
unread → open clears → new inbound re-flags → explicit mark-read); `?unread=true`
filter; tenant isolation on list / detail / mark-read.

**Results (test DB, PG 16.15):**

- `npx prisma generate` — clean.
- Backend `tsc --noEmit` — clean. Backend `tsc -p tsconfig.test.json --noEmit` — clean.
- `tests/omnichannel-inbox.test.ts` — **8/8 pass**.
- Regression: `no-show-automation` (14), `messaging-webhooks`, `messaging-platform-core`,
  `messaging-production-completion`, `messages`, `ai-customer-agent`, `ai-receptionist`,
  `after-hours-ai`, `appointments`, `appointment-arrival` — **all pass**.
- Mobile `tsc --noEmit` — clean. Mobile suite — **519/519 pass**.
- One regression fixed: `no-show-automation` test 10 ("pending customer reminders no
  longer send once the appointment is no-show") asserted **zero** outbound calls for a
  no-show appointment. The #18 durable sweep now legitimately dispatches the opt-in
  no-show follow-up (previously fired from the route). Updated to assert exactly one
  call — the "we missed you" follow-up — and no reminder. Stronger, not weaker.

## Files changed

- `prisma/schema.prisma` (`Conversation.lastReadAt`),
  `prisma/migrations/20260909140000_conversation_last_read/`
- `src/lib/messaging/messagingPlatform.ts` — `recordInboundMessage` advisory lock +
  dedupe + `RecordInboundResult`
- `src/modules/webhooks/webhooks.routes.ts` — skip AI trigger on replay
- `src/modules/appointments/appointmentReminders.ts` — NO_SHOW + CANCELED sweep branches
- `src/modules/appointments/appointments.routes.ts` — remove no-show route fire
- `src/modules/messages/messages.routes.ts` — `unread` in list, mark-read on open,
  `POST /conversations/:id/read`, `?unread=true`
- `mobile/src/services/endpoints.ts` — `ConversationSummaryDto.unread`,
  `markConversationRead`
- `mobile/src/screens/MessagesInboxScreen.tsx` — use server `unread`
- `tests/no-show-automation.test.ts` — test 10 updated for the durable no-show sweep;
  stale route-fire comment on test 14 corrected
- `tests/omnichannel-inbox.test.ts` — new

## Limitations

- No DB-level unique constraint on inbound `(provider, providerMessageId)` — the
  advisory lock + guard is race-safe for realistic webhook delivery; a
  `CREATE UNIQUE INDEX CONCURRENTLY` (with a prior dedupe of any historical
  production duplicates) is a candidate for #23 hardening.
- `canceled` still has a route-level best-effort fire in addition to the sweep
  backstop — deliberate (immediacy); the sweep guarantees eventual delivery.
- Channels remain SMS + WhatsApp. Web/voice/email are post-V1 (roadmap §9) and gated on
  their own provider/cost/consent decisions.
- The no-show follow-up now has ~worker-tick latency (≈1 min) instead of being sent
  from the request — an intentional durability trade.

## Owner actions

None new. `docs/OWNER_ACTIONS.md` OA-1 (the migration-deploy checkpoint) now covers 9
pending migrations.

## Next stage

#19 Marketplace & Discovery Completion.
