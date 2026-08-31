# Chakusa monitoring handbook

## Health endpoints

| Endpoint | Green | Red (503) | Probe cadence |
|---|---|---|---|
| `GET /health` | process up | never (liveness only) | frequent (10–30 s) |
| `GET /health/ready` | `SELECT 1` succeeds | DB unreachable | readiness gate |
| `GET /health/worker` | heartbeat < ~90 s old | worker down/wedged | 1 min |
| `GET /health/automation` | automation health `ok` | maintenance / degraded | 1 min |
| `GET /health/ai` | no open circuit breakers | ≥1 provider circuit OPEN | 1 min |

`/health/ai` also returns `aiKillSwitchEngaged` and the per-provider breaker snapshot; it never 503s merely because no provider is configured.

## Error reporting (Sentry)

- Backend: initializes **only** when `SENTRY_ENABLED=true` **and** `NODE_ENV=production` (defense in depth — see `src/lib/sentry.ts`). `attachFastifySentry` reports genuinely unexpected 5xx; `captureUnexpectedError` is used for fire-and-forget failures (worker ticks, the awaited-but-wrapped AI agent call in the inbound webhook).
- Set `SENTRY_ENVIRONMENT` to distinguish staging/production and `SENTRY_RELEASE` to the deploy commit.
- Mobile: see `MOBILE_MONITORING_SETUP.md`.

## Metrics

Operational metrics are in the database, queried by the admin and tenant endpoints — there is no external metrics system wired yet.

| Surface | Source | Endpoint |
|---|---|---|
| Messaging | `messagingAnalytics` | `GET /messages/analytics`, `/admin/communications/*` |
| Automation | `readAutomationHealth`, workflow analytics | `GET /health/automation`, `/automation/workflow-analytics` |
| AI live | `AIInvocationLedger` + `AIPolicyDecision` + `AIRetrievalLog` | `GET /ai/ops/monitoring` (tenant), `GET /admin/ai/analytics` (platform) |
| AI trends | `AIOperationalMetric` (hourly buckets) | `GET /ai/ops/trends?metric=&bucket=`, `GET /admin/ai/cost` |
| AI provider health | in-process breaker + `AIProviderHealthCheck` history | `GET /admin/ai/providers`, `/health/ai` |
| Memory | `AIRetrievalLog` | `GET /ai/memory/monitoring`, `/admin/ai/memory-monitoring` |
| Policy | `AIPolicyDecision` | `GET /admin/ai/policy-monitoring` |
| Value Center | verified `AIAttributedOutcome` + ledger | `GET /ai/ops/analytics` |

## Recommended alerts

| Alert | Condition | Action |
|---|---|---|
| Worker down | `/health/worker` 503 for > 3 min | restart worker; `INCIDENT_RECOVERY.md` §Worker |
| DB unreachable | `/health/ready` 503 | check DB / connection pool |
| AI provider outage | `/health/ai` 503 (circuit OPEN) | `INCIDENT_RECOVERY.md` §AI provider |
| AI failure rate | `GET /admin/ai/health` `aiFailureRate > 0.2` over 15 min | inspect `/admin/ai/invocations?outcome=FAILED` |
| AI cost spike | `/admin/ai/cost` daily trend > N× baseline | check for a loop / abusive tenant; kill switch if needed |
| Policy denial spike | `/admin/ai/policy-monitoring` `denialRate` climbing | usually a misconfigured policy or injection attempts |
| Delivery failures | `messagingAnalytics` DEAD/FAILED climbing | provider status; retry dead dispatches |
| Draft queue backlog | `AIConversationRun` count in `HUMAN_APPROVAL` growing unbounded | staffing / consider `AUTONOMOUS` for that business |

## Operational dashboards (to build on the endpoints above)

1. **Platform AI** — requests, failure rate, cost/day, tokens/day, p95 latency, circuit-breaker events (`/admin/ai/analytics` + `/admin/ai/cost`).
2. **Tenant AI** — per-business monitoring + Value Center (`/ai/ops/monitoring` + `/ai/ops/analytics`).
3. **Messaging** — sent/delivered/failed, verified cost, SLA compliance.
4. **Automation** — workflow throughput, success/failure, retry counts.
5. **Infra** — the five health endpoints + DB connections + worker heartbeat age.
