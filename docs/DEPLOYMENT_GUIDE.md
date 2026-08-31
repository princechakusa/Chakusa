# Chakusa production deployment guide

Companion to `PRODUCTION_GO_LIVE_CHECKLIST.md` (what to verify) and
`ENVIRONMENT_CONFIGURATION.md` (what to set). This document is the ordered
procedure for a backend deploy.

## Topology

| Component | Runtime | Entry | Notes |
|---|---|---|---|
| API | Node 20+ | `npm run start` (`dist/server.js`) | Stateless; scale horizontally. |
| Worker | Node 20+ | `npm run start:worker` (`dist/worker.js`) | Runs automation/messaging/AI-adjacent scheduled work + the outbox publisher. Run **exactly one** logical worker deployment (it self-leases; multiple replicas are safe but only add throughput to leased work, not to singletons). |
| Admin console | Static (Cloudflare Pages / Workers) | `npm --prefix admin run build` | Separate origin; set `ADMIN_CONSOLE_ORIGIN` on the API to its exact HTTPS URL. |
| Database | PostgreSQL 14+ | — | Pooled `DATABASE_URL` for the app, unpooled `DIRECT_URL` for migrations. |
| Mobile | Expo / EAS | — | Android builds local/Windows only; iOS builds EAS only. |

## Deploy procedure (backend)

1. **Freeze**: confirm `main`/`master` is green — `npm run build && npm run typecheck && npm run lint && npx prisma validate && npm run test`.
2. **Back up** the database (see `BACKUP_AND_RECOVERY.md`) and note the current migration name (`npx prisma migrate status`) as the rollback point.
3. **Migrate**: run `DATABASE_URL=$DIRECT_URL npx prisma migrate deploy` against production. Migrations in this repo are **additive-only** (new tables/columns/indexes; no destructive `ALTER`), so this is safe to run before the new code is live.
4. **Deploy the API** with the new image/build and the full environment set.
5. **Deploy the worker** with the same env. Confirm `GET /health/worker` flips to `ok` within its freshness window (≈60 s after the first successful poll).
6. **Health gate**: `GET /health`, `/health/ready`, `/health/worker`, `/health/automation`, `/health/ai` all 200.
7. **Smoke**: register a throwaway business, create + cancel an appointment, send one manual message, confirm a delivery webhook updates status.
8. **Deploy the admin console** and confirm `/admin/auth/login` works from its origin.

## AI Platform enablement (optional, post-deploy)

The platform ships dark. To turn it on:

1. Set `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY` (+ optional base URL / default model). Redeploy the API and worker.
2. `POST /admin/ai/models` (permission `ai.manage`) one `AIModelRegistry` row per model, `provider` = `openai` / `anthropic`, with real `pricing`, `status: ACTIVE`, `healthStatus: HEALTHY`.
3. Seed the platform prompt package (`prisma/seed.ts` covers `conversation.orchestrator` and the four task prompts) and publish it.
4. Create a baseline `AIPolicy` per pilot business (`PUT /ai/policies/draft` + `POST /ai/policies/activate`) — **start in `DRAFT` mode** so every reply is held for human approval.
5. Enable the `ai.customer_agent` feature flag per pilot business.
6. Watch `/ai/ops/monitoring` and `/admin/ai/health`. Promote a business to `APPROVAL` then `AUTONOMOUS` only after its approval queue shows consistently good drafts.

## Scheduled maintenance jobs (wire into the worker or a cron)

- `pruneExpiredMemory()` — deletes past-TTL `AIMemoryRecord` + expired `AIMemorySession`. Hourly.
- `verifyAIOutcomes(businessId)` — flips `AIAttributedOutcome.verified` by re-checking the system of record. Every 15 min or on demand.
- `rollupAIMetrics` is not required (buckets are written inline); a nightly compaction/retention job on `ai_operational_metrics` and `ai_retrieval_logs` is recommended once volume grows.

## Rollback

- **Code**: redeploy the previous API + worker build. The additive migrations do not need to be reverted — old code ignores new columns/tables.
- **If a migration must be undone**: restore from the pre-deploy backup (see `BACKUP_AND_RECOVERY.md`). There are no `down` migrations in this repo by design.
- **AI**: set `PlatformSetting.ai_enabled=false` (instant, no deploy) to stop all AI invocation while leaving the rest of the platform running.
