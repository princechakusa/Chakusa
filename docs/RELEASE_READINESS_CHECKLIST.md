# Chakusa — Release Readiness & Store Compliance (#26)

State of every #26 requirement. **Engineering** items are complete/verifiable in
this repo; **Owner** items require deploy access, a store console, a signing
identity, or a physical device and are tracked in `docs/OWNER_ACTIONS.md`.

**Release rule (roadmap #26):** no declaration may claim a feature/control the
shipped app does not implement.

---

## 1. Migrations & database — Owner (OA-1) + Engineering (verified locally)

| Item | State |
|---|---|
| Additive-only migration chain audited | ✅ `docs/progress/2026-09-09-deployment-checkpoint.md` — classification B, all additive, enum-safe on PG12+ |
| Rehearsed locally (clean-from-zero + prod-shaped upgrade) | ✅ both PASS, app boots |
| **Applied to production** | ⏳ **OA-1** — 10 pending migrations; read-only prod inspection + pre-deploy `pg_dump` + pipeline order are owner steps |
| DB connection-string parameters (`connection_limit` / `pool_timeout` / `connect_timeout` / `statement_timeout`) | ⏳ **OA-7** — `docs/PRODUCTION_HARDENING.md` §7, deploy-time env change |
| Post-deploy verification checklist | ✅ in the deployment-checkpoint report |

## 2. Production environment / config audit — Engineering ✅

- `src/lib/config.ts` validates every required secret at boot in production
  (fails the deploy, not the first request): `JWT_SECRET`,
  `PROVIDER_TOKEN_ENCRYPTION_KEY`, `PUBLIC_REVIEW_BASE_URL` (https), Apple/Google
  billing bundles when their `*_ENABLED` flag is on, `APPLE_ROOT_CERTIFICATES_BASE64`
  when Apple billing is on.
- `TRUST_PROXY` must be enabled in production (documented) — otherwise IP rate
  limiting and the `X-Request-Id` trust see only the proxy IP.
- Hardening review complete: `docs/PRODUCTION_HARDENING.md` (14 areas, no P0/P1).
- Backend `npm audit` (runtime deps): **0 vulnerabilities** (#24).
- Correlation ids, graceful shutdown, health endpoints, worker step-isolation +
  fail-safe: all in place (#23).

## 3. Android release build — Owner

Per project build rules (`.claude` memory): **Android builds are Windows /
PowerShell / local tooling only — never EAS.** The engineering repo is build-ready:
`app.json` complete, custom `withCallDetection` config plugin present, `expo
install --check` clean (#26). The owner runs the local release build, signs it,
and sets `android.versionCode` for the release (currently `1`; iOS `buildNumber`
is `5` — reconcile).

## 4. iOS release path — Owner

`app.json` has `ios.bundleIdentifier`, `usesAppleSignIn: true`, `buildNumber: "5"`,
`ITSAppUsesNonExemptEncryption: false`, EAS `projectId`. The owner runs the
EAS build → TestFlight → App Store submission.

## 5. `expo install --check` — Engineering ✅

"Dependencies are up to date" after `expo install --fix` (5 Expo SDK 57 packages
aligned to expected patches; mobile tsc + 519 tests green).

Note: `npm audit` in `mobile/` reports ~20 moderate advisories, all in Expo
**build-time** tooling (`@expo/config-plugins`, `@expo/prebuild-config`,
`expo-splash-screen`'s plugin) that does not ship in the app bundle. Track for the
next SDK bump; not a release blocker.

## 6. Native permission audit — Engineering ✅ (declarations are Owner)

From `mobile/app.json` + `mobile/plugins/withCallDetection.js`:

| Permission / capability | Source | Justification | Declaration |
|---|---|---|---|
| Location — **foreground only** | `expo-location` plugin | Provider→customer "on my way" for an appointment. `locationAlwaysPermission`, `isIosBackgroundLocationEnabled`, `isAndroidBackgroundLocationEnabled`, `isAndroidForegroundServiceEnabled` all **false**. Usage string is specific and matches the feature. | **OA-2**: Play Data Safety = Location (precise, 5-decimal) *collected*, *App functionality*, not sold, ephemeral. Apple App Privacy = Precise Location *collected*, *App Functionality*, **not Tracking**. |
| `READ_PHONE_STATE` (Android) | `withCallDetection` | Telecom `CallScreeningService` for missed-call recovery | **OA-2 (extended)**: declare the call-screening feature; Play requires a Permissions Declaration for `CallScreeningService`. |
| `READ_CONTACTS` (Android) | `withCallDetection` | **Not** used to read the address book — Telecom checks for it before exempting a contacts-matched call from screening (AOSP `CallFilteringCompletionInfo`). | **OA-2 (extended)**: Play scrutinises `READ_CONTACTS`. Justify precisely as above; consider whether the feature can ship without it (screening still works for non-contact numbers). |
| Push notifications | `expo-notifications` | Booking / message / review alerts | Standard; no Data Safety trigger |
| Apple Sign-In | `expo-apple-authentication` | Auth | Standard |
| Camera / mic / photos | none configured | — | Not requested |

**No `ACCESS_BACKGROUND_LOCATION`, no `FOREGROUND_SERVICE_LOCATION`.**

## 7. Unintended Android `AD_ID` — Owner (verify in the generated manifest)

`com.google.android.gms.permission.AD_ID` is auto-added by some Play Services /
ads SDKs. Chakusa configures none, but `expo-notifications` / `expo-iap` may pull
Play Services transitively. **Owner:** after `expo prebuild`, grep the merged
`AndroidManifest.xml` for `AD_ID`; if present and unwanted, add
`<uses-permission android:name="com.google.android.gms.permission.AD_ID" tools:node="remove"/>`.
Then either declare no advertising ID use in Data Safety, or remove it.

## 8–9. Play Data Safety / Apple App Privacy alignment — Owner (OA-2)

Must match the built app's actual collection. The engineering inventory:

| Data | Collected? | Purpose | Shared? | Retention |
|---|---|---|---|---|
| Email, name | Yes | Account, auth | No | Account lifetime; deleted on account deletion (some retained for security/legal) |
| Phone (business & customer contacts) | Yes | Messaging, booking, reminders | With the messaging provider (Twilio) to deliver a message | Account/record lifetime |
| Approx./precise location (provider, while sharing) | Yes | App functionality (arrival) | Shown to that appointment's customer only | **Ephemeral** — auto-expires, deleted on completion; no history |
| Payment info | Processed by Apple/Google (subscriptions) and Stripe (invoice checkout) | Billing | With those processors | Per processor; Chakusa stores no card data |
| Contacts (Android) | **Accessed, not stored** | Call-screening exemption check only | No | Not retained |
| Usage / diagnostics | Sentry (errors) | Crash/diagnostics | With Sentry | Sentry retention; PII scrubbed |
| App activity (leads, bookings, reviews, inventory…) | Yes (business's own operational data) | App functionality | No | Account lifetime |

Not collected: precise browsing history, health, financial account numbers,
contacts *content*, photos/media (unless a user attaches one to a message),
advertising identifiers.

## 10. Live Location disclosure — Engineering ✅ / Owner declaration (OA-2)

- 5-decimal coordinates = **precise** location (roadmap rule). Code stores 5-dp.
- Foreground appointment functionality only; **not tracking**; no history anywhere
  (verified #24). Auto-expiry runs every worker cycle.
- Owner declares accordingly in both stores + the privacy policy.

## 11. Privacy policy — Owner (OA-2)

The published `chakusarecovery.com/privacy` must state the collection/sharing/
retention in §8–9 above, explicitly including: Twilio as a message-delivery
processor; Stripe/Apple/Google as payment processors; Sentry as a diagnostics
processor; the ephemeral, appointment-scoped, non-historical nature of Live
Location; and the Android call-screening `READ_CONTACTS` use.

## 12. Account deletion flow / URL — Engineering ✅

- In-app: `POST /auth/delete-account` requires re-verification (password, or a
  fresh Google id-token with matching subject, or an Apple proof). Verified #24.
- Public URL: `https://chakusarecovery.com/delete-account` (Astro page with
  instructions + a request form).
- **#26 fix applied:** the in-app Support / Delete-Account screens, the business
  share URL, and the team-invite link were pointing at the wrong domain
  (`chakusa.com`); now sourced from `PUBLIC_WEB_ORIGIN` = `chakusarecovery.com`.
- **Owner:** enter the public deletion URL in both store consoles.

## 13. Store reviewer credentials / instructions — Owner

Seed a staging DB with `npm run seed:qa` and hand the reviewer the printed
owner + customer logins, plus a one-page "how to reach each feature" note built
from `docs/RELEASE_QA_MATRIX.md`. For subscription review, provide sandbox
purchase steps.

## 14. Screenshots / metadata — Owner

Must show real, current screens. Nothing in metadata may claim a capability the
shipped build lacks (see §16).

## 15. Crash-free launch & smoke tests — Engineering ✅ (device run is Owner)

- Backend: the full test suite (run in focused batches — 100s of tests across
  auth, tenancy, entitlements, messaging, booking, marketplace, reviews, worker,
  hardening) is green; backend + test `tsc` clean.
- Mobile: `tsc` clean; **519/519** unit tests.
- Web: `astro check` (310 files) + `astro build` (76 pages) clean; gateway
  `node --test` 12/12; capability drift test green.
- **Owner:** cold-launch smoke on physical iOS + Android per `RELEASE_QA_MATRIX.md`
  §1, and the full P0 matrix.

## 16. Feature ↔ declaration reconciliation — Engineering ✅

Every V1 feature the app can claim, and where it is actually implemented:

| Feature | Implemented | Notes |
|---|---|---|
| Business auth (email / Google / Apple) | ✅ backend + mobile + web gateway | |
| Customer auth + marketplace + booking | ✅ | discovery→profile→availability→booking E2E (#19) |
| Appointments, arrival, live location | ✅ (#10, #14) | live location ephemeral, no history |
| Leads / customers / dispatch board | ✅ | |
| Messaging (SMS/WhatsApp) inbox, templates, opt-out | ✅ (#18) | real send needs Twilio creds (owner) |
| Quotes / invoices / customer payments | ✅ backend + mobile; web = view only | web quote/invoice **creation** deferred (#22 report) |
| Subscriptions / IAP (Apple + Google) | ✅ server-verified | |
| Reviews & reputation (requests, auto-request, replies, metrics) | ✅ (#20) | |
| No-show automation | ✅ (#17) | non-punitive, no scoring, no fee |
| Inventory + audited ledger | ✅ (#13) | Business plan |
| AI Receptionist / after-hours | ✅ control layer (#15/#16); **answers only when a provider is configured** — OA-3 | do **not** claim "AI answers your messages" until OA-3 is done on the release env |
| Commissions | ✅ operational estimates only (#12) | never payroll/tax/payout — do not claim otherwise |
| Marketplace discovery | ✅ (#19) | |
| Booking distribution links / QR | ✅ (#21); deep-link-to-app needs OA-5 | links work as web URLs today |
| Desktop/web business dashboard | ✅ V1 (#22) | 9/13 workflows end-to-end; quote/invoice create, team admin, report detail deferred — do not claim full web parity |

**Claims to avoid until the matching owner action is done:** "AI answers your
messages automatically" (OA-3), "tap a booking link to open the app" (OA-5),
"manage everything from your browser" (web deferrals).

## 17. Rollback / recovery plan — Engineering ✅

`docs/INCIDENT_RECOVERY.md` (SEV ladder + runbooks), `docs/BACKUP_AND_RECOVERY.md`
(snapshots + PITR + pre-deploy dump + RPO/RTO + restore drill),
`docs/PRODUCTION_HARDENING.md` (worker / dispatch / pool runbooks), and the
deployment checkpoint's step-by-step "if step 2 fails" section. Additive-only
migrations mean an API rollback never requires a schema rollback.

## 18. Physical-device QA — Owner

Execute `docs/RELEASE_QA_MATRIX.md`. Release gate: all P0 on all platforms, all
P1 on ≥1 iOS + ≥1 Android, no open P0/P1.

---

## Summary

| # | Requirement | Engineering | Owner |
|---|---|---|---|
| 1 | Migrations deployed & verified | audited + rehearsed | **OA-1** apply to prod; **OA-7** DB params |
| 2 | Prod env/config audit | ✅ | enable `TRUST_PROXY` |
| 3 | Android local release build | build-ready | run + sign |
| 4 | iOS EAS/TestFlight | build-ready | run + submit |
| 5 | `expo install --check` | ✅ clean | — |
| 6 | Native permission audit | ✅ inventoried | declarations |
| 7 | No unintended AD_ID | note | verify merged manifest |
| 8–9 | Data Safety / App Privacy | ✅ inventory | **OA-2** declare |
| 10 | Live Location disclosure | ✅ code | **OA-2** declare |
| 11 | Privacy policy | inventory | **OA-2** publish text |
| 12 | Account deletion flow/URL | ✅ (+ domain fix) | enter URL in consoles |
| 13 | Reviewer credentials | seed + matrix | provide to stores |
| 14 | Screenshots/metadata | — | produce, keep accurate |
| 15 | Crash-free launch / smoke | ✅ automated | device smoke |
| 16 | Feature ↔ declaration | ✅ reconciled | honour the "avoid" list |
| 17 | Rollback/recovery plan | ✅ | — |
| 18 | Physical-device QA | matrix ready | **execute** |

**Engineering is release-ready up to the owner boundary.** No engineering P0/P1
open. The remaining gates are deployment, store-console, signing-identity and
physical-device actions.
