# Stage #26 — Release Readiness & Store Compliance

**Status:** ENGINEERING COMPLETE up to the owner boundary. No engineering P0/P1
open. Remaining gates are deployment, store-console, signing-identity and
physical-device actions — tracked as **OA-8** (+ OA-1, OA-2, OA-3, OA-5, OA-7).
**Next:** owner executes OA-8; then post-V1 backlog (roadmap §9).

---

## Deliverables

### `docs/RELEASE_READINESS_CHECKLIST.md`
Every one of the 18 #26 requirements with its state (engineering-verified vs
owner-action), a **native permission inventory** (from `app.json` +
`withCallDetection`), a **data-collection inventory** for the store declarations,
and a **feature ↔ declaration reconciliation** table with an explicit "claims to
avoid until the matching owner action is done" list (AI auto-answer → OA-3;
deep-link-to-app → OA-5; full web parity → #22 deferrals).

## Engineering work done in #26

### P1 fix — wrong domain in user-facing links
The in-app **Support** and **Delete-Account** screens, the **public
business-profile share URL**, and the **team-invite link** pointed at
`chakusa.com` / `support@chakusa.com` while the real production domain is
`chakusarecovery.com` (server `PUBLIC_REVIEW_BASE_URL`, the website deploy, the
auth gateway). A store reviewer following the shown account-deletion URL would
hit a dead domain — a rejection risk.

Fix: a single `PUBLIC_WEB_ORIGIN` constant in `mobile/src/domain/trustSettings.ts`;
`APPROVED_PUBLIC_DESTINATIONS` and the four call sites now derive from it.
`fix(mobile): correct wrong domain in user-facing links`. Mobile tsc clean;
519/519.

### `expo install --check` → clean
`expo install --fix` aligned 5 Expo SDK 57 packages (`expo` 57.0.18→57.0.21,
`expo-dev-client`, `expo-linking`, `expo-notifications`, `expo-secure-store`) to
the versions the SDK expects. `expo install --check` now says "Dependencies are up
to date". Patch-level within the minor; mobile tsc + 519 tests green.
`chore(mobile): expo install --fix`.

### Audits run
- **Native permissions:** foreground-only location (all background flags false,
  no `ACCESS_BACKGROUND_LOCATION` / `FOREGROUND_SERVICE_LOCATION`),
  `ITSAppUsesNonExemptEncryption: false`, Apple Sign-In configured. The
  `withCallDetection` plugin adds `READ_PHONE_STATE` + `READ_CONTACTS` (Android
  call-screening) — flagged for a Play Permissions Declaration (contacts are never
  read; Telecom only checks the permission's presence).
- **AD_ID:** none configured; the merged-manifest check is an owner step
  (post-`expo prebuild`).
- **Account deletion:** in-app (re-auth required, verified #24) + public URL
  (`/delete-account` Astro page). Domain fixed above.
- **Config:** `config.ts` boot validation covers every required prod secret;
  `TRUST_PROXY` must be enabled in prod (owner).
- **Dependencies:** backend runtime `npm audit` = 0 (#24). Mobile `npm audit`
  ~20 moderate — all Expo **build-time** tooling, not in the app bundle; tracked
  for the next SDK bump, not a blocker.

## Verification

- Backend `tsc --noEmit` + `tsc -p tsconfig.test.json` — clean.
- Mobile `tsc --noEmit` — clean; **519/519** mobile unit tests (twice: after the
  domain fix and after `expo install --fix`).
- Web: `astro check` (310) + `astro build` (76 pages) clean; gateway `node --test`
  12/12; `tests/web-capabilities.test.ts` 4/4.
- `npm run seed:qa` produces a full no-secrets QA dataset (#25).

## Commits

- `fix(mobile): correct wrong domain in user-facing links — chakusarecovery.com`
- `chore(mobile): expo install --fix — align 5 Expo SDK 57 packages`
- `docs: #26 Release Readiness checklist + OA-8` (this)

## Owner actions

**OA-8** (new, release-blocking) collects the deployment / store / signing /
device gates. Also live: OA-1 (migration deploy), OA-2 (store privacy
declarations, now extended for call-screening), OA-3 (AI provider config), OA-5
(app-link identifiers), OA-7 (DB pool params).

## Release statement

Engineering is release-ready to the owner boundary. Per the roadmap rule, **no
V1 release declaration should claim a feature or control the shipped app does not
implement** — the reconciliation table and the "claims to avoid" list in
`RELEASE_READINESS_CHECKLIST.md` §16 are the authority for store/marketing copy.

## Next

Owner executes OA-8. Post-V1 backlog (roadmap §9) is not started — it "must not
destabilize V1" and runs only after #26 clears.
