# Handoff: what is left before Chakusa is production-ready (2026-10-29, evening)

Read `CLAUDE.md` first, then this file, then `docs/OWNER_ACTIONS.md` (OA-18 to OA-23) and
`docs/progress/2026-10-29-starter-plan-pricing-insights.md`.

## Standing rules (from the owner)

- **No new iOS or Android build** until the owner says so.
- iOS builds go through EAS with `--auto-submit` to TestFlight (`npm run ios:release` in `mobile/`).
- Android is built **locally in PowerShell only**, never EAS, and never at the same time as an iOS upload
  (the EAS upload fails with `EBUSY` on `android/.gradle`). The upload key lives in the second Windows
  profile: `C:\Users\Dev Prince\.chakusa\android\`. The EAS CLI is under
  `C:\Users\Dev Prince\AppData\Roaming\npm\`.
- If a build fails, fix it and rebuild until there is a verified artifact.
- Never commit or paste secrets. Commit and push only when the work is verified.
- Pushing to `master` deploys production: Render (API, runs `prisma migrate deploy`) and Cloudflare
  Pages (website). The auth gateway (`cloudflare/auth-gateway`) is **not** deployed by a push; the owner
  runs `npx wrangler deploy`. Auto mode has refused it for agents.

## State at handoff

Last commit: `6aa5a9e` on `master` (pushed). It contains:

- Plans Starter $3 (7-day trial) / Pro $8 / Business $13. Prices and trial days come from admin App
  configuration (`/app-config`, public `GET /plans`). The apps charge and show the store's own price.
- New Subscription screen and Business Insights redesign. Website pricing is driven by the API.
- Subscription hardening: every limit and feature check uses `resolveSubscription()`
  (`src/lib/entitlements.ts`). Lapsed (EXPIRED/CANCELED) or stale store periods count as FREE.
  Duplicate store product IDs fail closed.
- `/app-config` → `features.outboundMessaging`: false when no SMS/WhatsApp sender is configured. The
  apps then "prepare" messages instead of sending them.
- 18+ for everyone: the API refuses to create any account without `ageConfirmed: true`
  (`users.age_confirmed_at`). Terms acceptance requires and records it. Every app and website
  sign-in/sign-up form has a required tick, and the gateway enforces it.
- Sign out asks: this device / all devices / stay signed in (business and customer).
- Address search runs only on request (Nominatim policy). Decorative icons are hidden from screen readers.

Verification at `6aa5a9e`:

- Backend: 1,819/1,819 tests, typecheck and lint clean.
- Mobile: 613/613 unit tests (not re-run after the final icon accessibility change; re-run first).
- Website: `npm run build` with 0 errors and 0 warnings.
- Gateway: 45/45 tests.
- Mobile e2e in Chrome: 16/19 journey tests pass.

## 1. Urgent, owner only (blocks production)

1. **Deploy the auth gateway now.** Website sign-up and sign-in fail until it is deployed, because the
   new API needs the 18+ confirmation and only the new gateway sends it:
   `cd cloudflare/auth-gateway; Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue; npx wrangler deploy`.
   Then confirm a website sign-up works.
2. **Admin console → Legal:** publish new Terms of Service and Privacy Policy versions from the updated
   18+ default text (`src/modules/legal/defaultLegalDocuments.ts`), with re-acceptance required (OA-22).
3. **Rotate** the Meta WhatsApp verify token and the PaMarket token that were pasted into chat (OA-19).

## 2. Owner store-console work (needed before submitting builds)

These were not done: the Claude Chrome extension never connected. An agent may do them only if the
owner logs in and the extension is connected (check with `list_connected_browsers`).

- **App Store Connect (OA-18):**
  - Create the Starter subscription `com.chakusa.mobile.starter.monthly` at the lowest level of the group.
  - Set base prices Starter $3, Pro $8, Business $13 (Apple rounds to $2.99 / $7.99 / $12.99; mirror the
    rounded values in admin App configuration).
  - Add a 7-day free introductory offer on Starter.
  - Fill in the review metadata.
- **Google Play Console (OA-18):**
  - Create the Starter subscription with a monthly base plan, and set the same prices.
  - Add a 7-day free-trial offer on Starter, for new customers only.
  - **Send the Google product IDs.** They are not in `mobile/eas.json`
    (`EXPO_PUBLIC_GOOGLE_STARTER/PRO/BUSINESS_MONTHLY_PRODUCT_ID`), so Android purchases are off until
    they are added.
- **Render env:**
  - `APPLE_STARTER_MONTHLY_PRODUCT_ID=com.chakusa.mobile.starter.monthly`.
  - `GOOGLE_*_MONTHLY_PRODUCT_ID` values once known. Each product ID must be different.
- **Store declarations (OA-22):**
  - Apple age-rating questionnaire, answered honestly (customer↔business messaging, marketplace).
  - Play Target audience: 18+ only.
  - Play Data safety and Apple App Privacy must match what the app really collects (location
    foreground-only, phone number, photos).
- **Before review (OA-21):**
  - Set `META_WHATSAPP_ENABLED=false` on Render until a real WhatsApp number is registered, so reviewers
    see "Prepare message" instead of failed sends.
  - Add reviewer notes and the demo login in both consoles.
- **Before public sale (OA-20):** set `APPLE_STORE_ENVIRONMENT=PRODUCTION` on Render. Until then, sandbox
  (TestFlight / license-tester) purchases unlock plans and real purchases are refused. Mind Apple App
  Review, which buys in sandbox.

## 3. Engineering work left (agent)

In order:

1. **Verify production after the push.**
   - Render deploy succeeded and both migrations applied (`20261029120000_starter_plan`,
     `20261029160000_user_age_confirmation`).
   - Public `GET /plans` and `/app-config` return the pricing block.
   - Website `/pricing` shows $3/$8/$13 and the 7-day trial.
   - After the owner deploys the gateway, a website sign-up with the 18+ tick works and one without it
     is refused.
2. **Re-run mobile unit tests** (`cd mobile; npx tsc --noEmit; npx vitest run --config vitest.config.mjs`).
3. **Finish the mobile e2e suite** (`mobile/e2e`). Run against a local stack; see `mobile/e2e/README.md`.
   - Use ports other than 4000/8081 if old processes hold them. Last session used API 4100 + web 8091,
     building with `E2E_API_URL=http://localhost:4100 node e2e/build-web.mjs` and serving with
     `node e2e/serve-web.mjs 8091`.
   - Run with `E2E_BASE_URL=http://localhost:8091 npx playwright test -c e2e/playwright.config.ts`.
   - Journey spec: 16/19 pass. Next failure is "business blocks time off and removes the block" (a
     `Remove` button). The last 2 tests have not run yet. Fix spec drift; fix the app only for real bugs.
   - `01-welcome-and-motion.spec.ts` still describes the old welcome screen; rewrite it for the current one.
   - Known remaining accessibility issue: `Ionicons` glyphs (customer screens, auth parts) can leak into
     button names, like the `MaterialIcons` fix in `businessKit.tsx`. Hide them from accessibility the
     same way.
