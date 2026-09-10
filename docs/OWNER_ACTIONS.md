# Owner Actions — external / irreversible items blocking autonomous work

Per `CLAUDE.md` and `docs/CHAKUSA_AUTONOMOUS_MASTER_ROADMAP.md` §15: when an external
owner action blocks part of the roadmap, it is recorded here and all independent safe
work continues. Resolve these, then tell the agent so the blocked item can proceed.

Status legend: **OPEN** (blocking) · **DONE** · **N/A**

---

## OA-1 — Production migration deployment (migration backlog, checkpoint before #18)

**Status:** OPEN
**Blocks:** deploying the pending additive migrations `20260907204745` … `20260909160000`
to the Render production database. As of #20 the backlog is **10**
(the 8 audited in the checkpoint, plus `20260909140000_conversation_last_read` — an
additive nullable `conversations.last_read_at` column — plus
`20260909160000_review_growth` — additive columns on `businesses` / `appointments` /
`review_requests` / `feedback`, one unique index on an all-NULL new column, one FK,
and two `ALTER TYPE "ActivityEventType" ADD VALUE` — same safety class as the
existing `MessageType` enum migrations, transaction-safe on PG12+). Does
**not** block continued feature development (#18+ is independent code + additive
migrations that stack on this chain locally).
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
   fails hard (the new backend reads the new tables / columns / enum values these
   10 migrations add).

4. **Authorization + window.** Nominate who runs the deploy and a low-traffic window.

