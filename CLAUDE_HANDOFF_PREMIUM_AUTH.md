# Claude handoff — finish premium login and signup

Updated 19 October 2026. Workspace: C:/Projects/Chakusa.

## Owner request and scope

The owner approved the premium welcome page: “I like it its beautiful keep this design and lock it.” They then requested matching premium pages after welcome and clarified that real login AND signup must be visible, rather than only “Continue with Google”. Finish this work in the connected Android phone using Expo Go. The old security-scanner work was explicitly set aside for this UI/startup task; do not resume it in place of this request.

## Approved design — preserve

Commit 4c07945 locks mobile/src/experience/ExperienceSelectScreen.tsx and docs/progress/2026-10-19-approved-welcome.md. Its normalized-LF SHA-256 is e604f090f6bf26ca2ab439b5442beaaf7d36bff0f0c3524d67bdde0c18cfc392. Do not redesign this approved page or change shared theme tokens that would change its appearance.

Palette: ivory #F6F4EF, deep green #182F2D / #244638, pale sage, restrained borders, existing red Chakusa logo. Plus Jakarta Sans with a large italic system-serif second headline line. No decorative red/pink glow, oversized hero animation, fake stats or decorative AI effects.

## What is already implemented

- Both sign-in pages now match the welcome palette and typography, using new mobile/src/experience/AuthEntry.tsx: EntryHeader, EntryIntro, EntryBenefits, entryStyles.
- mobile/src/screens/AuthScreen.tsx and mobile/src/customer/screens/CustomerAuthScreen.tsx reuse their existing real auth handlers; the new design adds a white sign-in card and benefit strip.
- mobile/src/experience/AuthParts.tsx now has green Personal/Business switching, restrained social buttons and green input focus.
- Both customer and business pages were opened on the physical Android phone, including switching between them. The design fits through the legal footer at 720 x 1610 pixels. Smaller screens / keyboard / large text still need the final auth form QA.
- Welcome, business and customer screenshots are in docs/progress/evidence/2026-10-19-welcome/. The customer capture may include a development warning toast; dismiss it before final evidence.

These auth pages are a checkpoint, NOT finished: login/signup fields are still hidden by configuration, and there is no always-visible Sign in / Create account mode selector when email is disabled. Owner explicitly noticed this. Do not describe authentication as completed.

## Root cause of Google-only screen

mobile/eas.json sets EXPO_PUBLIC_EMAIL_ENABLED=false and EXPO_PUBLIC_PASSWORD_RESET_EMAIL_ENABLED=false in every existing profile (development, production, production-internal, customer).

mobile/src/config.ts exports EMAIL_ENABLED and PASSWORD_RESET_EMAIL_ENABLED, but runtime configuration can overwrite them. src/modules/appConfig/appConfig.service.ts defines app.email_auth_enabled with default false and describes: “Offer email + password sign-in and password reset. Only enable once outbound email is configured.” Its public feature is emailAuth. Merely changing eas.json may therefore NOT enable the form.

Backend mail configuration is separate: src/lib/config.ts requires RESEND_API_KEY and EMAIL_FROM in production when EMAIL_ENABLED=true. Check actual outbound-email readiness without printing credentials. Do not blindly enable mail configuration or present a working password-reset flow without verifying it. The owner wants real email auth; no need to ask again whether they want login/signup.

The helper mobile/scripts/eas-env.mjs applies profile environment AFTER shell environment; profile values win. A shell EXPO_PUBLIC_EMAIL_ENABLED=true before this helper does not override its false profile value. For preview, use an explicit appropriate development profile/config and account for runtime config as well. Preserve production readiness checks.

## Recommended final premium auth layout

Keep the approved welcome completely unchanged. On each next page:

1. Existing restrained header/back button and compact Personal / Business experience switch.
2. Current editorial hero, slightly shorter if needed for the full form.
3. White auth card with clearly visible Sign in / Create account tabs. These are account modes, separate from the Personal / Business switch.
4. Sign in: labelled email and password fields, password visibility control, Forgot password?, full-width dark-green Sign in button. A small “New here? Create an account” action may supplement the tabs.
5. Create account: name, email, password; business signup also requires business name as existing logic requires. Show password guidance that matches server validation. Preserve autofill, keyboard type, accessibility labels, busy/error states and duplicate-submit protection.
6. Separator “or continue with”, then existing genuine Google / Apple provider controls where available. Social sign-in is an alternative, not the only visible account path.
7. Small legal links and privacy reassurance. Keep benefit strip only if spacing allows; reduce it before shrinking form controls. Use scroll and keyboard avoidance rather than clipping on Android.

Reuse AuthInput, SocialButtons, AuthError and existing contexts/endpoints. Do not create duplicate auth APIs or mix customer and business sessions. Do not claim end-to-end success with mocked responses.

## Existing real routes and handlers

Business: mobile/src/state/AuthContext.tsx; mobile/src/services/endpoints.ts; backend src/modules/auth/auth.routes.ts. Routes /auth/login, /auth/register, /auth/forgot-password and existing reset flow. UI modes login / register.

