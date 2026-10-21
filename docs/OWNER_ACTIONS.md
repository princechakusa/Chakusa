# Owner Actions — external / irreversible items blocking autonomous work

Per `CLAUDE.md` and `docs/CHAKUSA_AUTONOMOUS_MASTER_ROADMAP.md` §15: when an external
owner action blocks part of the roadmap, it is recorded here and all independent safe
work continues. Resolve these, then tell the agent so the blocked item can proceed.

Status legend: **OPEN** (blocking) · **DONE** · **N/A**

---

## OA-1 — Production migration deployment (migration backlog, checkpoint before #18) — RESOLVED

**Status:** DONE — verified 2026-09-22 via read-only inspection against production
`DIRECT_URL`. All 10 migrations listed below (`20260907204745` … `20260909160000_review_growth`)
have `finished_at` set and `rolled_back_at IS NULL`; `prisma migrate status` reports
"Database schema is up to date"; the unfinished/rolled-back check returned zero rows.
They applied 2026-09-10T03:45:27Z, matching Render deploy `dep-dah2fd8ae00c73afljt0`
(live 2026-09-10T03:44:53–03:46:18Z). Server is PostgreSQL 17.6, **Supabase-hosted**
(`aws-0-eu-central-1.pooler.supabase.com`), not Render Postgres — the original
"Render database page / Recovery tab" instruction below is stale; backup/PITR must be

**New follow-up — OA-1b (backup gap, still OPEN):** confirmed 2026-09-22 the Supabase
project is on the **Free tier**: no automated daily backups, no PITR. Owner decision
(2026-09-22): deferred — continue other release work now, revisit the Supabase Pro
upgrade (or a manual `pg_dump` safety net) later, before further schema-changing
migrations are deployed against this database. Do not treat future migrations as
low-risk until this is resolved.
confirmed in the Supabase dashboard instead, not Render's.

**Original text below, retained for history:**

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

## OA-7 — DATABASE_URL pool / timeout parameters (#23) — RESOLVED

**Status:** DONE — applied and verified 2026-09-22. Owner added
`&connection_limit=5&pool_timeout=10&connect_timeout=5&options=-c%20statement_timeout%3D30000`
to the pooled `DATABASE_URL` on the `chakusa-api` Render service (manual deploy from
the dashboard). `connection_limit=5` was sized for the current single free-tier
instance (1 API replica, no separate worker service on Render). Verified live:
`prisma`-style URL parsing confirms all four params present on the deployed value;
the resulting deploy (`dep-dap6o6mgekts738077d0`) went `live`; `/health` and
`/health/ready` both return 200 afterward.

Original text retained for history — apply to the Render Postgres **pooled**
`DATABASE_URL` (see `docs/PRODUCTION_HARDENING.md` §7 for the reasoning):

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
If instance count grows later, revisit `connection_limit` sizing against the new
`api_replicas` count.

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

## OA-9 — Google / Apple sign-in console checks, and map-service scale (2026-09-26)

Engineering root cause of the broken Google login on Android is **fixed in
code**. The local release AAB was built with none of the `eas.json`
`EXPO_PUBLIC_*` values (no API URL, no Google client ID); see
`docs/ANDROID_KEYSTORE_HANDOFF.md`. Rebuild with `npm run android:bundle-release`.
Production API probe (2026-09-26): `/auth/google` verifies tokens (401 on a
fake token, not 503) and `/auth/apple/challenge` returns 200, so both
providers are enabled server-side. The remaining steps are console settings
only the owner can make:

