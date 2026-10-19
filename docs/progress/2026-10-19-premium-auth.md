# Premium sign-in and sign-up — 2026-10-19

**Status:** Implemented and verified on the Android test phone (Expo Go against production API). Self-service password reset waits on outbound email (OA-15).

## Baseline inspected
- Handoff `CLAUDE_HANDOFF_PREMIUM_AUTH.md` (Codex): both auth pages restyled, but the email form was hidden because `/app-config` `features.emailAuth` was `false` in production and overrode the build env.
- Backend: `/auth/login`, `/auth/register`, `/customer/auth/login`, `/customer/auth/register` never depended on that flag or on outbound mail. Customer email verification is not enforced anywhere. Only reset (and verification) email needs `RESEND_API_KEY` + `EMAIL_FROM`.

## Architecture reused
`AuthContext` / `CustomerAuthContext` handlers, `AuthInput`, `SocialButtons`, `AuthError`, `ForgotPasswordScreen` (already handles "reset unavailable"), runtime config merge in `domain/runtimeConfig.ts`. No new auth API, no mixing of business and customer sessions.

## Implementation
- **Layout (both experiences):** header, Personal/Business switch, compact editorial hero, white card containing **Sign in / Create account** tabs (`AuthModeTabs`), labelled fields, password visibility toggle, *Forgot password?*, full-width dark-green primary button, "or continue with", then Google/Apple. Benefit strip moved below the card; legal links and security note last. Scroll and keyboard avoidance throughout.
- **Create account:** name (+ business name for business), email, password with "Use at least 8 characters" — mirrors the server's zod rules via the tested `emailPasswordProblem()`.
- **Duplicate submit:** ref-based in-flight guard (a second tap before re-render is ignored), fields disabled while busy.
- **Autofill:** `autoComplete`/`textContentType` for name, organisation, email, current/new password (Android password manager offered to save on device).
- **Google mark:** official four-colour "G" (Google branding guidelines) as `assets/google-g.png` @1x/2x/3x; no new native dependency.
- **Password reset truthfulness:** new public `features.passwordReset` = admin switch `app.email_auth_enabled` (relabelled "Password reset email") **AND** `RESEND_API_KEY` + `EMAIL_FROM` configured. Older servers fall back to `emailAuth`. When unavailable, customer reset shows a support-contact message and business reset opens the existing support-contact screen — no fake "email sent".
- Startup resilience and Expo Go compatibility changes from the handoff (bounded restore, abortable requests, guarded native imports, app icon/splash) are included unchanged.

## Authorization / tenant / security
Client validation is advisory only; the server validates every request. Runtime config cannot grant anything. Business and customer flows keep separate contexts, endpoints and session stores. No credentials logged or committed.

## Migrations
None.

## Tests
- Mobile: `tsc --noEmit` exit 0; full suite **584/584** passed (new validator and runtime-config tests included).
- Backend: `tsc -p tsconfig.test.json` exit 0. New `tests/app-config.test.ts` case (reset offered only with switch + mail) **not run** — Docker's engine returned 500, so the local `chakusa_test` Postgres was unavailable.
- Device (Android, 720×1610, Expo Go, production API): customer and business pages render; tab switching; empty-submit validation; wrong password returns the server's "Invalid email or password"; Forgot password shows the support message; Personal ↔ Business switch; welcome screen unchanged. Evidence: `evidence/2026-10-19-welcome/business-auth-signin-form-android.png`.

## Unresolved
- Real successful sign-in/sign-up with a designated test account not run (no test credentials; avoided creating production accounts).
- Enlarged text (font scale 1.3) and small-viewport checks not completed: changing font scale restarts Expo Go. Physical-device QA remains a release gate.
- Native Google sign-in needs a development/release build, not Expo Go.

## Owner actions
OA-15 — configure Resend + `EMAIL_FROM` on Render and enable "Password reset email".

## Next
Backend app-config test once Docker is healthy; release-build device QA of auth.
