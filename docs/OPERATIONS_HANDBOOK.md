# Chakusa operations handbook

Day-2 operations. Pair with `MONITORING_HANDBOOK.md` (what to watch) and
`INCIDENT_RECOVERY.md` (what to do when it breaks).

## Kill switches (data, not deploys)

| Switch | Mechanism | Effect | Set via |
|---|---|---|---|
| Automation | `PlatformSetting.automation_enabled=false` | Scheduled automation work stops | `PATCH /admin/settings` (`settings.manage`) |
| Messaging | `PlatformSetting.messaging_enabled=false` | Outbound sends refused | same |
| Providers | `PlatformSetting.providers_enabled=false` | Provider calls refused | same |
| AI (global) | `PlatformSetting.ai_enabled=false` **or** `FeatureFlag kill_switch.ai` PLATFORM | `routeAI` throws at INVOCATION; no model call | `PATCH /admin/settings` / `/admin` feature flags |
| AI (per business) | `FeatureFlag kill_switch.ai` scope BUSINESS | that tenant only | feature flags |
| AI Customer Agent | `FeatureFlag ai.customer_agent` off | inbound messages are not orchestrated | feature flags |
| Provider kill | `FeatureFlag kill_switch.provider.<id>` | that messaging provider | feature flags |
| Maintenance | `PlatformSetting.maintenance_mode=true` | surfaced on `/health/automation` and admin | `PATCH /admin/settings` |

All of the above are read live on every relevant request — no redeploy, effect is immediate.

## Routine tasks

- **Bootstrap the first admin**: `npm run admin:bootstrap`.
- **Worker liveness**: `GET /health/worker` must be `ok`. If `unavailable`, the worker process is down or wedged — restart it; investigate with `MONITORING_HANDBOOK.md`.
- **Trigger scheduled work manually** (e.g. after a worker outage): `POST /internal/worker/tick` with `Authorization: Bearer <WORKER_TRIGGER_SECRET>`.
- **Messaging budget**: each business has a monthly safety cap (`TWILIO_MONTHLY_MESSAGE_LIMIT`, per-business tracked). A business hitting it gets sends refused with a clear error; raise deliberately, do not remove.
- **Retry a dead dispatch**: `POST /messages/failures` shows `DEAD`/`FAILED`; `retryDispatch` re-queues one.

## AI operations

- **Draft review queue**: `GET /ai/ops/runs?status=HUMAN_APPROVAL`. Approve with `POST /ai/agent/runs/:id/approve` (optionally `{edit}`), reject with `POST /ai/agent/runs/:id/reject` (`{escalate}` to hand to a human).
- **Escalations**: `GET /ai/ops/runs?status=ESCALATED`; the conversation is already flipped to `automationMode: HUMAN`.
- **Take over a conversation from the AI**: `POST /ai/agent/conversations/:id/takeover`; hand back with `.../resume`.
- **Monitoring**: `GET /ai/ops/monitoring` (tenant) / `GET /admin/ai/health`, `/admin/ai/cost`, `/admin/ai/analytics` (platform).
- **Circuit breaker**: opens per `(provider, model)` after 5 consecutive failures, half-opens after 30 s, closes on the next success. State is in-process and visible on `/health/ai` and `/admin/ai/providers`. A restarted API resets breakers — expect a brief real-traffic probe after deploy.
- **Model registry**: `GET/POST /admin/ai/models`; `PATCH /admin/ai/models/:id/status` to disable a bad model without touching env.
- **Policy changes** are versioned (`AIPolicy.version`) and audited (`AIPolicyChange`); every evaluation is in `AIPolicyDecision`.

## Feature-flag conventions

Scopes: `PLATFORM` (all), `INTERNAL` (cohort in `metadata.businessIds`/`userIds`), `BUSINESS`, `USER`. `rolloutPercent` hashes the subject id. Kill switches are `enabled=true` meaning "engaged".

## Audit trails

- Platform staff actions → `AdminAuditLog` (append-only, DB-trigger-protected against UPDATE/DELETE). Read via `GET /admin/audit`.
- Tenant AI policy edits → `AIPolicyChange`. AI decisions → `AIPolicyDecision`. AI invocations → `AIInvocationLedger`. Memory retrievals → `AIRetrievalLog`. Conversation lifecycle → `ConversationLifecycleEvent`.