1. **RESOLVED (2026-09-26, verified on a real Android phone):** the original
   Google Cloud project (client IDs prefixed `618618639466-...`) turned out
   to belong to a Google login this account cannot reach — it wasn't in any
   project visible under "All projects". Re-registered everything under the
   **"Chakusa"** project (number `1004047431327`) this account does control:
   a Web application client (now the value of `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`
   in `mobile/eas.json`, and required in Render's `GOOGLE_OAUTH_CLIENT_IDS`
   below), and Android clients for `com.chakusa.mobile` covering the upload
   key SHA-1 and the local debug-build SHA-1. Confirmed working end-to-end:
   signed in with a real Google account on a physical device, all the way to
   the customer home screen. **Still outstanding:**
   - **Play App Signing SHA-1** not yet added (only matters once a build is
     actually re-uploaded to Play Console — the upload-key SHA-1 already
     covers that step).
   - **iOS OAuth client not recreated** — `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`
     and `app.json`'s `iosUrlScheme` still point at the old, dead project.
     Create a real iOS client in the "Chakusa" project (bundle ID
     `com.chakusa.mobile`) before the next iOS build attempts Google
     Sign-In — see `docs/GOOGLE_SIGN_IN_SETUP.md` §3.
   - **OAuth consent screen publishing status**: the successful test was
     with the project owner's own Google account, which always works even
     while the consent screen is "Testing". Confirm it's published ("In
     production") — or every other real customer will fail to sign in
     until they're individually added as a test user.
   - The website's Google buttons (`website/src/pages/login.astro`,
     `create-account.astro`) were updated to the same new client ID; they
     proxy through the `auth-gateway` Cloudflare Worker to the same
     already-fixed backend, so no separate server config was needed there.
2. **Render → API env:** confirm `GOOGLE_OAUTH_CLIENT_IDS` includes the
   **new web client ID** above (`1004047431327-s5baiopm6k2msj3phgl2bkjj4q8d1ehv
   .apps.googleusercontent.com`) — this was updated during the 2026-09-26
   test session; verify it's still there and the old dead value is removed.
3. **Apple:** `APPLE_CLIENT_ID` on the API must be the bundle ID
   `com.chakusa.mobile`, because native Sign in with Apple tokens are issued
   to the bundle ID. The App ID needs the *Sign in with Apple* capability,
   which EAS applies from `usesAppleSignIn`. iOS builds stay on EAS.
4. **Rotate the Render API key and Supabase access token** that were pasted
   into a chat session on 2026-09-26. They were not stored anywhere, but
   treat them as exposed.
5. **Maps at scale (no action needed now):** the map uses OpenStreetMap's
   free tile servers and Nominatim. Both are free and keyless, and the app
   follows their usage policies: attribution, at most one geocoder request
   per second per device, caching, and a valid Referer or User-Agent. Both
   services are volunteer-run and meant for light use. If daily active users
   grow into the thousands, move tiles and geocoding to a paid or self-hosted
   provider. That is a vendor decision and has no cost today.
6. **Store privacy declarations (extends OA-2 / OA-8 item 6):** location
   now also powers "near me" search and pinning a business. For a search,
   the customer's position goes to the Chakusa API as a query parameter and
   to OpenStreetMap Nominatim to name the area. It is used in real time and
   **stored nowhere**. A business's pinned location is stored and shown
   publicly on its profile, as its address already is. The iOS permission
   text (`app.json`, `expo-location`) now lists all three uses. Reflect
   them in Apple App Privacy and Play Data safety.

## OA-10 — Twilio toll-free verification resubmission (2026-10-14) — SUBMITTED, awaiting Twilio review

**Resubmitted 2026-10-14** (inside the priority-review window) with the owner's
Terms/STI-PA attestation. Console status: "verification in progress". Twilio
emails the outcome to support@chakusarecovery.com (forwards to the owner).
Still open: item 4 below (account upgrade), plus releasing a new app build so
customers see the consent checkbox.

Twilio rejected verification for +1 844 604 1271 with errors 30482 (generic
email) and 30513 (opt-in not shown). The product fix has shipped (see
`docs/progress/2026-10-14-twilio-toll-free-sms-consent.md`). Company addresses
@chakusarecovery.com now forward to the owner's Gmail through Cloudflare Email
Routing. The owner must:

1. Give the real business street address (and postcode, or none) and a
   contact phone number that is not the toll-free number.
2. Review the corrected form:
   - Business email: `prince@chakusarecovery.com`.
   - Notification email: `support@chakusarecovery.com`.
   - Opt-in proof URL: `https://chakusarecovery.com/sms`.
   - "Age gated" unticked.
   - Sample message includes the business name and STOP.
3. Personally tick the Twilio Terms and the STI-PA traceback certification,
   then submit. These are legal attestations on the owner's behalf.
4. Messaging to unverified numbers needs an upgraded (paid) Twilio account.
   That is a separate owner decision.

## OA-11 — Android upload-key password lost (2026-10-14) — RESET REQUESTED 2026-10-16

**2026-10-16:** Play Console confirmed Play App Signing, with the lost key
(SHA-1 `3B:07:…:C6:4B`) registered as the upload key. A new upload key was
generated at `C:\Users\Dev Prince\.chakusa\android\chakusa-upload-2026-10.p12`
(alias `chakusa-upload`, SHA-1
`32:5C:1D:12:3A:B7:B4:00:E3:32:AB:29:DE:8A:1A:A9:3D:2B:5F:6F`). Its password is
in the `.password.txt` file beside it, outside Git; the owner should move it to
a password manager. The owner submitted the upload key reset with the `.pem`.
AAB versionCode 2 is built and signed with the new key, at
`.chakusa\android\chakusa-v1.0.0-vc2-2026-10-16.aab`. Still to do once Google
approves: upload the AAB to Internal testing.
Google Sign-In (project chakusa-507914), done 2026-10-16: the "Chakusa
Android" client now uses the new upload SHA-1, and "Chakusa Android (Play)"
was created with the Play app-signing SHA-1
`42:31:19:EE:30:10:8C:7D:B7:CD:01:7E:37:C1:4B:2B:85:F4:78:08`.

**2026-10-21 correction — owner action needed:** that value is the first 20
bytes of the Play app-signing **SHA-256**, not its SHA-1, so Play installs were
blocked as "not genuine" (fixed in the app from versionCode 8) and Google
Sign-In on Play installs cannot work. Read from a Play-installed copy with
apksigner, the Play app-signing certificate is:
- SHA-1 `AF:99:0A:BC:23:F8:27:EB:96:20:CB:F3:EF:41:C3:DC:BF:05:6F:F4`
- SHA-256 `42:31:19:EE:30:10:8C:7D:B7:CD:01:7E:37:C1:4B:2B:85:F4:78:08:8B:8B:39:65:C4:CC:04:28:92:10:4C:C1`

Owner: in Google Cloud (project chakusa-507914) → Credentials → "Chakusa
Android (Play)", replace the SHA-1 with `AF:99:0A:BC:…:6F:F4`. Always copy
fingerprints from Play Console → App integrity, or with
`apksigner verify --print-certs`, and check the length: SHA-1 is 20 bytes,
SHA-256 is 32.

Original note:

The upload keystore `C:\Users\Dev Prince\.chakusa\android\chakusa-upload.p12`
(alias `chakusa-upload`, created 2026-09-22) still exists, but none of the
owner's known passwords open it, so no signed AAB can be built. The
2026-09-23 AAB was signed with this key: upload-certificate SHA-1
`3B:07:CF:9F:66:A7:FA:45:AF:CE:AB:13:42:85:F3:1B:98:A2:C6:4B`.

Check Play Console → Chakusa → Test and release → App integrity:
- **No app or no upload yet:** generate a new upload key, store its password
  in a password manager this time, then build versionCode 2.
- **An upload exists with the SHA-1 above:** request "Upload key reset" there.
  Generate the new key first and upload its certificate (.pem) with the
  request. Google usually approves within 1–2 days.