**Exact deploy sequence once 1–4 clear** (from `docs/DEPLOYMENT_GUIDE.md` §17):
```
# 0. freeze: main green
npm run build && npm run typecheck && npm run lint && npx prisma validate && npm run test
# 1. backup + rollback point   (step 2 above)
# 2. migrate production FIRST (UNPOOLED url):
DATABASE_URL="$DIRECT_URL" npx prisma migrate deploy
DATABASE_URL="$DIRECT_URL" npx prisma migrate status         # "up to date", +10 rows
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

---

## OA-5 — Universal / App Link identifiers for booking-link deep linking (#21)

**Status:** OPEN (not blocking; deep links stay plain web URLs until set)
**Blocks:** nothing in development. A tapped `/book/<slug>` (or `/r/<token>`) link
opening the **native app** instead of the browser requires these env values, after
which the API automatically serves the well-known documents (routes already built,
they 404 until configured):

1. **`IOS_UNIVERSAL_LINK_APP_ID`** = `<AppleTeamID>.<bundleId>` (e.g.
   `ABCDE12345.app.chakusa`). Also add the `applinks:<customer-web-host>` Associated
   Domain to the iOS app entitlements at build time.
2. **`GOOGLE_PLAY_PACKAGE_NAME`** — the Android package (already an env for billing;
   reused here).
3. **`ANDROID_APP_LINK_SHA256`** — comma-separated SHA-256 fingerprints of the app
   signing cert(s) (Play Console → App integrity → App signing). Add the
   `autoVerify` intent filter for the customer-web host to the Android manifest at
   build time.

`PUBLIC_REVIEW_BASE_URL` (already production-required) is reused as the booking-link
origin — no new base-URL env. The well-known docs must be served from that exact
host, so if the customer web app is on a different origin than the API, that origin
must proxy `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json`
to the API (or serve equivalents).

No store console action is required to *set these* — they are read from
Play Console / Apple Developer and placed in the deployment environment.

---

## OA-6 — #22 Desktop/Web business experience: scope + approach decision

**Status:** OPEN — **blocks starting #22.** #18–#21 are complete and committed.

The #22 stage begins with "Inspect existing admin/website/web app architecture
first." That inspection is done; the result needs an owner decision before build:

**What exists**
- `admin/` — the **platform-admin** React/Vite SPA (Businesses, Users,
  Subscriptions, Security, Audit …). Talks to `/admin/*`. The roadmap explicitly
  forbids exposing platform-admin surfaces to normal businesses, so this is **not**
  the place for the operator web app.
- `website/` — an **Astro** marketing site that also contains a **partially
  scaffolded business dashboard**: `dashboard/business.astro` plus 13 stub pages
  (`automation, bookings, customers, invoices, leads, messages, payments, quotes,
  reminders, reports, reviews, setup, team`). Only the top-level dashboard page is
  wired; the sub-pages are shells.
- `cloudflare/auth-gateway/worker.mjs` — the edge auth gateway the website uses
  (`auth.chakusarecovery.com/v1/*`): realm-separated HttpOnly-cookie sessions,
  Turnstile, Google sign-in. It currently proxies only **`/v1/login`,
  `/v1/register`, `/v1/google`, `/v1/forgot-password`, `/v1/reset-password`,
  `/v1/logout`, `/v1/dashboard` (GET bundle), `/v1/business` (PATCH),
  `/v1/business/onboarding/complete`**. It does **not** expose leads, customers,
  inbox, quotes/invoices/payments, team, inventory, calendar, AI settings, or
  reports — so the 13 stub pages cannot function yet.

**Decisions needed**
1. **Approach**: keep building the operator UI as Astro pages + islands against an
   **expanded auth-gateway**, or introduce a React island app inside `website/`
   (or a new `webapp/` package) for the interactive CRUD screens? The mobile app
   uses a custom M3 kit; `admin/` has its own components — which design system does
   web reuse?
2. **Gateway expansion**: confirm the pattern for adding proxied `/v1/*` routes
   (the gateway does a cookie→bearer exchange + CSRF + realm check per route). Each
   new operator area needs a gateway route; this is the bulk of the backend-adjacent
   work and should be reviewed as a unit.
3. **V1 scope**: which of dashboard / calendar / leads / customers / inbox /
   quotes-invoices-payments / team / inventory / AI settings / reports are in the
   first web-parity cut vs. deferred? "Core operational parity for high-value
   workflows" (the completion bar) needs the owner to name the high-value set.
4. **Verification**: `website/` has no UI test harness and `cloudflare/auth-gateway`
   has `worker.test.mjs` only. The roadmap's "regression coverage" for #22 needs a
   decision on the test approach (Playwright against a preview deploy? gateway
   unit tests + component tests?). UI correctness here cannot be self-verified by
   the agent at the scale of ~13 screens.

Until (1)–(3) are set, #22 build cannot proceed without risking a
materially-different, hard-to-reverse product/architecture choice. #23 Production
Hardening (backend worker/outbox/webhook/rate-limit/index reliability) is
independent of this and is the next agent-executable stage if the owner wants
work to continue while #22 is decided.

---

## OA-6 — #22 web console approach — RESOLVED

**Status:** DONE — `docs/OWNER_DECISION_OA6_STAGE22_WEB.md` (owner) approved the
`website/` Astro + `cloudflare/auth-gateway` approach and the V1 scope. #22 V1 is
built and reported (`docs/progress/2026-09-10-stage-22-desktop-web.md`).

---

## OA-7 — DATABASE_URL pool / timeout parameters (#23)

**Status:** OPEN (non-blocking; a deploy-time config change, not code)

Apply to the Render Postgres **pooled** `DATABASE_URL` (see
`docs/PRODUCTION_HARDENING.md` §7 for the reasoning):

```
?connection_limit=<N>&pool_timeout=10&connect_timeout=5&options=-c%20statement_timeout%3D30000
```

- `connection_limit` sized so `api_replicas × connection_limit ≤` the pgbouncer /
  Postgres connection ceiling (Prisma's default overshoots on a small pool and is
  the cause of the "internal server error" contention under heavy parallel load).
- `statement_timeout=30000` is the handler-execution bound that Fastify's
  `requestTimeout` (slow-loris only) does not provide.
- Leave `DIRECT_URL` (used only for `prisma migrate deploy`) plain.

No code change; applied on the Render dashboard / service env at the next deploy.

---

## OA-8 — #26 Release Readiness owner gates

**Status:** OPEN (release-blocking; engineering is complete up to this boundary —
see `docs/RELEASE_READINESS_CHECKLIST.md`)

1. **Deploy the migration chain** (OA-1) and set the DB pool params (OA-7).
2. **Enable `TRUST_PROXY`** in the production API env once the reverse proxy is
   confirmed to set `X-Forwarded-For` correctly.
3. **Android release build** — local Windows/PowerShell tooling only (never EAS,
   per project rules). Sign; set `android.versionCode` (currently 1; iOS
   `buildNumber` is 5 — reconcile the release numbers).
4. **iOS build** — EAS → TestFlight → App Store submission.
5. **`expo prebuild` manifest check** — grep the merged `AndroidManifest.xml` for
   `com.google.android.gms.permission.AD_ID`; remove it with `tools:node="remove"`
   if unwanted, or declare advertising-ID use in Data Safety.
6. **Store declarations (extends OA-2):**
   - Play Data Safety + Apple App Privacy per the inventory in
     `RELEASE_READINESS_CHECKLIST.md` §8–9.
   - **Android call screening:** the `withCallDetection` plugin declares
     `READ_PHONE_STATE` **and `READ_CONTACTS`**. Play requires a Permissions
     Declaration for a `CallScreeningService` and scrutinises `READ_CONTACTS`.
     Justify precisely (contacts are *never read* — Telecom only checks the
     permission's presence before exempting a contacts-matched call from
     screening), or ship the missed-call feature without `READ_CONTACTS`.
   - Live Location: precise (5-dp), foreground-only, appointment functionality,
     **not tracking**, ephemeral/no history.
7. **Privacy policy text** at `chakusarecovery.com/privacy` — name Twilio (message
   delivery), Stripe/Apple/Google (payments), Sentry (diagnostics) as processors;
   describe Live Location's ephemeral appointment-scoped nature; describe the
   call-screening `READ_CONTACTS` use.
8. **Store consoles:** enter the public account-deletion URL
   (`https://chakusarecovery.com/delete-account`); provide reviewer credentials
   (seed a staging DB with `npm run seed:qa` and share the printed logins + a
   feature-navigation note from `RELEASE_QA_MATRIX.md`); upload accurate
   screenshots/metadata.
9. **Physical-device QA** — execute `docs/RELEASE_QA_MATRIX.md`. Gate: all P0 on
   all platforms, all P1 on ≥1 iOS + ≥1 Android, no open P0/P1.
10. **Marketing/store copy** — do not claim: automatic AI message answering until
    OA-3 is applied on the release env; "tap a link to open the app" until OA-5;
    full browser parity (web quote/invoice creation, team admin, report detail are
    deferred — see `docs/progress/2026-09-10-stage-22-desktop-web.md`).

No engineering P0/P1 is open. Once 1–9 are done and QA passes, V1 can ship.
