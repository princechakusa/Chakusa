# Stage #23 — Production Hardening

**Status:** COMPLETE. Audit of all 14 scope areas; P1 worker-reliability defects
fixed; P2 correlation-id gap fixed; the remaining P2 (DB connection-string
parameters) is deployment config, documented with exact values. Fault-injection /
retry tests added. Operational runbook written. No P0/P1 findings open.
**Next stage:** #24 Pre-release Security & Privacy Audit.

---

## Baseline inspected

The codebase was already well hardened: lease-based outbox with `SKIP LOCKED` +
ordered delivery + retry/DEAD + recovery; signature-verified idempotent webhooks;
per-route rate limits on auth/public; `/health`, `/health/ready`, `/health/worker`,
`/health/automation`, `/health/ai`; AI provider circuit breakers; Sentry with PII
scrubbing + process-level handlers; graceful `SIGTERM` drain; invalid-push-token
cleanup; `BACKUP_AND_RECOVERY.md` + `INCIDENT_RECOVERY.md` runbooks. The audit
focused on finding the gaps between "looks hardened" and "is hardened".

## Findings & fixes

### P1 — the two worker paths were not equivalent
`runTriggeredScheduledWork` (the `POST /internal/worker/tick` path for cron-ping
deployments) was missing jobs the long-running `startAutomationWorker` runs:
**message-dispatch draining** (`enqueueMessage`'s durable queue), conversation
SLAs, attachment scan/expire/recover, provider health/credential/template sync. A
tick-path deployment silently never processed any of them.

**Fix:** brought `runTriggeredScheduledWork` to full job parity.

### P1 — one failing step killed the whole cycle and the heartbeat
13 sequential `await`s, heartbeat written last. A single poison-pill row → cycle
aborts, heartbeat skipped → `/health/worker` 503 → restart loop the bad row never
clears.

**Fix:** each step runs isolated (`step(name, fn)`): a throw is captured to Sentry
(`scope=scheduled-work`, `step=<name>`), counted in `result.failedSteps`, never
aborts the cycle. The heartbeat is always written (its own try/catch). If the
kill-switch/maintenance read throws, the cycle fails safe (`skipped: true`, no
work) but still heartbeats.

### P1 — message dispatches could strand in PROCESSING forever
`processMessageDispatches` claims only `PENDING`/`RETRY`; a dispatch left
`PROCESSING` by a crashed worker (lease set, never resolved) was never reclaimed —
the message neither sent nor failed.

**Fix:** `recoverStuckMessageDispatches(now)` — mirrors `recoverExpiredOutboxClaims`
(lease-expired `PROCESSING` → `RETRY`, or `DEAD` over `maxAttempts`). Wired into
both workers, run before the dispatch step.

### P2 — no request correlation id
**Fix:** `genReqId` mints a UUID per request (trusts an inbound `X-Request-Id`
**only** when `TRUST_PROXY` is on); logged on every pino line, echoed as the
`X-Request-Id` response header, tagged `requestId` on the Sentry event.

### P2 — DB connection pool / statement timeout (deployment config)
The code cannot set these without the production connection string.
`docs/PRODUCTION_HARDENING.md` §7 gives the exact `DATABASE_URL` parameters:
`connection_limit` (sized to `replicas · limit ≤ pool ceiling`), `pool_timeout=10`,
`connect_timeout=5`, `options=-c statement_timeout=30000`. `statement_timeout` is
the handler-execution bound that Fastify's new `requestTimeout: 60_000`
(slow-loris only) does not provide.

### Reviewed, no change required
Outbox guarantees; webhook signature + replay (idempotency is the replay defence,
Twilio has no timestamp); rate-limit coverage; N+1 (spot-checked discovery — batched,
`tests/marketplace-discovery-e2e` N+1 guard; inbox; dispatch board — all single
query); Sentry classification/scrubbing; health endpoints; feature-flag request-path
reads (pure functions over the JWT context, no failure mode; a thrown kill-switch
query never reads as "enabled"); messaging degradation (per-message backoff + DEAD —
a global breaker is a P3 future item); push failure handling; **no test/debug
bypasses in production paths** (3 `NODE_ENV` hits, all legitimate).

## Architecture reused

`recoverExpiredOutboxClaims` as the pattern for `recoverStuckMessageDispatches`;
`captureUnexpectedError` extended (optional `{ tags }`) rather than a new reporter;
Fastify's own `genReqId` / `request.id` rather than a custom middleware; the
existing `step`-less cycle refactored in place, not replaced.

## Authorization / tenant / security model

Unchanged. The worker runs system-level sweeps (no `request.role`); every sweep it
calls still enforces its own entitlement/consent/opt-out. `genReqId` trusts an
inbound header only behind a confirmed proxy — an unauthenticated client cannot
inject a chosen correlation id when `TRUST_PROXY` is off (verified by test).

## Migrations

None. All changes are code + docs.

## Tests / regressions / typechecks

- `tests/scheduled-work-resilience.test.ts` — flag-store unreachable → cycle
  `skipped`, `failedSteps ≥ 1`, no work attempted, heartbeat still advanced.
- `tests/scheduled-work-trigger.test.ts` — an injected step failure is isolated;
  the cycle finishes and still heartbeats.
- `tests/messaging-platform-core.test.ts` — a `PROCESSING`-stranded dispatch is
  invisible to the normal claim, recovered to `RETRY`, then sent.
- `tests/worker-health.test.ts` — a correlation id is stamped on every response;
  an untrusted inbound `X-Request-Id` is not echoed.
- Regression: `messaging-webhooks`, `no-show-automation`, `omnichannel-inbox`,
  `automation-worker`, `dispatch`, `worker-health` — all pass.
- Backend `tsc --noEmit` + `tsc -p tsconfig.test.json --noEmit` — clean.

## Commits

- `fix(worker): HTTP-tick parity, step isolation, stranded-dispatch recovery`
- `feat(hardening): correlation ids + production hardening audit doc`

## Unresolved limitations

- **DB connection-string parameters** must be applied to the Render Postgres
  `DATABASE_URL` at deploy (values in `PRODUCTION_HARDENING.md` §7). Added to
  `docs/OWNER_ACTIONS.md`.
- No global messaging-provider circuit breaker (P3) — per-message backoff + DEAD is
  the current degradation strategy; a candidate for post-V1.
- Marketplace category-browse in-memory filter (P3, roadmap §10 deferred register).
- Browser E2E for the #22 web dashboard is not part of #23 (tracked in the #22
  report).

## Owner actions

- **OA-7 (new):** apply the `DATABASE_URL` pool/timeout parameters at deploy —
  see `docs/PRODUCTION_HARDENING.md` §7. Non-blocking for engineering.

## Next stage

#24 Pre-release Security & Privacy Audit.