Either way, update the Google Sign-In Android OAuth client SHA-1 afterwards.
App versions are already bumped: iOS build 6 (sent to TestFlight), Android
versionCode 2.

## OA-12 — Production switches for AI, Google Sign-In (iOS) and missed calls (2026-10-14) — OPEN

Code for all of these shipped on 2026-10-14. Each item below is a console
setting or credential that only the owner can create.

1. **AI (OpenRouter, free models).** OpenRouter → Keys → create a key. Then
   in Render → chakusa-api → Environment set:
   - `OPENAI_API_KEY` = the OpenRouter key
   - `OPENAI_BASE_URL` = `https://openrouter.ai/api/v1`
   - `OPENAI_DEFAULT_MODEL` = `google/gemma-4-31b-it:free`
     (alternative: `nvidia/nemotron-3-super-120b-a12b:free`)

   Save to redeploy. On startup the API registers that model, because no
   model is active yet (`src/lib/ai/bootstrapModel.ts`). Free models allow
   about 50 requests a day. Adding $10 of OpenRouter credit raises that to
   about 1,000 a day while staying on the free models.
2. **Google Sign-In on iPhone — RESOLVED 2026-10-15.** Created "Chakusa iOS"
   (`1004047431327-bi3d48hqkhasgtvk46q3adrtglmtnt04`) in project
   chakusa-507914. eas.json and app.json are updated, and the consent screen
   is already In production. Ships in the next iOS build. Original steps: Google Cloud Console → project "Chakusa"
   (1004047431327) → Credentials → Create OAuth client → **iOS**, bundle ID
   `com.chakusa.mobile`. Give the new client ID to engineering, which will
   update `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` and `iosUrlScheme`, then rebuild
   iOS. Also confirm OAuth consent screen → Publishing status = **In
   production**; otherwise only test users can sign in.
3. **Missed-call texts.** Detection runs on Android only, because iOS gives
   apps no access to calls. It also needs:
   - an Android build (blocked by OA-11)
   - Twilio verification approved (OA-10) and the account upgraded from trial
   - Render: `TWILIO_ENABLED=true` plus the account SID, auth token and
     `TWILIO_FROM_NUMBER=+18446041271`
   - Pro plan and the automation rule switched on in the app (automation
     screens now default to on)

## OA-13 — Missed call → WhatsApp → AI booking → review: production switches (2026-10-15) — OPEN

The code path is complete and tested (see
`docs/progress/2026-10-15-missed-call-whatsapp-ai-receptionist.md`). On
2026-10-15 the owner's Android phone reported both test missed calls as leads
in production. Nothing was sent to the caller, for the reasons below. Each one
is a console setting only the owner can change.

1. **Render → chakusa-api → Environment**
   - `COMPLIMENTARY_PLAN_GRANTS=chakusaprince@gmail.com:BUSINESS`. This must
     be the app's sign-in email; a placeholder matches nobody. The account was
     still on the Free plan, so automation and the AI receptionist were locked.
   - `GEMINI_DEFAULT_MODEL` set to a real model id. `/health/ai` reported
     `configured:false` with no active model.
   - `RUN_WORKER_IN_API=true`. There has been no worker since 2026-08-31, so
     no scheduled message (follow-ups, reminders, review requests) has been sent.
   - `AI_CUSTOMER_AGENT_ENABLED=true` (platform AI receptionist switch).
   - Twilio: `TWILIO_ENABLED=true`, `TWILIO_ACCOUNT_SID`,
     `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` (for testing:
     `whatsapp:+14155238886`, the Twilio Sandbox).
2. **Twilio WhatsApp sender.** For testing, use the Sandbox: the test phone
   first sends `join <code>` to +1 415 523 8886. Then, under Sandbox settings,
   set "When a message comes in" to
   `https://chakusa-api.onrender.com/webhooks/twilio/inbound` (POST). Production
   needs a WhatsApp Business sender registered with Meta (Messaging → Senders →
   WhatsApp senders), with the same inbound webhook URL.