4. **Production hardening checks (roadmap #23–#24)** not yet re-verified for this release:
   - Rate limits on the new public routes (`/plans` has 120/min).
   - `CORS_ALLOWED_ORIGINS` and `ADMIN_CONSOLE_ORIGIN` on Render.
   - Sentry on.
   - The Render plan: the free instance sleeps, so WhatsApp webhooks and the first request after idle
     are slow. Recommend an always-on plan for launch (owner cost decision).
5. **Map tiles (OA-23, owner decision):** the public OpenStreetMap tile server is for light use only.
   After the owner picks a provider, change the one tile URL in `mobile/src/components/map/leafletHtml.ts`.
6. **Builds (only when the owner says go):**
   - iOS: bump `expo.ios.buildNumber` to 12 in `mobile/app.json`, commit, run `npm run ios:release`
     (EAS + auto-submit).
   - Then Android: bump `expo.android.versionCode` to 11 in `mobile/app.json` **and** in the git-ignored
     `mobile/android/app/build.gradle`. Build locally with the upload key (`npm run android:bundle-release`
     with the `CHAKUSA_UPLOAD_*` env set in a script; never print the password). Check with
     `jarsigner -verify` and the vc10 signer SHA-256, then copy the AAB to `builds\android\` and the
     owner's `.chakusa\android\`.
   - App builds older than `6aa5a9e` (iOS 11, Android vc10) cannot create new accounts (no 18+ field);
     existing accounts still work. After the new builds are live, consider setting
     `app.min_supported_version` in admin.
7. **Final release gate (roadmap #25–#26):**
   - Physical-device QA on iPhone and Android: purchase Starter with its trial, upgrade, downgrade,
     restore, cancel then confirm Free limits apply, 18+ tick, sign out choices, maps and directions,
     booking.
   - Privacy policy matches actual data use.
   - Account deletion works.
   - Rollback plan.

## Local environment notes

- Test DB: Docker container `chakusa-test-pg` at `postgresql://postgres:test@127.0.0.1:55432/chakusa_test`.
  Set both `DATABASE_URL` and `DIRECT_URL`, run `npx prisma migrate deploy`, then `npx vitest run`
  (about 20–30 min).
- **Never run two vitest runs against the same DB at once.** They reset each other's data. A stopped
  background run can leave orphaned `vitest` node processes; kill the whole tree (`taskkill /T /F`).
- `npx prisma generate` can fail with EPERM while an API process holds the engine DLL. The types still
  regenerate; stop the API to clear it.
- Many files use CRLF. Script edits must keep the line endings.
- Mobile has no `lint` script; the root `npm run lint` covers `src tests scripts`.
