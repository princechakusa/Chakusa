# Chakusa production hardening — #23 audit & operational reference

Companion to `docs/BACKUP_AND_RECOVERY.md` and `docs/INCIDENT_RECOVERY.md`.
This records the #23 review of every hardening area, the fixes made, and the
deployment inputs the code cannot set for itself.

**Completion bar:** fault-injection / retry tests, operational runbooks, no P0/P1
findings. No P0/P1 remain open; the two remaining P2 items are deployment-config
(DB connection string) and are documented below with exact values.

---

## 1. Background worker reliability — FIXED

There are two worker mechanisms, and they must stay equivalent:

| | `startAutomationWorker` (`src/worker/automationWorker.ts`) | `runTriggeredScheduledWork` (`src/worker/scheduledWorkTrigger.ts`) |
|---|---|---|
| Shape | long-running poll loop, separate process (`src/worker.ts`) | one bounded cycle per `POST /internal/worker/tick` (external cron) |
| Use | deployments that run a worker dyno | deployments that ping the tick endpoint on a schedule |

**Finding (was P1):** the tick path was missing jobs the poll loop runs —
`processMessageDispatches` (the durable generic-outbound queue behind
`enqueueMessage`), `processConversationSLAs`, attachment scan/expire/recover,
`monitorProviderHealth`, `refreshProviderCredentials`,
`processProviderTemplateSynchronizations`. A tick-path deployment silently never
processed any of those.

**Finding (was P1):** the tick cycle ran 13 `await`s with no isolation, then wrote
the heartbeat last. One throw (a poison-pill row) aborted the whole cycle *and*
skipped the heartbeat → `/health/worker` 503 → platform restart loop that the bad
row never clears.

**Fix:**
- `runTriggeredScheduledWork` brought to job parity with the poll loop.
- Every step runs isolated via `step(name, fn)`: a throw is captured to Sentry
  (tagged `scope=scheduled-work`, `step=<name>`), counted in `result.failedSteps`,
  and never aborts the cycle or the heartbeat.
- If `getAutomationFoundationStatus()` (kill-switch / maintenance read) throws, the
  cycle **fails safe** — it does no automation work that tick (`result.skipped`)
  but still heartbeats.
- The heartbeat write itself is wrapped; a heartbeat failure is logged, not fatal.

**How to read it:** a healthy tick returns `failedSteps: 0`. A steady non-zero
`failedSteps` (or a rising Sentry rate on `scope:scheduled-work`) means a specific
step is failing — filter Sentry by the `step` tag; the rest of the cycle is still
running. `skipped: true` means the flag store was unreachable that tick.

## 2. Outbox processing guarantees — REVIEWED, no change

`src/worker/outboxPublisher.ts`: claim with `FOR UPDATE SKIP LOCKED` + a 60s lease;
strict per-aggregate ordering (`NOT EXISTS earlier unpublished`); exponential
backoff (`5s·2^n`, capped 1h); `DEAD` after 10 attempts; `recoverExpiredOutboxClaims`
splits lease-expired `PROCESSING` rows into terminal `DEAD` vs retryable `FAILED`.
This is the reference pattern the rest of the codebase mirrors.

## 3. Message-dispatch queue — FIXED

`processMessageDispatches` claims only `PENDING`/`RETRY`. **Finding (was P1):** a
dispatch stranded in `PROCESSING` by a crashed worker (lease set, never resolved)
was never reclaimed — the message neither sent nor failed, forever.

**Fix:** `recoverStuckMessageDispatches(now)` (mirrors the outbox recovery) flips
lease-expired `PROCESSING` rows to `RETRY`, or `DEAD` when over `maxAttempts`.
Wired into both workers, run before the dispatch step each cycle. The provider
`idempotencyKey` on each dispatch makes a re-send of an already-accepted message
safe.

Per-message degradation is unchanged and adequate: exponential backoff
(`1s·2^attempts`, capped 1h), `DEAD` on permanent provider errors, manual
`/messages/failures/:id/retry`. A dedicated provider circuit breaker (pause **all**
sends on an error spike) is **not** implemented for messaging — the per-message
backoff already prevents a thundering herd against a down provider. P3, accepted.

## 4. Webhook signature verification & replay — REVIEWED, no change