3. **WhatsApp templates** (Content Template Builder; submit both for WhatsApp
   approval). Then set the HX… SIDs on Render:
   - `TWILIO_WHATSAPP_MISSED_CALL_CONTENT_SID`: e.g. "Hi, this is {{1}}.
     Sorry we missed your call. How can we help? Reply here and we'll sort it out."
   - `TWILIO_WHATSAPP_REVIEW_REQUEST_CONTENT_SID`: e.g. "Hi {{1}}, thanks
     for visiting {{2}}! Would you leave us a quick review? {{3}}"
   Without them, free text is sent. That only works in the Sandbox or inside
   a customer's 24-hour reply window.
4. **SMS to UAE (+971) numbers.** The toll-free +1 844 number can only text
   the US and Canada, and a trial account can only text verified numbers.
   UAE SMS needs an upgraded account and a registered alphanumeric sender ID.
   Until then, WhatsApp is the channel for UAE callers.
5. **In the app** (after item 1 redeploys): More → Automation → missed-call
   follow-up on, channel WhatsApp, delay Immediately. More → AI receptionist
   → on, WhatsApp on, "Answers and acts automatically". Business profile →
   confirm messaging consent and turn on automatic review requests.

## OA-14 — Signed Android rebuild after the security fixes (2026-10-19) — RESOLVED

**Status:** DONE 2026-10-19. The upload-key password was never wrong: the first build read the whole `chakusa-upload-2026-10.password.txt` (four labelled lines) as the password instead of its `password:` line. The rebuilt APK (SHA-256 `bad03f25e342931e9c7d945786a4274f83774c1dbd905d18923c0604e9179c14`, signer SHA-1 `32:5C:1D:12…5F:6F`) contains `expo-crypto` and is not debuggable. It is installed on the test phone and cold-launches to the welcome screen with no crash. The phone's previous copy had a different signature, so it was uninstalled first; it held only a fresh install with no account.

