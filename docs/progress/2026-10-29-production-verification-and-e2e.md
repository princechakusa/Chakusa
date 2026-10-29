# Production verification after 6aa5a9e, mobile unit tests, and the finished mobile e2e suite

**Status:** complete. Handoff `docs/HANDOFF_PRODUCTION_READINESS.md` §3 items 1–3 are done. No new mobile build (the owner has not asked for one).

## 1. Production verification (2026-10-29, after the push of `b6ae9b0`)

- **Render:** deploys for `6aa5a9e` and `b6ae9b0` are live. The `6aa5a9e` deploy log shows `Applying migration 20261029120000_starter_plan`, `Applying migration 20261029160000_user_age_confirmation`, "All migrations have been successfully applied".
- **API:** `GET /health` 200. Public `GET /plans` returns FREE / STARTER ($3, 7-day trial) / PRO ($8) / BUSINESS ($13) with limits and features. `GET /app-config` has the `pricing` block (`USD`, 3/8/13, trial 7/0/0).
- **18+ enforcement:** `POST /auth/register` without `ageConfirmed` returns 400 `VALIDATION_ERROR` with "You must be 18 or older to create a Chakusa account". No account is created.
- **Website:** `https://chakusarecovery.com/pricing/` shows $3 / $8 / $13 with the live `data-cfg-price` / `data-cfg-trial-*` hooks.
- **Auth gateway:** the new gateway is deployed. `POST https://auth.chakusarecovery.com/v1/register` without the tick returns 400 `AGE_CONFIRMATION_REQUIRED` before the Turnstile check, which only the new worker does.
- **Not done by the agent:** a real website sign-up *with* the tick. It needs a human Turnstile solve and creates a production account, so it stays with the owner (handoff §1.1).

Note: `/app-config` still reports `features.outboundMessaging: true` because `META_WHATSAPP_ENABLED=true` on Render. Turn it off before store review (OA-21).

## 2. Mobile unit tests

`npx tsc --noEmit` clean. `vitest`: 66 files, 613/613, both before and after the changes below.

## 3. Mobile e2e suite: 26/26

Run against a local stack: a throwaway Postgres container (`chakusa-e2e-run-pg`, 127.0.0.1:5436, migrated and seeded per `mobile/e2e/README.md`), the test API on 4100, and the static web build on 8091. The shared `chakusa_test` DB was not touched.

- `01-welcome-and-motion.spec.ts`: 6/6, rewritten for the current welcome screen. The old screen's entrance animation, rotating tagline and spring no longer exist. The spec now checks the copy, the cards' accessible names, press feedback, reduce-motion, the font-failure fallback, and card → sign-in → back → experience switch.
- `02-business-and-customer-journey.spec.ts`: 19/19 (was 16/19).
- `watch-email-login.spec.ts`: 1/1.

### App fixes (real accessibility bugs the suite found)

- **Booking availability:** the remove-blocked-time button had no accessible name. It is now `Remove blocked time: <reason>`. This was the "Remove" failure. The spec now uses that name.
- **Services:** the archive button had no accessible name. It is now `Archive <service name>`.
- **Icon glyphs:** new `mobile/src/components/icons.tsx` wraps `Ionicons` and `MaterialIcons` with `aria-hidden` / `accessibilityElementsHidden` / `importantForAccessibility="no-hide-descendants"` (the pattern `businessKit.tsx` already used). All 51 files that imported them from `@expo/vector-icons` now import the wrapper, so icon-font glyphs no longer leak into button names on web or get read out by screen readers. `glyphMap` is kept for the icon-name types. The journey's accessibility audit now reports no unnamed buttons. It reported one before (More › Services).

## Security / tenant model

No backend, authorization or data change.

## Unresolved / notes

- Old local processes from an earlier session are still running: the test API on port 4000 and `e2e:serve` on 8081, both against the shared `chakusa_test` DB. Stopping them was refused by the agent's permission policy. **Stop them before the next full backend test run** (see handoff "Local environment notes"), otherwise `business-team.test.ts` flakes.
- The e2e container `chakusa-e2e-run-pg` and the e2e API (4100) and web server (8091) were left running for reuse. Remove them with `docker rm -f chakusa-e2e-run-pg` when done.

## Next

Handoff §3 item 4: production hardening checks (rate limits on new public routes, CORS/admin origin on Render, Sentry, Render plan).
