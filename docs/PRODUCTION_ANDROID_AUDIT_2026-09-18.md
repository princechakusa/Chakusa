# Chakusa production Android audit

Audit date: 2026-09-18 (Asia/Dubai)

## A. Project identity

- Repository root: `C:\Projects\Chakusa`
- Mobile project: `C:\Projects\Chakusa\mobile`
- App name: `CHAKUSA`
- Android application ID: `com.chakusa.mobile`
- Version name: `1.0.0`
- Version code: `1`
- Expo SDK: `57.0.21` (`sdkVersion` resolves to `57.0.0`)
- React Native: `0.86.3`
- React: `19.2.3`
- Android SDK: min 24, compile 36, target 36, build tools 36.0.0
- Build system: Expo prebuild/native Android Gradle, Gradle 9.3.1. The requested release path is local Gradle, not EAS Build.
- Git branch: `master`
- Audited HEAD: `6e591f4129bad7d4a78ec7c728255f966e45f204`

## B. Audit results

| Area | Result | Evidence / remaining work |
| --- | --- | --- |
| App configuration | PASS | App name, package, scheme, version, SDK versions, icons, and production API are internally resolvable. |
| Android SDK/toolchain | PASS | Local Gradle `help` configured successfully with SDK 36, min SDK 24, NDK 27.1.12297006, Kotlin 2.1.20, and the custom call-detection module. |
| Android signing | BLOCKED | The local release build is signed with `debug.keystore`. No production/upload keystore exists in the repository. |
| Versioning | BLOCKED | `versionName=1.0.0`, `versionCode=1` are consistent, but code 1 must be confirmed unused in Play Console before release. |
| Production API/public URLs | PASS | API `/health` and `/health/ready`, privacy, terms, and deletion pages returned HTTP 200 on 2026-09-18. |
| TypeScript | PASS | Backend and mobile typechecks pass after the small fixes listed below. |
| Mobile unit tests | PASS | 52 files, 519 tests passed. |
| Backend integration tests | BLOCKED | Test safety correctly refuses to run without a local `chakusa_test` PostgreSQL `DATABASE_URL`; Docker Desktop was not running. No production database was touched. |
| Lint | PASS with warnings | Backend: 0 errors/2 warnings. Mobile: 0 errors/21 unused-code warnings after fixing six lint errors. |
| Repository secret scan | PASS | 1,328 tracked files checked; no forbidden secret/key files tracked. No service-role or private client secret was found in the mobile bundle. |
| Dependency compatibility | PASS | Expo's SDK 57 dependency check reports compatible installed versions. |
| Dependency advisories | BLOCKED for review | Root production audit: 0 vulnerabilities. Mobile audit: 16 moderate, 0 high, 0 critical. Concrete chains include `query-string -> decode-uri-component` and Expo build tooling `xcode -> uuid`; npm's proposed automatic fixes incorrectly downgrade Expo and must not be applied blindly. |
| Authentication/session handling | PASS | Business/customer token stores are separated and use SecureStore on native. Refresh tokens rotate; server checks session scope, revocation, expiry, and account state. |
| Authorization/tenant isolation | PASS | Business identity and role are resolved server-side; reviewed routes pass the trusted `businessId` and capability checks. Customer routes use a distinct customer-scoped guard. |
| Account deletion | PASS | Business deletion supports password/Google/Apple reauthentication. Customer closure marks the profile deleted and revokes customer sessions. Public deletion instructions are reachable. |
| Location | PASS | Foreground-only permission and polling; cleanup stops sharing and the server independently expires shares. No background location permission is configured. |
| Call detection permissions | BLOCKED for Play review | `READ_PHONE_STATE`, `READ_CONTACTS`, and the call-screening role are intentional, user-triggered features, but Play Console declarations/prominent disclosure and policy eligibility must be completed. |
| Notifications | BLOCKED | Expo notification code exists, but Android FCM production credentials/configuration were not found. Decide whether push is required for this release and supply FCM setup if it is. |
| Billing/IAP | BLOCKED | Production EAS values enable billing but define only Apple product IDs. Android Google Play product IDs and backend Play service-account/RTDN configuration are absent. The environment guide instead says billing is disabled. |
| Google Sign-In | BLOCKED | Two different Web OAuth client IDs are documented. The release keystore SHA-1/SHA-256 must be registered for `com.chakusa.mobile`, and one approved Web client ID must be selected. |
| Crash reporting | BLOCKED for decision | Sentry is coded with PII scrubbing, but the release configuration disables uploads and provides no public DSN/enabled flag. Confirm whether production monitoring is required. |
| AAB | BLOCKED | Not built. The audit gate correctly stops before producing a debug-signed or incompletely configured bundle. |