`/webhooks/twilio/*`: `verifyWebhookSignature` runs before any processing (401 on
mismatch). Replay is neutralised by idempotency, not by a timestamp check (Twilio's
scheme has no timestamp): delivery receipts upsert on `(provider, providerEventId)`;
inbound messages dedupe on `(businessId, provider, providerMessageId)` under a
transaction advisory lock (#18). A captured-and-replayed valid request produces no
duplicate row and no duplicate AI run.

## 5. Rate limits — REVIEWED, no change

Global `@fastify/rate-limit` 200/min; tighter per-route on auth (10–30 / 15 min on
login / register / reset), public booking/review/profile (8–60 / min), and the
worker tick (5 / min). `trustProxy` must be enabled in production (see §11) or every
client shares the proxy's IP. Disabled in `NODE_ENV=test` unless a test opts in.

## 6. DB query / index review & N+1 — REVIEWED

Spot-checked the heaviest list paths:
- **Marketplace discovery** (`src/lib/marketplace/discovery.ts`): per-page batched
  `groupBy` for ratings, and `findMany` for loyalty / membership / bookable — flat
  query count regardless of result size, guarded by
  `tests/marketplace-discovery-e2e.test.ts`'s N+1 assertion (#19).
- **Messages inbox** (`GET /messages/conversations`): one `findMany` with
  `include: { messages: take 1, slas }` — no per-row query.
- **Appointments / dispatch board**: single query with includes.
- Outbox / dispatch claim queries use `FOR UPDATE SKIP LOCKED` with `LIMIT` — no
  full-table scans on the hot path; supporting indexes exist
  (`@@index([status, endsAt, followUpSentAt])` etc.).

No P1 N+1 found. One P3 in the register: marketplace category browse resolves the
industry→category map partly in memory (roadmap §10 deferred).

## 7. Connection pool / timeouts — DOC (deployment config)

The code cannot set these without the production connection string. Required
`DATABASE_URL` (the pgbouncer-pooled endpoint) parameters:

```
?connection_limit=<N>&pool_timeout=10&connect_timeout=5&options=-c%20statement_timeout%3D30000
```

- **`connection_limit`** — set per API replica so `replicas · connection_limit` ≤
  the Postgres/pgbouncer ceiling (Prisma's default `num_cpus·2+1` overshoots on a
  small pool and is the cause of the "Internal server error on registration"
  contention seen under heavy parallel load).
- **`pool_timeout=10`** — fail fast instead of hanging when the pool is drained.
- **`connect_timeout=5`** — bound the initial TCP+TLS.
- **`statement_timeout=30000`** — a runaway query releases its connection after
  30 s instead of holding it forever. This is the handler-execution bound that
  Fastify's `requestTimeout` (60 s, slow-loris only) does **not** provide.
- `DIRECT_URL` (unpooled) is used only for `prisma migrate deploy`; leave it plain.

Fastify: `requestTimeout: 60_000`, explicit global `bodyLimit: 1 MiB` (upload routes
raise it per-route), graceful `SIGTERM` drain (`app.close()` then
`prisma.$disconnect()`), `uncaughtException` → exit (clean restart),
`unhandledRejection` → capture-and-continue. All present in `src/app.ts` /
`src/server.ts`.

## 8. Structured logs & correlation IDs — FIXED

pino JSON logs in production. **Finding (was P2):** no request correlation id.
**Fix:** `genReqId` mints a UUID per request (or trusts an inbound `X-Request-Id`
**only** when `TRUST_PROXY` is on); it is logged on every line for the request,
echoed in the `X-Request-Id` response header, and tagged `requestId` on the Sentry
event. Background-step failures carry `scope` + `step` tags (§1).

## 9. Sentry / monitoring — REVIEWED, minor add

`initSentry()` before `buildApp()` (so a boot failure is still reported);
`attachFastifySentry` via a plain `onError` hook that never alters the response;
`shouldCaptureError` captures only ≥500 / un-classified errors (4xx business
outcomes never page). `beforeSend` scrubs headers, query string, cookies and a
sensitive-key list. `captureUnexpectedError(error, { tags })` now attaches
background-context tags. Process-level handlers flush before exit.

## 10. Health / readiness — REVIEWED, no change

- `GET /health` — liveness, DB-free.
- `GET /health/ready` — `SELECT 1`; 503 if the DB is unreachable.
- `GET /health/worker` — heartbeat freshness (stale > 90 s → 503).
- `GET /health/automation` — automation subsystem status.
- `GET /health/ai` — AI kill switch + provider circuit-breaker snapshot; 503 on an
  open breaker.

Point the platform's liveness probe at `/health`, readiness at `/health/ready`,
and an external monitor at `/health/worker` + `/health/ai`.

## 11. Feature-flag failure modes — FIXED (worker) / REVIEWED (request path)

- Worker: a failed flag/kill-switch read now fails safe (skip the cycle, still
  heartbeat) — §1.
- Request path: `assertFeatureAvailable` / `hasFeature` are pure functions over the
  caller's plan+status (already on the JWT/tenant context) — no DB read, no failure
  mode. Per-business AI flags (`ai.customer_agent`) are read inside the receptionist
  gate; a read failure there throws a 5xx (captured), it does **not** silently
  enable the AI. Kill switches default to *enabled* only when the query **succeeds
  and returns nothing** — a thrown query never reads as "enabled".

## 12. Provider circuit breakers — REVIEWED

AI: real breaker, surfaced at `/health/ai` (`circuitBreakerSnapshot`). Messaging:
per-message exponential backoff + `DEAD` (see §3) — accepted as the degradation
mechanism; a global breaker is a P3 future item.

## 13. Push notification failure handling — REVIEWED, no change

`expoPushProvider` maps `DeviceNotRegistered` → `invalidToken`; `sendPushToUser`
deactivates those tokens (`revokedReason: "provider_reported_invalid"`). A send
failure never throws into the caller's transaction.

## 14. Debug / test bypasses in production paths — REVIEWED, none

Grep for `NODE_ENV === "test"` / `SKIP_` / `BYPASS` / `x-test-` in `src/` (excluding
tests): 3 hits, all legitimate (logger transport by env, fake-AI-provider
registration guarded to non-prod, prod-only config validation). No auth/tenant/
capability/payment bypass exists.

---

## Runbook additions (see also `docs/INCIDENT_RECOVERY.md`)

### Worker: `/health/worker` is 503

1. Is the worker process / tick cron alive? (`startAutomationWorker` dyno up, or the
   external scheduler still calling `POST /internal/worker/tick`).
2. If alive but stale: check Sentry for `scope:scheduled-work`. A single failing
   `step` no longer stops the cycle — the heartbeat should still be current. If the
   heartbeat is genuinely stale with the process up, the tick is hanging inside one
   step (likely a DB statement — confirm `statement_timeout` is set, §7).
3. `skipped: true` in the tick response / logs → the flag store (Postgres
   `platform_settings` / `feature_flags`) was unreachable; this is a DB incident,
   not a worker bug.

### Poison-pill row (one entity fails a sweep every cycle)

The cycle keeps running; `failedSteps` stays ≥ 1 and Sentry shows the same
`step` + stack repeatedly. Identify the entity from the Sentry stack / error,
fix or quarantine the row (e.g. set the offending appointment's claim column, or
`status`), and the step goes green on the next tick. No restart needed.

### Message dispatches stuck / not sending

1. `SELECT status, count(*) FROM message_dispatches GROUP BY 1;`
2. Rows stuck in `PROCESSING` with `lease_expires_at` in the past →
   `recoverStuckMessageDispatches` runs each cycle and should clear them; if the
   worker isn't cycling, that's the real problem (above).
3. `DEAD` rows: inspect `last_error`. Transient provider outage → bump them back
   with `POST /messages/failures/:id/retry` once the provider recovers. Permanent
   (bad number, opt-out) → leave `DEAD`.

### DB connection-pool exhaustion

Symptoms: `/health/ready` flaps, "too many connections", timeouts on writes. Fix:
reduce API replicas or lower `connection_limit` so `replicas · connection_limit`
fits the pool; confirm `DATABASE_URL` is the **pooled** endpoint and
`pool_timeout`/`statement_timeout` are set (§7). Restore drills and PITR per
`BACKUP_AND_RECOVERY.md`.

---

## Deployment inputs still owned by the owner (tracked in `docs/OWNER_ACTIONS.md`)

- **DB connection-string parameters** (§7) — set on the Render Postgres
  `DATABASE_URL`. Not code; must be applied at deploy.
- OA-1 production migration deploy; OA-5 app-link identifiers — unrelated to #23 but
  still open.
