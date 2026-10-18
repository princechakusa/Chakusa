# Chakusa security validation — 16–17 October 2026

Status: available local validation and final Android static scan completed. Changes are local and have not been deployed. Open findings and unperformed tests remain explicit. This report does not certify the absence of all security defects.

Subsequent dependency patches and the optimized Android candidate are recorded in [18 October follow-up](2026-10-18-security-followup.md). Artifact hashes and scanner results in this report describe the earlier candidate and remain historical evidence.

## Scope and environment

The supplied PaMarket handoff was adapted to Chakusa's Fastify API, PostgreSQL/Prisma tenant model, React administrator console, Astro website/auth gateway and Expo Android app. No PaMarket accounts, credentials, passing results or provider integrations were reused.

Backend regressions use loopback PostgreSQL database `chakusa_test`. HTTP/Postman fixtures use its separate `security_http` schema. Five synthetic business identities cover two independent businesses, full and restricted administrators, and an MFA-required administrator. No customer or production records are used. Optional emails and external delivery integrations remain disabled in the local server.

Raw evidence is private, outside Git, under `C:/Users/Surface/.codex/tmp/chakusa-security/`. It includes scanner exports, artifact hashes, Newman reports and synthetic tokens; do not publish that directory.

## Findings and fixes

| Finding | Evidence and resulting behavior |
| --- | --- |
| Custom JSON parser bypassed Fastify's prototype-poisoning protection | Two malicious JSON cases reached authentication before remediation. The parser now delegates to Fastify's protected parser while preserving exact webhook signature bytes; prototype and constructor poisoning return 400. |
| Missing API security headers and default cache protection | Three baseline header tests failed. Success, unauthorized and missing-route responses now default to no-store, nosniff, frame denial, restrictive API CSP, no-referrer and a permissions policy. Production emits HSTS. Intentionally public routes may explicitly set their own cache policy. |
| Permissive fallback CORS in production | Cross-origin browser access now fails closed when production has no configured allowlist. Native bearer-token clients do not require CORS. Explicit website/admin origins remain supported. |
| Password-reset endpoint lacked its own rate limit | Business password reset now has a 10-request/15-minute limit, matching the bounded customer flow. Login rate-limit regression also checks spoofed forwarded IPs. |
| Private bearer URLs and query credentials could enter request logs | Public review, invoice, quote, team-invite and calendar token segments are redacted. Token, password, API key, signature and OAuth code/state query values are redacted alongside coordinates. |
| Newly required admin MFA could be bypassed by an existing password-only session | Baseline regression returned 200 after enabling `mfaRequired`. Existing access and refresh paths now fail closed with 403. The application still lacks a complete enrollment/challenge workflow; this change does not implement one or weaken the independent Cloudflare Access layer. |
| Explicit hostile Origin accepted on authenticated admin reads | Postman reproduced a 200 with an attacker Origin. The administrator guard now rejects an explicit non-allowlisted Origin; non-browser requests without Origin still need valid administrator authentication. |
| Late administrator requests could restore or overwrite session state | Session revisions prevent stale refresh/login/API responses from restoring a logged-out session, overwriting a new identity, clearing a new identity, or exposing a previous identity's response. Malformed successful refresh payloads fail closed. The React provider also cancels stale initial identity reads. |
| Map labels interpreted as HTML | Leaflet tooltips now receive text nodes. Browser regression renders a hostile image/event-handler string literally with no image element or script execution. Web iframe messages must come from the actual map frame and same origin; unknown message types and out-of-range coordinates are rejected. Native WebView navigation/file/mixed-content/debugging settings are explicit. |
| Android backup, device transfer and unnecessary release overlay permission | Expo configuration/plugin disables backup and cleartext traffic, removes SYSTEM_ALERT_WINDOW from the main manifest, and installs explicit cloud-backup/device-transfer exclusions for app data. Some Android 12+ manufacturers allow D2D transfer despite `allowBackup=false`, so the flag is supplemented with XML rules. Debug variant manifests retain local development settings. See [Android backup behavior](https://developer.android.com/identity/data/autobackup). Signed release artifact verification is recorded below. |
| Expo LogBox could enable process-wide WebView debugging unconditionally | A versioned `patch-package` patch gates the call on the application's `FLAG_DEBUGGABLE`. This preserves developer debugging while preventing the bundled error view from enabling debugging in a non-debuggable release. |
| Deployed website HTTP header gaps | Read-only homepage checks showed nosniff and referrer policy, but no HSTS/CSP/frame protection and wildcard static CORS. Candidate `_headers` adds the protections and removes wildcard CORS. The marketing bootstrap is externalized so script-src does not require unsafe-inline. Google sign-in, Turnstile and the auth gateway have explicit source allowances. Admin static HTML also gains CSP/HSTS/no-store. |
| Dependency advisories had changed since historical audits | Compatible updates fixed root/admin dependencies. Astro upgraded from 5 to 7.4.0; two existing unmatched closing tags were repaired for the stricter compiler. Website CI and its build root select Node 24. Expo stays on SDK 57; UUID is pinned to a patched compatible major, and the existing native linker patch is rebased to the installed Expo modules-core version. |
| Future advisory detection | Repository CI now audits all four dependency trees on pushes, PRs and a weekly schedule. Unpatched mobile findings remain visible and fail the high-severity gate; they are not suppressed. |
| Auth gateway handled HTTP requests before enforcing HTTPS | Two baseline regressions showed HTTP health/logout requests reached normal handling. GET/HEAD now redirect to HTTPS with 308; HTTP writes return 400 before authentication or cookie handling. |

## Verified results

Results below distinguish completed evidence from pending work. Totals overlap and must not be added together.

- HTTP/logging focused regression: 9 passed after five HTTP baseline failures.
- Admin/auth/HTTP focused security regression: 43 passed, including the previously failing MFA-policy case.
- Administrator client session regression: 5 passed.
- Mobile unit suite: 549 passed.
- Candidate website browser suite: 23 passed, including real Leaflet tooltip rendering and CSP canaries. The candidate website built 91 pages.
- Auth gateway: 42 tests passed, including both previously failing HTTP transport cases.
- Initial Burp-proxied Newman execution: 67 requests / 206 assertions, with five failed assertions. Four were incorrect collection paths and were corrected to the existing message/team list routes; one reproduced the explicit hostile admin Origin behavior and led to the guard fix. Those failed assertions are not counted as passes.
- Final direct Newman execution: **67 requests / 206 assertions passed**, with zero request failures. The failed 17 October Burp restart/proxy attempt is retained separately and excluded.
- Final dependency audits: backend **0**, administrator **0**, website **0** advisories; mobile **19 high**, **0 critical**, unresolved as described below.
- Backend build/typecheck pass; lint has **0 errors / 3 existing warnings**. A bounded working-tree content scan of 1,425 tracked UTF-8 files found no matches for selected private-key/AWS/GitHub/live-Stripe/OpenAI credential patterns. This does not cover every secret format or Git history; the repository's existing filename guard is narrower still.
- Read-only deployed HTTP checks: website HTTP root returns 301 to HTTPS; TLS 1.2 and 1.3 establish authenticated handshakes for the website, auth gateway and API. Website `/.env` and `/.git/config` return 404. The API root and `/.env` initially timed out, so those probes are not passes; `/health` later returned 200. The auth gateway denies its unknown unauthenticated paths. This is not an exhaustive TLS/cipher audit.
- The original release AAB completed a MobSF static scan. MobSF's converted APK was reported unsigned; independent `jarsigner -verify` reported that the original AAB's JAR signature verified, with self-signed-chain/timestamp and ZIP-order warnings. This does not establish Play delivery signing.
- Final signed release APK built successfully in 6 minutes 37 seconds. SHA-256: `a61a90b81c313dd81eb60a9943d32a392ab45fb122e6066253c9e3078288aa28`. `apksigner verify --verbose --print-certs` passes; the upload signing certificate SHA-256 is `622d63d4762966a7e53f569665115de0ce2a3914fc51033b47832bf20d0eb17e`.
- Final compiled manifest inspection confirms `allowBackup=false`, `usesCleartextTraffic=false`, minimum SDK 24, target SDK 36 and absence of SYSTEM_ALERT_WINDOW. The manifest references the compiled backup XML resources; inspecting their actual optimized APK paths confirms nine full-backup exclusions and eighteen cloud-backup/device-transfer exclusions. These are artifact checks, not runtime device-transfer tests.
- Expo public/prebuild configuration checks pass. `apkanalyzer manifest debuggable` reports **false** for the final APK.
- Full backend suite: **1,703 tests passed in 141 distinct test files**, with zero failures or skips. Three isolated loopback PostgreSQL 16 databases each received the existing migrations; file execution remained sequential within each shard. Aggregation verifies every `tests/**/*.test.ts` file appears exactly once. Earlier interrupted runs are excluded.

## Final MobSF artifact review

MobSF 4.5.4 completed its static scan of the final signed APK: package `com.chakusa.mobile`, version 1.0.0/code 2, 97,724,620 bytes, scanner MD5 `d2070693e0de7cd9edcd966b14cd5526`; SHA-256 is recorded above. The result is **48/100**, **2 high / 14 warning / 3 info / 1 secure / 1 permission hotspot**. The original AAB conversion scored 45 with three highs; different artifact formats and signing handling mean this is not a controlled score comparison. A scanner score is not a release approval.

| Finding group | Disposition and evidence |
| --- | --- |
| High: support for old Android versions | Open, accepted owner compatibility risk; minimum SDK remains 24. |
| High: remote WebView debugging | Static rule still flags debugging APIs. Decompiled final `ExpoLogBoxWebViewWrapper` gates the call on `(applicationInfo.flags & 2) != 0`; the final APK is non-debuggable. The React Native WebView constructor gates its call on `ReactBuildConfig.DEBUG`, whose final constant is false. The configurable setter still exists; Chakusa's map explicitly disables it. This supports the fix but does not substitute for a connected-device debugging probe. Raw finding is retained. |
| Four warnings for exported services/receivers | Components are permission-protected. Call screening uses the documented system-only binding permission; Google revocation, Firebase messaging and ProfileInstaller retain their individual permission/runtime review requirements. |
| Two WebView warnings | Map input, navigation, file access and message origin were hardened; browser and unit regressions pass. SDK implementations still contain broad capability APIs, so complete native runtime coverage remains open. |
| Hardcoded information and entropy candidates | Scanner detections are retained privately and are not counted as proven credential disclosures. The bounded working-tree credential scan is narrower than APK-wide verification; complete candidate validation remains open. |
| MD5, temporary files, external storage, IP and superuser patterns | Reviewed examples belong to Expo file/asset checksum helpers, image/WebView/Sentry temporary or storage code, Sentry Spotlight and root-check helpers. Their presence alone does not prove exploitable application use. Sensitive-data and runtime reachability review remains open. |
| Trackers, logging, clipboard and permission hotspot | SDK privacy/data-flow review and physical-device verification remain open. No claim of root/debugger resistance or tracker absence is made. |

The three task-owned temporary PostgreSQL containers were removed after aggregation. The fixture server/proxy listeners are stopped; MobSF's temporary CPU limit was restored. Private raw evidence remains outside Git.

## Accepted Android compatibility risk

The owner explicitly chose **keep Android 7–9 support and document the risk** on 16 October. Minimum SDK remains 24. MobSF's old-OS finding remains open as an accepted compatibility risk. No minimum-SDK increase is applied simply to improve a scanner score.

## Remaining advisories and limitations

- Mobile audit still reports 19 high findings through dependency chains, principally `braces` and `node-forge`. The published advisories currently list no patched version. These are not 19 independently demonstrated mobile runtime exploits, and they are not dismissed because they belong to SDK/build tooling. No incompatible Expo/React Native downgrade is used to hide them. See [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) and [node-forge advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv).
- No Android device is connected. Root/debugger resistance, runtime private-data inspection, live certificate interception/pinning behavior, clipboard/screenshots and real push delivery are not established. iOS artifact/device tests are not established.
- Burp Community proxy evidence is not a completed Professional automated vulnerability scan. Desktop Repeater execution is not established. The 17 October desktop helper reported access errors; a subsequent isolated JVM proxy attempt failed during Swing initialization and is excluded from passing evidence.
- Complete application MFA enrollment/challenge, full endpoint injection matrices, production rate-limit/load testing, exhaustive TLS ciphers, real payment settlement/refunds and provider push recovery remain separate work. Mocked provider tests do not prove delivery or settlement.
- The call-screening service's exported component requires `android.permission.BIND_SCREENING_SERVICE`. Android documents this as signature/privileged and required so only the system can bind. That supports the manifest design; it is not a runtime device-probe pass. Other externally declared component permissions retain their individual review requirements. See [Android permission reference](https://developer.android.com/reference/android/Manifest.permission#BIND_SCREENING_SERVICE).
- Candidate header tests are local. Production still needs a reviewed deployment and post-deployment validation. Preserve native sign-in, server authorization and Cloudflare Access.

## Deployment and rollback boundary

No production database migration or production deployment is performed. Before deployment, review the diff, capture the current API/website/admin artifacts and lockfiles, confirm production database backup/recovery prerequisites, and retain the previous signed mobile artifact. Roll back API/admin/website together with their previous dependency lockfiles/artifacts if compatibility checks fail. A mobile rollback cannot rely on lowering a published version code: use the normal forward-fix/store release process.

The security changes introduce no application schema migration. The 89 existing migrations were applied only to the guarded local test environments. The user's unrelated `mobile/stitch-shots/` directory is unchanged.

Repeatable test instructions: [scripts/security/README.md](../../scripts/security/README.md).
