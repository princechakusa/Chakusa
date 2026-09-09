# Owner Actions — external / irreversible items blocking autonomous work

Per `CLAUDE.md` and `docs/CHAKUSA_AUTONOMOUS_MASTER_ROADMAP.md` §15: when an external
owner action blocks part of the roadmap, it is recorded here and all independent safe
work continues. Resolve these, then tell the agent so the blocked item can proceed.

Status legend: **OPEN** (blocking) · **DONE** · **N/A**

---

## OA-1 — Production migration deployment (8-migration backlog, checkpoint before #18)

**Status:** OPEN
**Blocks:** deploying migrations `20260907204745` … `20260909100000` (8 additive) to the
Render production database. Does **not** block continued feature development (#18+ is
independent code + additive migrations that stack on this chain locally).
**Classification from the checkpoint audit:** `B — SAFE WITH SPECIFIC PRECONDITIONS`.
Full report: `docs/progress/2026-09-09-deployment-checkpoint.md`.

The migration chain is verified safe (additive-only, ordered, no data conflict,
enum-safe on PG ≥ 12, no P0/P1 schema risk) and rehearsed locally on disposable PG 16
databases — both a clean-from-zero install and a production-like upgrade over the exact
pre-chain schema — with the app booting on the new schema. It is **not** yet "safe to
deploy" only because these external checks cannot be performed from the dev environment:

1. **Read-only production migration-state inspection.** Run against the production
   `DIRECT_URL` and confirm it matches the expected healthy baseline (newest applied
   migration = `20260907183937_accounting_integration_foundation`; the 8 listed above
   report as *not yet applied*; zero `finished_at IS NULL` / `rolled_back_at IS NOT NULL`
   rows):
   ```
   DATABASE_URL="$DIRECT_URL" npx prisma migrate status
   psql "$DIRECT_URL" -c "SELECT migration_name, finished_at, rolled_back_at
                          FROM _prisma_migrations ORDER BY started_at DESC LIMIT 12;"
   psql "$DIRECT_URL" -c "SELECT migration_name FROM _prisma_migrations
                          WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL;"
   psql "$DIRECT_URL" -c "SHOW server_version;"   # expect >= 12 (deploy guide says 14+)
   ```
   If a failed/partial migration or a prod-only migration not in the repo is found →
   **do not deploy**, report back.

2. **Backup / recovery readiness.** Confirm the production Postgres instance has
   **automated daily snapshots** and **PITR** enabled (Render database page / Recovery
   tab). A tier without backups must be upgraded or an alternative arranged before
   migrating. Then take the pre-deploy logical dump and record the rollback point:
   ```
   pg_dump -Fc "$DIRECT_URL" > chakusa-$(date +%Y%m%d-%H%M%S).dump   # store OFF Render
   DATABASE_URL="$DIRECT_URL" npx prisma migrate status              # note newest applied
   ```

3. **Deployment-pipeline order.** Confirm the Render deploy runs
   `prisma migrate deploy` **before** swapping the running service to the new code
   (expand-first). There is no `render.yaml` in the repo, so this is dashboard config.
   If it does not, run migrations manually first per step 4. "New code + old schema"
   fails hard (new backend reads the 6 new tables / 8 new columns / 2 new enum values).

4. **Authorization + window.** Nominate who runs the deploy and a low-traffic window.

**Exact deploy sequence once 1–4 clear** (from `docs/DEPLOYMENT_GUIDE.md` §17):
```
# 0. freeze: main green
npm run build && npm run typecheck && npm run lint && npx prisma validate && npm run test
# 1. backup + rollback point   (step 2 above)
# 2. migrate production FIRST (UNPOOLED url):
DATABASE_URL="$DIRECT_URL" npx prisma migrate deploy
DATABASE_URL="$DIRECT_URL" npx prisma migrate status         # "up to date", +8 rows
# 3. deploy API (new build + full env)
# 4. deploy worker; wait for GET /health/worker => ok
# 5. run the post-deploy checklist in docs/progress/2026-09-09-deployment-checkpoint.md
# 6. mobile: separate release; native rebuild for expo-location (#14) — Android local, iOS EAS
```

---

## OA-2 — Store & privacy declarations for Live Location (#14) — pre-release only

**Status:** OPEN (not blocking; required before a store submission that includes #14)
**Blocks:** nothing in development. Required at #26 Release Readiness.

The app now requests **foreground** OS location permission (`expo-location`, background
explicitly disabled in `app.json`). Before shipping:

1. **Google Play → Data safety:** declare Location (approximate/precise) *collected*,
   purpose *App functionality*, not sold; ephemeral processing is defensible (no
   retention). No `ACCESS_BACKGROUND_LOCATION` / `FOREGROUND_SERVICE_LOCATION` →
   background-location declaration form is **not** triggered.
2. **Apple → App Privacy:** declare **Precise Location** *collected*, purpose
   *App Functionality*, **not** used for Tracking. Per the roadmap, 5-decimal
   coordinates count as *precise* location.
3. **Privacy policy:** add what is collected (approx. coordinates), when (only while a
   provider actively shares for an appointment), who sees it (that appointment's
   customer only), retention (ephemeral, auto-expiring, deleted on completion), and
   that it is not used for analytics/ads/performance scoring.
4. During the release build: verify generated Android/iOS permissions, confirm **no
   `ACCESS_BACKGROUND_LOCATION`** slipped in, run `npx expo install --check`.

Do not make store declarations automatically.

---

## OA-3 — AI provider / model production configuration — optional, pre-enable

**Status:** OPEN (not blocking; the AI Receptionist ships disabled by default)
**Blocks:** nothing. The AI engine, gateway, policy, tool broker and receptionist
control layer are complete and tested with the in-repo fake provider.

To make the AI Receptionist actually answer in production:
1. Set `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY` (+ optional base URL / default model)
   in the API and worker environments.
2. Seed + publish the platform prompt package (`prisma/seed.ts` covers
   `conversation.orchestrator` and the task prompts).
3. Insert an `ACTIVE` `AIModelRegistry` row for the chosen provider/model.
4. Per business: platform feature flag `ai.customer_agent` + business opt-in via
   `PATCH /ai/receptionist { enabled: true }` (Business plan) + optional
   `mode: "AFTER_HOURS_ONLY"`.

No new paid-provider *commitment* is being made by the agent — this is deployment
configuration. Adapters are already in the codebase.

---

## OA-4 — `docs/CHAKUSA_ENGINEERING_SPEC.md` referenced by CLAUDE.md

**Status:** N/A — present in repo (`docs/CHAKUSA_ENGINEERING_SPEC.md`). No owner action.
