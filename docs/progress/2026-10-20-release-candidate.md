# 2026-10-20 — Release candidate 1.0.0 (iOS build 9, Android versionCode 3)

**Status:** Builds produced. Auth-gateway deploy pending (owner runs `wrangler deploy`; auto mode blocks it for the agent).

## Verified
- Backend: typecheck clean; lint 0 errors (3 warnings); **1736/1736 tests, 144 files** on a fresh guarded `chakusa_test` database, including all AI suites (receptionist, customer agent, policy engine, providers, memory, prompts, after-hours). An earlier 217-failure run was invalid: two suites ran concurrently against the same test database.
- Mobile: `tsc --noEmit` clean; **600/600** tests. `expo install --fix` applied SDK 57 patch updates.
- Auth gateway: 43/43 tests.
- Production: `/health` 200, `/app-config` 200; privacy, terms, delete-account, help and AI-disclosure pages load (308 → trailing slash → 200).
- Release APK (versionCode 3, upload key 2026-10) on the Android test phone: cold launch to welcome with no crash; business sign-in renders; **Google sign-in end to end** — account picker under "CHAKUSA", ID token verified by the production API, which correctly refused to auto-link Google to an existing password account.

## Store-policy fixes
- Google Play User Data: prominent disclosure (`domain/permissionDisclosure.ts`, tested) shown before the call-screening role, `READ_PHONE_STATE` and `READ_CONTACTS` prompts. States exactly what leaves the device (missed caller's number and time) and that the address book is never read or uploaded.
- Apple: `ios.privacyManifests` required-reason API declarations (UserDefaults, file timestamp, boot time, disk space); no tracking.
- Already in place: in-app account deletion for business and customer accounts, Sign in with Apple alongside Google on iOS, no background location, no camera/microphone permission.

## Builds
- iOS: EAS build `c5686b29-a598-428e-8452-79c63ea9613e`, build 9, auto-submitted to TestFlight.
- Android: `chakusa-v1.0.0-vc3-2026-10-20.aab` in the owner's `.chakusa\android` folder, SHA-256 `990b6c222c1b19ebabde06cbfd3c995aa808117a4851217c9b63b09e751c7007`, `jarsigner -verify` passes.

## Owner actions
- Deploy the auth gateway: `cd cloudflare/auth-gateway; Remove-Item Env:CLOUDFLARE_API_TOKEN; npx wrangler deploy` (the stored API token lacks Workers edit rights; the OAuth login has them).
- Play Console Data safety: declare phone number (missed-call caller) collected for app functionality; contacts permission declared but no contact data collected.
- Open: OA-15 (reset email), OA-16 (Play Integrity), OA-9 (Play app-signing SHA-1 as Android OAuth client — needed for Play-installed builds).

## Not done
- Signed-in flows beyond auth on the release build (no designated test account password).
- iOS device QA happens in TestFlight.
