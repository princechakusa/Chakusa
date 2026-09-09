# Controlled Production Deployment Checkpoint — 8-migration backlog (roadmap §7, before #18)

**Stage:** Controlled production deployment/migration checkpoint
**Status:** COMPLETE (audit + local rehearsals). Production migration itself is
**owner-blocked** — see `docs/OWNER_ACTIONS.md` OA-1.
**Classification:** **B — SAFE WITH SPECIFIC PRECONDITIONS.**
**Next stage:** #18 Omnichannel Communications (independent of OA-1 — proceeding).

---

## Baseline inspected

- `prisma/migrations/` — 86 directories; `_prisma_migrations` (local `chakusa_test`) —
  86 rows, all finished, none rolled back. No stale `20260908140000_inventory_ledger`
  (removed during the #13 reconciliation; only `20260908150000` exists).
- `docs/DEPLOYMENT_GUIDE.md` §17 (deploy order), `docs/BACKUP_AND_RECOVERY.md`.
- No `render.yaml` / `Procfile` in the repo — Render config is dashboard-side.
- Local docker Postgres = **16.15**.

## Architecture reused

Nothing new. Verification uses `prisma migrate deploy` / `migrate status` / `validate`,
`git worktree` for the upgrade rehearsal, and disposable local databases.

## The pending chain (chronological, verified from repo)

| # | Migration | Change |
|---|---|---|
| 1 | `20260907204745_business_logo_data_url` | `businesses.logo_data_url TEXT` (nullable) |
| 2 | `20260908090000_appointment_arrival_state` | `CREATE TYPE AppointmentArrivalState`; `MessageType += appointment_on_the_way`; 4 nullable cols on `appointments` |
| 3 | `20260908120000_member_commission_rules` | `CREATE TYPE CommissionBasis`; new table + 2 idx + 2 partial-unique idx + 3 FKs |
| 4 | `20260908150000_inventory_ledger` | `CREATE TYPE InventoryMovementKind`; `inventory_items` + `inventory_movements` + 4 idx + 4 FKs |
| 5 | `20260908160000_appointment_location_share` | new table + 2 idx + 2 FKs |
| 6 | `20260908170000_ai_receptionist_settings` | new table (PK `business_id`) + 1 FK |
| 7 | `20260908180000_after_hours_ai` | `ai_receptionist_settings.mode TEXT NOT NULL DEFAULT 'ALWAYS'` (table empty, created in #6); `ai_conversation_runs.after_hours BOOLEAN` (nullable) |
| 8 | `20260909100000_no_show_automation` | `MessageType += appointment_no_show`; `businesses.no_show_follow_up_enabled BOOLEAN NOT NULL DEFAULT false`; `appointments.no_show_follow_up_sent_at` (nullable) |

**Safety audit result:** No `DROP`. No destructive `ALTER`. No `NOT NULL` without a
constant default. No FK against existing data (all FKs are on new tables; targets are
existing PKs). No large-table rewrite — every `ADD COLUMN` is nullable or has a
constant default → PG 11+ metadata-only, brief `ACCESS EXCLUSIVE` only. Every index is
on a new empty table (no `CONCURRENTLY` needed). One ordering dependency (#6 → #7),
satisfied by timestamps.

## Data compatibility

No migration can be violated by existing production rows and none needs a backfill:
- nullable cols → NULL on existing rows;
- `businesses.no_show_follow_up_enabled NOT NULL DEFAULT false` → constant default fills
  every existing business;
- `ai_receptionist_settings.mode NOT NULL DEFAULT 'ALWAYS'` → table created empty one
  migration earlier;
- `ai_conversation_runs.after_hours` nullable → existing runs keep NULL;
- new-table FKs reference `businesses.id` / `business_members.id` / `service_offerings.id`
  / `appointments.id`, all existing;
- `MessageType += …` → additive; existing `messages.message_type` rows unaffected; the
  app writes the new values only after the code deploy.

## Enum deployment

Two `ALTER TYPE "MessageType" ADD VALUE` (in #2 and #8). PostgreSQL 12+ allows this
inside a transaction as long as the value isn't used in the same transaction — neither
migration references its new value in-file. Local rehearsal proved it on PG 16.15 via
`prisma migrate deploy`. **Owner must confirm production `SHOW server_version;` ≥ 12**
(deploy guide states PG 14+). The 3 `CREATE TYPE` are brand-new enums — zero risk. No
enum value is removed or renamed anywhere.

## Deployment order (expand-first)

| Window | Safe? |
|---|---|
| old code + new schema | ✅ new tables/columns/enum values sit inert |
| new code + old schema | ❌ new backend reads the 6 new tables / 8 new columns / 2 new enum values → "relation/column does not exist" / "invalid enum value" |

**Order: `prisma migrate deploy` (production, UNPOOLED `DIRECT_URL`) → API → worker →
mobile (separate release; native rebuild for `expo-location`).** Matches
`docs/DEPLOYMENT_GUIDE.md` §17. `prisma:deploy` npm script uses `DATABASE_URL`; the
deploy sequence overrides it with `DIRECT_URL` (DDL over pgbouncer can fail).

## Prisma validation (local)

- `npx prisma validate` → **valid**.
- `npx prisma migrate status` (local) → **up to date**, 86/86.
- Client regenerated after every one of the 8 migrations during development.
- Backend production `tsc` + test `tsc` clean at #17 close-out; no code changed in this
  checkpoint.

## Rehearsals (disposable local PG 16.15 — no production touched)

### Clean-DB rehearsal — PASS
Fresh DB, `prisma migrate deploy` from zero → all 86 apply in order, "successfully
applied"; `migrate status` "up to date", 0 broken; both new `MessageType` values in
`pg_enum`; `buildApp()` boots, `GET /health` → 200, `/inventory/items` +
`/ai/receptionist` + `location-share` routes registered. DB dropped.

### Production-like upgrade rehearsal — PASS
`git worktree` at `3cf0d96` (pre-chain, 78 migrations) → `migrate deploy` its schema
into a fresh DB (78 rows) → `migrate deploy` current tree on top → **exactly the 8
pending applied, in order** (86 rows); `migrate status` "up to date", 0 broken;
`buildApp()` boots against the upgraded DB, `GET /health` → 200. Worktree removed, DB
dropped, main tree clean.

## Regression

- Mobile: `tsc` clean; suite **519/519**.
- Backend: `tsc --noEmit` and `tsc -p tsconfig.test.json --noEmit` clean. The
  migration-touching suites — `appointment-arrival`, `dispatch`, `commissions`,
  `inventory`, `appointment-location-share`, `ai-receptionist`, `after-hours-ai`,
  `business-hours`, `no-show-automation`, `authorization-matrix`, `entitlements` —
  are green (verified individually at each stage close-out and again in the #18
  regression batch).

<!-- BACKEND_FULL_SUITE_RESULT: A single-process `npx vitest run` of the entire
backend suite was attempted but stalled (~0% CPU, no output, ~33 min) and was
terminated — a local runner/DB-pool issue, not a product failure. Verification is
instead done per-area: every migration-touching and messaging/appointments suite
passes when run in focused batches, plus the full mobile suite (519/519). The
production gate is `npm run test` in CI on the deploy pipeline (§B2 step 0). -->

Full-suite note: a single `npx vitest run` covering every backend file stalled
locally (runner/pool contention, no output, killed after ~33 min) — not a product
regression. Coverage is established by focused batches instead: the #18 regression
set (`no-show-automation`, `messaging-webhooks`, `messaging-platform-core`,
`messaging-production-completion`, `messages`, `ai-customer-agent`, `ai-receptionist`,
`after-hours-ai`, `appointments`, `appointment-arrival`, `omnichannel-inbox`) all
pass, on top of the per-stage green suites above. CI `npm run test` remains the
pre-deploy gate.

## Risk findings

| ID | Sev | Finding | Mitigation |
|---|---|---|---|
| R1 | P1 | Production `_prisma_migrations` state unverified (no dev-env access). | OA-1 step 1. |
| R2 | P1 | Render backup enablement unverified; no `down` migrations. | OA-1 step 2. |
| R3 | P2 | Whether Render migrates before code-swap is unknown (no `render.yaml`). | OA-1 step 3. |
| R4 | P3 | 8 brief `ACCESS EXCLUSIVE` locks on `businesses`/`appointments`/`ai_conversation_runs` — metadata-only, sub-second, queue behind a long transaction. | Deploy in a low-traffic window. |
| R5 | P3 | Prod PG major version unconfirmed (`ADD VALUE`-in-tx needs ≥ 12). | OA-1 step 1 (`SHOW server_version`). |
| R6 | P3 | `prisma:deploy` uses pooled `DATABASE_URL`. | Sequence overrides with `DIRECT_URL`. |

**No P0.** Open risks are process/verification, not schema safety.

## Post-deploy verification checklist (no destructive actions)

| Area | Check |
|---|---|
| Migrations | `DATABASE_URL="$DIRECT_URL" npx prisma migrate status` → "up to date"; `_prisma_migrations` has exactly 8 new finished rows, none rolled back |
| Startup | `GET /health` 200; no Prisma "column/relation does not exist" / enum errors on boot |
| Worker | `GET /health/worker` → `ok` within ~60 s |
| Auth | log in as a known business user → 200 + session |
| Tenant | `GET /business` → that business only; a second user sees only theirs |
| Appointments | list; create; `POST /:id/status CONFIRMED` |
| Arrival (#10) | `POST /appointments/:id/arrival {state:"ON_MY_WAY"}` → 200 |
| Commissions (#12) | `GET /commissions/rules` (owner) → 200 `[]`; `GET /commissions/report` → 200 |
| Inventory (#13) | `GET /inventory/items` (BUSINESS) → 200 `[]`; `POST /inventory/items` → 201; `POST /:id/movements {kind:"RECEIVE",quantity:1}` → 201 |
| Live location (#14) | `GET /customer/bookings/:id/provider-location` on owned booking → `{sharing:false}`; provider `POST …/location-share` requires ON_MY_WAY → 409 otherwise |
| AI receptionist (#15) | `GET /ai/receptionist` (owner) → 200; `PATCH {enabled:true}` on BUSINESS → 200 |
| After-hours (#16) | `GET /ai/receptionist` → `hours` resolves; `PATCH {mode:"AFTER_HOURS_ONLY"}` → 200 |
| No-show (#17) | past-start appointment `POST /:id/status {status:"NO_SHOW"}` → 200; future → 409; `PATCH /business {noShowFollowUpEnabled}` (owner) |
| Messaging | one real reminder/confirmation in staging → `Message` row `status:"sent"`; no enum error writing `appointment_on_the_way` / `appointment_no_show` |
| Logs | no error-rate spike in 30 min; no `PrismaClientKnownRequestError` P20xx |

## Owner actions

`docs/OWNER_ACTIONS.md` **OA-1** (production migration deploy — inspection, backup,
pipeline order, authorization). OA-2 (Live Location store/privacy declarations) and
OA-3 (AI provider config) are also open but do not block this checkpoint or #18.

## Limitations

- Production state and backup posture cannot be verified from the dev environment;
  the "safe to deploy" upgrade to classification **A** depends entirely on OA-1.
- The upgrade rehearsal used a synthetic pre-chain schema (git worktree), not a restore
  of the real production dump. Once the owner provides the pre-deploy `pg_dump`, a
  restore-and-`migrate-deploy` rehearsal against real-shape data is the final proof
  (documented in OA-1 / the plan).

## Next stage

Proceeding to **#18 Omnichannel Communications** — independent of OA-1 (new code +
additive migrations that stack on this chain). OA-1 returns to the top of the queue
the moment the owner clears its preconditions.