Customer: mobile/src/customer/CustomerAuthContext.tsx; mobile/src/customer/endpoints.ts; backend src/modules/customerAuth/customerAuth.routes.ts. Routes /customer/auth/login, /customer/auth/register, /customer/auth/forgot-password. UI modes sign-in / sign-up. Use customer/endpoints.ts, not the older similarly named customer export in services/endpoints.ts.

Check required legal acceptance, invitation handling, onboarding completion, refresh/session isolation, rate limits and validation. Retain authoritative server checks.

## Expo Go and connected phone

The phone is authorized through ADB; Expo Go 57.0.9 is installed. Do not publish the device serial. Do not uninstall the standalone Chakusa app or clear user data. Preview URL exp://127.0.0.1:8081, connected using adb reverse tcp:8081 tcp:8081.

Metro was started from mobile with production public env, watching enabled, --go --localhost --port 8081 --max-workers 2 and NODE_OPTIONS including --dns-result-order=ipv4first (needed for IPv4 USB reverse). EXPO_PUBLIC_BUILD_TARGET must be unset. Log: C:/Users/Surface/.codex/tmp/chakusa-expo-live.log (PowerShell redirection may make it UTF-16LE). Verify /status before launching; avoid repeated cold restarts while bundling. Initial bundle can be slow on this busy Windows machine.

Google native SDK is absent in Expo Go. Current code guards native imports rather than removing native dependencies. Real Google sign-in, billing and call detection require a Chakusa development/release build. Email auth can be exercised in Expo Go once legitimately enabled. Do not fake provider success or weaken production native features.

Native-import compatibility changes are in services/googleAuth.ts, components/AuthForm.tsx, services/nativeNotifications.ts, services/pushNotifications.ts, customer/push.ts, components/NotificationTapHandler.tsx, state/BillingContext.tsx and modules/chakusa-call-detection/index.ts. App icon was corrected from old PaMarket asset to assets/chakusa-app-icon.png; actual standalone splash config requires a new binary.

## Startup fixes already in working tree — preserve and finish checking

Original owner also reported intermittent “taking you to workspace” hangs. Changes already made: bounded optional router lookups; immediate first selection; deferred synchronous root requires (avoid extra Metro lazy chunk requests); preferences storage error handling and stale-scope guards; storage reads inside auth restore try/catch; 15-second total restore deadline with cancellation and retry error; AbortSignal propagation through both API transports and token refresh; font fallback after 800ms. Keep saved sessions on transient network failures. Existing native switch deferral is retained for Fabric safety; InteractionManager emits a development deprecation toast. Do not suppress all warnings to hide bugs.

Full mobile suite passed 579/579 before the latest visual-only edits and concurrent integrity files. Focused startup/session tests passed 34/34, including stalled-request cancellation without credential deletion. JSON reports: C:/Users/Surface/.codex/tmp/chakusa-welcome-all-tests.json and chakusa-welcome-startup-tests.json. An earlier full typecheck passed. A later final typecheck with incremental cache C:/Users/Surface/.codex/tmp/chakusa-entry.tsbuildinfo was still running at handoff; do not claim final typecheck green until its exit is verified or rerun. Typechecking has been unusually slow on this Windows session; avoid parallel duplicate tsc processes.

## Shared workspace caution

Run git status and inspect diffs before staging. Only approved welcome is committed so far. The auth design, startup changes and screenshot evidence remain in the working tree for continuation. Preserve unrelated changes. At this task baseline docs/RELEASE_QA_MATRIX.md and mobile/plugins/withAndroidSecurity.js were already dirty; mobile/stitch-shots/ and website/.wrangler/ were untracked. Additional app-integrity files and App.tsx imports/gate appeared concurrently (modules/chakusa-app-integrity, domain/appIntegrity*, screens/NotGenuineAppScreen). They are not this design task's work; do not delete, stage or claim them by accident. App.tsx now contains both our startup placeholder/font-wait changes and someone else's integrity changes.

Read CLAUDE.md and mobile/AGENTS.md. Exact Expo57 docs were read for this work; follow the repository's requirement before further code changes. Do not alter Android7–9 support; owner explicitly chose to retain it in earlier security work.

## Completion gate

- Correctly enable and verify email auth with real server configuration and mail-reset readiness.
- Both experiences visibly support Sign in and Create account, with all controls wired and no fake success.
- Test real sign in, signup, validation, duplicate submit, incorrect password, expired session and retry after offline/slow restore using designated test accounts. Avoid creating production test accounts without considering cleanup.
- Verify Android keyboard, scrolling, small viewport and enlarged text; no clipped submit/legal/back controls.
- Check customer/business switching and back to approved welcome. Native Google test belongs in a development build, not Expo Go.
- Run mobile typecheck and relevant auth/session tests; test backend paths if changed. Final git diff --check.
- Save fresh phone evidence, update progress, commit only coherent owned changes. Leave Expo Go open on the finished sign-in page for owner review.