Still open: authenticated device QA (uploads, sign-in, maps, call screening, push) and a MobSF scan of this exact APK (the scanner's web login is needed).

## OA-15 — Outbound email for password reset (2026-10-19) — RESOLVED 2026-10-20

**Why:** Both apps now always show Sign in / Create account with email + password (the API has always accepted these; they need no outbound mail). "Forgot password?" sends a real reset email only when `/app-config` reports `features.passwordReset: true`, which requires BOTH the admin switch **Password reset email** (`app.email_auth_enabled`) AND `RESEND_API_KEY` + `EMAIL_FROM` set on the API. Live production on 2026-10-19 reports `emailAuth: false`, so reset currently tells people to contact support instead of promising an email.

**Owner steps:**
1. Verify the sending domain in Resend (a paid/vendor account decision) and create an API key.
2. In Render → `chakusa-api` → Environment, set `RESEND_API_KEY`, `EMAIL_FROM` (e.g. `Chakusa <no-reply@chakusarecovery.com>`) and `EMAIL_ENABLED=true`; confirm `PASSWORD_RESET_URL` points at the live reset page. Redeploy.
3. In the admin console → App config, turn on **Password reset email**.
4. Request a reset for a test account and confirm the email arrives and the link resets the password.

Until then, sign-in and sign-up work; only self-service reset is unavailable.

**Resolved 2026-10-20:** `chakusarecovery.com` added and verified in Resend (DKIM `resend._domainkey`, `send`/`rsend` CNAMEs, `_dmarc` p=none in Cloudflare, DNS only; existing Email Routing MX/SPF untouched). Render: `RESEND_API_KEY` (owner-pasted), `EMAIL_FROM=Chakusa <no-reply@chakusarecovery.com>`, `EMAIL_ENABLED=true`, live 18:35. Admin switch *Password reset email* on; `/app-config` reports `passwordReset: true`. Remaining: owner confirms a real reset email arrives for an existing account.

**Earlier note:** a send-only Resend key exists on the build machine (user environment variable) - it can be reused for step 2, but its domain status can't be read with a send-only key, so confirm the domain shows *Verified* in the Resend dashboard. Reset is now hardened (per-account cooldown and hourly cap, timing-safe response, other links retired on reset, "password changed" notice, token stripped from the reset page URL).

## OA-16 — Turn on Google Play Integrity (anti-clone, server side) (2026-10-19) — OPEN

**Status:** OPEN (not blocking; the code ships with `PLAY_INTEGRITY_MODE=off`)

**What's already in place:** a release build signed by any other key refuses to run (signature self-check, tested on the phone with a re-signed clone). The server can additionally require a Google Play Integrity attestation on Android sign-in, so a clone that strips the self-check still can't sign in. Verdicts accepted: `PLAY_RECOGNIZED`, our app-signing certificate, `MEETS_DEVICE_INTEGRITY`.

**Owner steps:**
1. Play Console → Chakusa → Test and release → App integrity → Play Integrity API → link the Google Cloud project `chakusa-507914`.
2. Google Cloud → `chakusa-507914` → enable the **Google Play Integrity API**. Note the **project number** (Dashboard → Project info).
3. IAM → Service accounts → create `chakusa-play-integrity` (no roles needed for decoding), then create a JSON key. Base64-encode it.
4. Play Console → App integrity → App signing → copy the app-signing certificate **SHA-256**, converted to base64url (Play Integrity reports `certificateSha256Digest` in that form).
5. Render → `chakusa-api` → Environment: `PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON_BASE64`, `PLAY_INTEGRITY_CERT_SHA256` (comma-separated if more than one), `PLAY_INTEGRITY_MODE=report`.
6. `mobile/eas.json` production env: `EXPO_PUBLIC_PLAY_INTEGRITY_PROJECT_NUMBER=<project number>`. Rebuild and ship through Play (Integrity only recognizes Play-distributed builds).
7. Watch the API logs for `app_integrity_unverified` / `app_integrity_rejected` for a few days, then set `PLAY_INTEGRITY_MODE=enforce`.

**Known limit:** the API can't yet tell a clone posing as the website or the iOS app from the real ones. Closing that needs a gateway→API shared secret and Apple App Attest for iOS (backlog).

## OA-17 — Google ratings and "also nearby" places (Google Places API) (2026-10-20) — OPTIONAL

**Status:** OPTIONAL. Decision 2026-10-20: stay free. Nearby places now come from OpenStreetMap (no cost, drawn on the map with attribution) and every business page has a free "See reviews on Google Maps" link (Google Maps URLs, no key). The paid Places integration below stays built but switched off; only revisit when revenue justifies ~US$300-900/month at 1,000 users.

**What's built:** owners link their Google Business listing (Photos & Google screen); customers then see the live Google rating on the business page, and Explore's list view shows "Also nearby" Google places with attribution. Only the Google place ID is stored; ratings are fetched live and cached in memory for 10 minutes, per Google Maps Platform terms. Google content is never drawn on the OpenStreetMap map.

**Owner steps (paid vendor decision - Google bills per request above the free tier):**
1. Google Cloud -> project `chakusa-507914` -> enable **Places API (New)** and set a billing budget alert.
2. Credentials -> create an API key restricted to **Places API (New)** only (server key: restrict by API, not by app).
3. Render -> `chakusa-api` -> Environment: `GOOGLE_PLACES_API_KEY=<key>`. Redeploy.
4. In the business app -> More -> Business settings -> Photo gallery & Google rating -> Find -> pick your listing; open your page in the customer app and confirm the Google rating shows.

**Later (optional):** showing every place on the map itself, Google Maps style, needs the Google Maps SDK map (Android + iOS keys) instead of OpenStreetMap - a separate step once the Places key is live.
