# Chakusa incident recovery guide

Runbook for the most likely production incidents. Every mitigation here is
reversible and needs no code change unless stated.

## Severity ladder

- **SEV1** — customers cannot book / messages not sending / API down.
- **SEV2** — a subsystem degraded (AI, one provider, worker) but core booking works.
- **SEV3** — elevated errors, no customer impact yet.

---

## API down / 5xx storm

1. `GET /health` (liveness) and `/health/ready` (DB). If `/health/ready` is 503 → DB incident (below).
2. Check Sentry for the top exception; check the deploy timeline.
3. If it started at a deploy → **roll back** the API to the previous build (`DEPLOYMENT_GUIDE.md` §Rollback). Additive migrations do not block rollback.
4. If DB connection exhaustion → reduce API replicas or raise the pool; confirm `DATABASE_URL` is the **pooled** endpoint.

## Database unreachable / slow

1. `/health/ready` 503. Confirm the DB is up and the pooled endpoint resolves.
2. Failover / promote a replica per your provider's procedure.
3. After recovery: the worker's outbox publisher and dispatch retry loops will drain the backlog on their own (leases + `nextAttemptAt` back-off). Watch `messagingAnalytics` and `/health/automation`.
4. If data loss occurred → restore from backup (`BACKUP_AND_RECOVERY.md`) to the last good point; replay is not automatic.

## Worker down or wedged

1. `/health/worker` 503 (heartbeat stale).
2. Restart `dist/worker.js`. On boot it recovers expired outbox claims and deliveries and re-initializes workflow schedules.
3. Bridge the gap: `POST /internal/worker/tick` with the `WORKER_TRIGGER_SECRET` bearer token runs one scheduled-work pass from the API process.
4. If it wedges again immediately → capture the stack (Sentry), check for a poison job: a `WorkflowExecution`/`AutomationRun` stuck `RUNNING` past its lease; it will be re-leased and retried, and dead-ends land in `FAILED`/`DEAD` rather than blocking the loop.

## Messaging: sends failing / stuck

1. `POST /messages/failures` → dispatches in `DEAD`/`FAILED`/`RETRY`.
2. Check the provider's status page and `providerErrorCode` on the dispatch.
3. Provider-wide outage → set `FeatureFlag kill_switch.provider.<id>` (or `PlatformSetting.messaging_enabled=false`) to stop hammering; sends queue as PENDING.
4. Recovery → clear the kill switch; `retryDispatch` the dead ones; the dispatch worker drains the queue with back-off.
5. Inbound webhook 5xx is intentional (Twilio retries) — do not "fix" it by swallowing errors.

## AI provider outage

1. `/health/ai` 503 with an OPEN breaker, or `/admin/ai/health` `aiFailureRate` high.
2. The breaker already stopped calls to the bad `(provider, model)`; it half-opens after 30 s and closes on the first success — **often self-heals**.
3. If it stays open: `PATCH /admin/ai/models/:id/status` → `DISABLED` for that model; if another provider/model with the needed capability is registered, `routeAI` will select it. If not, AI replies pause (drafts still queue) — messaging and booking are unaffected.
4. Total AI stop: `PatchSetting ai_enabled=false`. Held drafts remain; approve manually or resume later.
5. Recovery: re-enable the model / clear the kill switch. Breakers reset on API restart anyway.

## AI misbehaving (bad replies / cost spike / denial spike)

1. **Immediate**: `PlatformSetting.ai_enabled=false` (global) or `kill_switch.ai` BUSINESS (one tenant). Or flip the tenant's policy to `DRAFT` mode so every reply is held.
2. Diagnose: `/admin/ai/invocations`, `/admin/ai/policy-monitoring`, the tenant's `AIPolicyDecision` rows, the offending `PromptVersion`.
3. Fix forward: publish a corrected `PromptVersion` (immutable, approval-gated) or tighten the `AIPolicy` document/rules (versioned, audited). Roll a prompt back with `POST /ai/prompts/versions/:id/deploy`.
4. Cost spike from a loop: the agent tool loop is bounded (≤4 iterations); a spike is usually one abusive tenant — kill-switch that business.

## Circuit-breaker flapping after deploy

Expected: breakers are in-process and reset on restart, so the first real requests re-probe each provider. If a provider is genuinely down at deploy time you'll see one burst of failures then the breaker opens. No action unless it does not recover.

## Admin console locked out

`npm run admin:bootstrap` re-creates a super-admin. Admin sessions use an HttpOnly refresh cookie + CSRF; `POST /admin/auth/logout-all` revokes all.
