# Chakusa scalability review

Assessment of readiness at 10k / 100k / 1M businesses. "User" below means a
business tenant; each has staff, customers, appointments, conversations.

## Architecture shape

- **API**: stateless Fastify; scales horizontally behind a load balancer. No sticky sessions (bearer tokens). Only in-process state is the AI circuit breaker (advisory, self-healing, per replica — acceptable).
- **Worker**: singleton-friendly; leased work (`WorkflowExecution`, `MessageDispatch`, outbox) is safe to run on multiple replicas for throughput; a few true singletons (schedule init, heartbeat) are idempotent.
- **Database**: single PostgreSQL. This is the scaling axis.

## 10,000 businesses — ready today

- Every hot query is tenant-scoped and index-backed (verified across LOOP 3/4 audits). `Message`, `Appointment`, `Conversation`, `AutomationRun`, `AIInvocationLedger`, `AIPolicyDecision`, `AIRetrievalLog`, `AIOperationalMetric` all have `[businessId, <time>]` composite indexes.
- Worker throughput: dispatch and workflow loops lease in batches (default 20) with back-off; horizontal worker replicas add linear throughput.
- No change required.

## 100,000 businesses — ready with routine operational tuning

Bottlenecks appear in **table growth**, not query shape:

| Table | Growth driver | Mitigation (no schema redesign) |
|---|---|---|
| `ai_invocation_ledger`, `ai_policy_decisions`, `ai_retrieval_logs`, `ai_operational_metrics`, `activity_events`, `outbox_events`, `message_receipts` | per-AI-call / per-message / per-event | **Time-based partitioning** (monthly) or a **retention job** dropping rows older than N months. Analytics endpoints already query bounded time windows. |
| `messages`, `appointments` | per-tenant activity | partition by `created_at` range if a single table exceeds ~100M rows; reads are already `businessId`-scoped so partition pruning is effective. |

Other 100k actions:
- Move to a **connection pooler** sized for the API replica count (PgBouncer / provider pooler) — already assumed by the pooled/`DIRECT_URL` split.
- Add **read replicas** for the admin/analytics read paths (`/admin/ai/*`, `/admin/communications/*`, Value Center) to keep OLAP-ish `groupBy`s off the primary.
- Run the AI metric buckets and retrieval logs on a **retention + rollup** job (a daily rollup table for trends beyond 30 days).
- Scale the worker to N replicas; confirm lease contention stays low (the advisory-lock + `nextAttemptAt` design already avoids thundering herds).

## 1,000,000 businesses — requires deliberate infrastructure work (not architecture redesign)

The domain model holds; the single-primary database does not. Needed:

1. **Horizontal database scaling** — either managed Postgres sharding by `businessId`, or a move to a distributed Postgres (Citus-style) with `businessId` as the distribution key. Every table is already tenant-keyed, so this is a data-tier change, not an application rewrite.
2. **Externalize the queues** — the outbox publisher and `MessageDispatch`/`WorkflowExecution` loops are DB-polling. At 1M tenants, move dispatch and outbox delivery onto a real broker (SQS/PubSub/Kafka) with the DB tables kept as the durable journal. The `IdempotentActionGateway` / provider interfaces already isolate this.
3. **Time-series store for metrics** — `ai_operational_metrics`, `ai_retrieval_logs`, `activity_events`, `message_receipts` move to a purpose-built store (ClickHouse / Timescale / a metrics backend); the admin/tenant endpoints read from there.
4. **AI cost governance at scale** — per-tenant budget caps enforced in `routeAI` (the policy engine already has the hooks; add a spend check), and a provider-key pool with rate-limit-aware routing.
5. **Cache the hot read paths** — business profile, published prompt versions, active policy documents (all effectively immutable between edits) behind a short-TTL cache.

## Bottlenecks identified (and whether action is required now)

| Bottleneck | Impact | Required now? |
|---|---|---|
| Single Postgres primary | ceiling ~100k–ish tenants before write pressure | **No** — routine tuning covers 100k; shard/distribute before 1M. |
| DB-polling worker queues | fine to ~100k; poll overhead grows | **No** — externalize before 1M. |
| Append-only AI/event tables unbounded | disk + vacuum pressure | **Recommended before 100k**: add a retention/partition job. Cheap, no redesign. |
| AI metric bucket write is find-then-write | minor lost-sample risk under extreme concurrency | **Hardened in LOOP 5** (P2002 retry). Full atomic upsert needs a `NULLS NOT DISTINCT` index — defer to the retention/partition change. |
| In-process circuit breaker per replica | each replica probes a down provider independently | **No** — advisory only, self-heals in 30 s; a shared breaker is a nicety, not a need. |
| Admin analytics `groupBy` on primary | slows as ledgers grow | **Recommended at 100k**: read replica. |

## Verdict

- **10k**: production-ready as built.
- **100k**: production-ready plus a retention/partition job and (ideally) a read replica — operational work, no code redesign.
- **1M**: needs a data-tier program (shard/distribute Postgres, externalize queues, time-series metrics store). The application architecture — tenant-keyed everything, interface-isolated providers, leased workers — is designed to absorb that change without a rewrite.