The follow-up full-PC credential/tool search and next-build handoff are recorded in `docs/ANDROID_LOCAL_AAB_HANDOFF.md`. No production/upload keystore exists on this PC; only two Android debug keystores were found.

## C. Verified fixes applied

1. **Mobile lint errors (low severity).** Six screen loaders used conditional expressions only for side effects. Replaced them with explicit `if/else` statements in `AiReceptionistScreen.tsx`, `CalendarScreen.tsx`, `CommissionsScreen.tsx`, `DispatchScreen.tsx`, `InventoryScreen.tsx`, and `MessagesInboxScreen.tsx`. Mobile lint now has zero errors.
2. **Backend TypeScript errors (low severity).** `scripts/seed-qa.ts` indexed fixed-size result arrays without proving the entries exist under strict TypeScript settings. Added non-null assertions at the known indices. Backend typecheck now passes.
3. **Sentry test fixture mismatch (low severity).** `tests/sentry.test.ts` omitted the newly required Fastify request ID. Added a synthetic request ID. Backend typecheck now passes.

No dependency was added or upgraded. No backend architecture, database, credentials, signing key, or production service was changed.

## D. Items to provide before local AAB setup

1. Confirm whether this is a brand-new Play Console application. If it is existing, provide the original upload keystore; a replacement key cannot update an existing app unless Play App Signing key reset procedures are used.
2. Confirm whether version code `1` has ever been uploaded. Provide the next required version code if it has.
3. Choose the release feature scope:
   - Google Play subscriptions enabled: provide the Pro and Business subscription product IDs and complete backend Google Play service-account plus RTDN configuration.
   - Subscriptions disabled: approve `EXPO_PUBLIC_BILLING_ENABLED=false` for this Android release.
   - Push enabled: provide/configure the Firebase Android app for `com.chakusa.mobile`, FCM credentials, and the required Android config.
   - Push disabled: approve shipping without remote push registration.
4. Confirm the correct Google Web OAuth client ID. After the upload keystore is created, register its SHA-1 and SHA-256 against Android package `com.chakusa.mobile`.
5. Confirm whether Sentry production crash reporting should be enabled; if yes, provide the public DSN and build-upload organization/project/token through local environment/secrets, never Git.
6. Provide or start a local PostgreSQL test database named exactly `chakusa_test` so the guarded backend integration suite can run.
7. Complete Play Console policy declarations for foreground location, phone state, contacts, call-screening role, notifications, billing (if enabled), Data Safety, privacy policy, and account deletion.

## E. Local release setup to perform after inputs arrive

- Generate a new upload keystore only if this is a new Play application and no prior key exists.
- Store the keystore outside Git and configure Gradle through local environment/Gradle user properties; do not put passwords in repository files.
- Replace the release variant's debug signing configuration with the upload signing configuration.
- Resolve the production environment contradictions in `mobile/eas.json` and `mobile/PRODUCTION_ENVIRONMENT.md` even though EAS Build will not be used, so there is one authoritative release configuration.
- Run the backend integration suite against the guarded local test database.
- Run mobile typecheck/tests/lint, backend typecheck/lint/tests/security scan, Gradle validation, then `bundleRelease` locally.
- Inspect the resulting AAB metadata and signing certificate before delivery.

## F. Git/build hygiene

- Generated/ignored directories present: root/mobile/admin/website `node_modules`, root/admin/website `dist`, `mobile/.expo`, `mobile/android`, `mobile/dist-release-check*`, native module `build`, and Gradle caches/build output.
- These generated directories must remain uncommitted. The checked-in source of the custom native module under `mobile/modules/chakusa-call-detection/android/src` is intentional.
- No commit or push was performed.

## G. Exact verification performed

- `npm.cmd run typecheck` (backend): PASS after fixes.
- `npm.cmd run lint` (backend): PASS, 2 warnings.
- `npm.cmd run security:repository`: PASS, 1,328 tracked files.
- `npm.cmd run typecheck` (mobile): PASS.
- `npm.cmd test` (mobile): PASS, 52 files / 519 tests.
- ESLint (mobile): PASS, 0 errors / 21 warnings after fixes.
- `npx expo install --check` equivalent in offline mode: dependencies reported up to date.
- `npm audit --omit=dev` (root): 0 vulnerabilities.
- `npm audit --omit=dev` (mobile): 16 moderate, 0 high, 0 critical.
- Local Gradle `help --no-daemon`: PASS; Gradle configuration completed successfully.
- Backend `npm test`: safely blocked before tests because `DATABASE_URL` was unset.
- Production API and public URL reachability: all five checked endpoints returned HTTP 200.
