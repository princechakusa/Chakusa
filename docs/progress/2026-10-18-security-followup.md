# Security follow-up — 18 October 2026

Status updated 19 October (Asia/Dubai): dependency mitigations, optimized signed build, admin identity binding, mobile privacy, session/upload-queue isolation and browser regressions verified. The full backend follow-up completed (see "Final verification — 19 October"). The upload-queue change added the native `expo-crypto` module after the installed privacy release was built, so a fresh signed build, device smoke test and artifact-specific MobSF scan are still required. Committed locally; not deployed. Android 7–9 compatibility remains an explicit owner decision.

The owner requested higher security scores across the stack. Scores will be recorded from the actual tools and artifacts; findings are not suppressed or renamed to manufacture a passing result. The previous complete evidence set remains in [the original report](2026-10-17-security-validation.md).

## Dependency fixes

The current mobile audit still reports 19 high / 0 critical findings. Its affected nodes resolve to one installed `braces@3.0.3` and one `node-forge@1.4.0`; other findings propagate through their dependency chains. The published [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) and [node-forge advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv) still list no upstream patched release.

Two versioned `patch-package` patches now mitigate the described failure cases:

- `braces`: enforce a fixed nesting cap in the string parser and recursive compile, expand and stringify walkers. Parentheses and direct AST entry points are covered as well as brace strings. Ordinary ranges, alternatives, escaping and AST round trips remain supported.
- `node-forge`: reject extra nested DigestAlgorithm elements, non-NULL parameters and malformed nonempty NULL parameters in PKCS#1 v1.5 verification. Both valid SHA-256 AlgorithmIdentifier encodings remain supported, and changed digests still fail.

The new regression harness initially failed on excessive pattern nesting, deep AST input and malformed RSA structures. All five tests pass after the patches. The test RSA key is generated ephemerally and never used by Chakusa. No live signatures or credentials are used.

Mobile postinstall now fails if a patch cannot apply. All five current patches apply successfully. CI installs the locked mobile dependency tree and runs `npm run security:mobile-dependencies` separately from the unchanged audit gate. Local patches do not alter version-based audit results; the high-severity gate remains red until upstream fixes or maintained replacement packages resolve the inventory findings.

## Android release optimization

The Expo security plugin now enables release code minification and resource shrinking and selects `proguard-android-optimize.txt`. Expo's legacy `proguard-android.txt` default includes a no-optimization rule, so enabling minification alone would not give the intended optimization. Existing application/SDK keep rules remain in place. Debug builds retain their normal development behavior. See [Android's optimization guidance](https://developer.android.com/topic/performance/app-optimization/enable-app-optimization).

The first optimization attempt was intentionally interrupted to correct the default rule selection; it is excluded from completion evidence. The previous signed APK and its scanner export are retained privately for comparison. The new mapping file must be retained with the release evidence for crash retracing. No optimized build is approved for store delivery before physical-device smoke tests exercise native modules, Google sign-in, call screening, push and map behavior.

## Verification

- Dependency attack/compatibility regressions: 5 passed.
- Mobile unit suite after privacy changes: 552 passed, zero failures or skips.
- Mobile TypeScript: passed.
- Backend/repository lint: zero errors, three pre-existing warnings.
- Patch application: all five patches pass.
- Signed optimized APK build: passed in 19 minutes 7 seconds, including `minifyReleaseWithR8` and resource shrinking. The retained optimizer configuration contains no `-dontoptimize` directive. Mapping, usage, seeds and configuration outputs are retained privately for retracing/review.
- Optimized APK: **87,619,991 bytes**, down **10.34%** from 97,724,620 bytes. SHA-256: `77b794e065ea3abbfcff541933da231326a0b210be2bd5655b0857bddc6a0431`.
- `apksigner verify` passes using the existing upload signing certificate. Compiled manifest retains minimum SDK 24, target SDK 36, `allowBackup=false`, `usesCleartextTraffic=false` and no SYSTEM_ALERT_WINDOW permission. Compiled backup XML retains all nine full-backup and eighteen cloud/device-transfer exclusions.
- `apkanalyzer manifest debuggable` reports false for the optimized APK.
- Expo introspection confirms both release shrinking properties remain enabled after regeneration. The release QA matrix now explicitly covers optimized-native integrations, release WebView debugging and older/current Android compatibility.
- MobSF completed the optimized APK scan: scanner MD5 `d4b9cc6298cb4a71925d84aa36d6f28b`, **51/100**, **2 high / 17 warning / 4 info / 2 secure / 1 permission hotspot**. The previous same-format APK scored 48/100. The WebView-debugging finding is absent in the optimized scan. Additional patterns became visible after R8 changed code layout; a higher score is not evidence that all findings are closed. This APK predates the subsequent JavaScript privacy changes below.

## Admin identity and API follow-up

Six new regressions reproduced missing Access verification at login/refresh and acceptance of a different verified Access identity alongside an administrator's app session. Login and refresh returned 200 for invalid/mixed evidence; authenticated reads also accepted the mixed identity. The new shared boundary verifies the assertion and binds its normalized email to the administrator before creating/rotating sessions or authorizing API requests, whenever `CF_ACCESS_ENABLED` is enabled. Existing signed-assertion verification remains authoritative; client-supplied identity headers are never trusted as identity by themselves.

The six original cases pass in a 30-test admin/auth regression group. A final seven-case identity suite also passes, including successful login, refresh and authorization with matching case-normalized identities. These tests mock external assertion verification to isolate identity binding; they do not claim a live Cloudflare policy/IdP validation. Credential revocation through logout retains the existing CSRF protection and remains available without completing Access authentication.

The actual installed **Postman CLI 1.75.0** completed the local collection: **67 requests / 206 assertions passed**, zero request/assertion failures. Reports omit request/response headers and bodies and remain private because synthetic environment variables are still sensitive. The CLI reported that Postman credentials would be required to publish results; no cloud login or publication was performed. Fixtures were removed, the task server stopped and its temporary PostgreSQL container removed.

The local test wrapper now disables Cloudflare Access and binds `API_BIND_HOST=127.0.0.1`. The new validated bind setting retains `0.0.0.0` as the ordinary deployment default. This prevents accidental exposure of the synthetic fixture server or unintended external Access verification inherited from a developer environment. No production binding changes are applied.

## Mobile diagnostic privacy follow-up

Three new regressions failed against the old scrubber: nested sensitive fields/URL credentials and bearer paths remained, free-form error text and stack locals remained, and cyclic diagnostics could not be serialized safely. The fixed focused suite passes all five cases. The scrubber now recursively filters sensitive keys, sanitizes URLs, removes request cookies, unstructured exception text and stack locals, and bounds nesting/arrays/records with safe cycle markers. Exception types, stack positions and non-sensitive counters remain available. Arbitrary diagnostic data still requires review; this is not a promise that unknown free text is automatically anonymized.

No test sends an event to Sentry. Monitoring remains opt-in, with default PII/session/performance/screenshot/view-hierarchy capture disabled. Full mobile tests (552) and typecheck pass. The fresh signed privacy release built successfully in 10 minutes 33 seconds; SHA-256 is `13a4231363a09213bd20e1a3fc2f9023acb95c2862e46df99be647c748cf4544`. Signature, non-debuggable manifest and compiled backup exclusions were reverified. The earlier 51/100 result above belongs to the intermediate APK and must not be attributed to this artifact before its own scan completes.

## Optimized scanner cryptography review

The new CBC high finding occurs once in decompiled `Q4/m.java:421`. R8 merges/inlines classes, so its apparent Google sign-in class name alone is misleading. The surrounding code creates the Android Keystore key named `androidxBiometric`, initializes an encryption-only cipher and wraps it in a `BiometricPrompt.CryptoObject` for a biometric capability check. The retained mapping identifies the called helpers as `androidx.biometric.CryptoObjectUtils$Api23Impl` and `BiometricManager$Api29Impl`. There is no attacker-ciphertext decryption or customer-data encryption in this call path. This matches AndroidX's internal [fake crypto-object compatibility helper](https://android.googlesource.com/platform/frameworks/support/+/bafe6578861679fa12afca0f585e684474a2d14b/biometric/biometric/src/main/java/androidx/biometric/CryptoObjectUtils.java). Static review therefore does not substantiate an application padding oracle here; the raw finding is retained rather than changing biometric behavior to satisfy a pattern rule. This is not an exhaustive runtime crypto audit.

The new raw-SQL/random/SHA-1 patterns also map principally to Google DataTransport, OkHttp, Kotlin and Sentry code, including merged synthetic classes. Owner names alone do not close findings: input binding, purpose and reachability must be evaluated individually. A bounded search of the mobile source found no application `eval`, `new Function`, `rawQuery` or custom cipher implementation. This does not assert the absence of backend raw SQL or all dynamic mobile behavior. Remaining runtime/device checks stay open.

The seven decompiled files listed by the optimized scanner's `android_sql_raw_query` rule were subsequently read. Their flagged SELECTs are constant SQL or use `?` parameters for context IDs, retention timestamps, transport source and reason. Adjacent dynamic SQL in the drop-count update inserts a typed Java `long`, while source/reason remain bound; migration SQL is constant apart from a system-time `long`. These inspected call sites do not substantiate attacker-controlled SQL injection. The original warning remains in the raw tool output, and this bounded review does not cover every database operation in every dependency.

## Backend monitoring and error-log privacy

New Sentry regressions reproduced nested PII, URL credentials, raw exception text/stack locals and unsafe cyclic/deep diagnostics. The backend scrubber now bounds traversal, redacts sensitive fields, strips URL userinfo/query/fragment/bearer paths, limits headers to content type/length and removes unstructured exception/log text and source locals. Pino error serializers retain classifications and redact messages/stacks. Unexpected error logging uses constant messages; Prisma event logs and process/worker errors no longer print raw SDK error messages. This reduces diagnosis detail intentionally; arbitrary unknown free text still needs review.

The final focused monitoring, logging and Access JWT group passes **37 tests**. Production build and test typecheck pass; lint has zero errors and three existing warnings. An initial focused invocation without DATABASE_URL was blocked by the test safety guard before any test executed; it is not counted as a pass. A serializer typing error found by compilation was corrected with explicit redacted message/empty stack fields, then compilation and regressions reran successfully.

Nine real-signature Access JWT cases also pass, including required expiry and explicit RS256 policy. The transport resolver is mocked, while RSA signing and claim verification use the real library. The mock resolver initially permitted RS384; that is defense-in-depth evidence, not proof of a live Cloudflare bypass because the actual remote JWKS resolver also filters key algorithm metadata. See [Cloudflare's verification guidance](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).

## Website text injection regression

The motion split/scrub code used `innerHTML` to reconstruct words read from text nodes. A harmless escaped SVG canary reproduced text being converted into markup. Both paths now construct elements with `textContent` and document fragments. The baseline browser test failed on literal-text preservation, then the corrected **24-test browser suite passed with zero failures, skips or flaky cases**. The first baseline attempt timed out starting its preview server and is excluded. Website build/check passes (91 generated pages). The canary does not claim a demonstrated production remote injection source.

## Physical phone and Chrome evidence — 19 October

ADB detects the authorized Android 15 phone. Android initially rejected an update because the existing app had a different signing certificate. After the owner explicitly approved removing that copy and its local data, uninstall/install succeeded. Cold launch returned `Status: ok`; the actual welcome screen was visually inspected. Pulling the installed base APK and hashing it exactly matches the privacy release SHA-256 above. `run-as` is denied because the package is not debuggable. No Chrome/WebView devtools socket was observed at the welcome screen; this does not prove behavior of an authenticated map WebView that was not opened.

The release retains backup/cleartext protections and sensitive runtime permissions remain ungranted on the fresh install. Authenticated maps, call screening, Google sign-in, push, reflection/JNI paths, older Android and iOS still require device QA. No production account was created or real provider message sent.

The redacted evidence viewer is available locally in Chrome at `http://127.0.0.1:8765/`. It exposes actual individual test names/statuses, audit counts, MobSF finding titles, report text, the reviewed phone screenshot and source report hashes. Its dedicated served directory contains summaries only; the private raw evidence directory is not served. Rebuild with `scripts/security/build-evidence.py` after results change. The viewer was opened and its Postman filter verified through Chrome.

An earlier full backend follow-up was interrupted after a 5-second Prisma transaction expired under concurrent Gradle/browser/typecheck load. All shard exits were retained as unsuccessful, and no assertions or timeouts were relaxed. A fresh run against three newly isolated local databases is in progress with the heavy native build/scanner stopped. Historical 1,703-test results remain labelled as historical until that run completes.

Private raw evidence remains under `C:/Users/Surface/.codex/tmp/chakusa-security/`. No production deployment, database migration, external delivery or store action is performed. This stage changes no backend schema. The earlier report's open native MFA enrollment, runtime/iOS, provider and production validation requirements still apply.

Operational correction: MobSF prints its API key in its startup banner; a startup-log read exposed that local credential in tool output. The scanner's backing secret was rotated without displaying replacement values and its service restarted. The published port remains restricted to `127.0.0.1:8000`. Subsequent startup checks use status/readiness instead of printing that banner. No Chakusa application credential was involved.

## Mobile session and upload-queue isolation — 19 October

New regressions reproduced two cross-account risks on a shared device. First, the attachment queue was one plaintext file in app documents, so files queued by one account were uploaded with whichever account signed in next. Second, a refresh that finished after a logout or a different login could write its stale tokens back over the newer session.

- The queue is now per user + business, AES-GCM encrypted with a per-owner key in SecureStore (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`). Every read, write and upload re-checks that the stored session still belongs to that owner. Uploaded items drop their file bytes. The queue is capped at 20 items / 28 MB and expires items after 48 hours. The legacy plaintext file is encrypted into a quarantine file and deleted; it is never imported into any account.
- Business and customer session stores serialize writes and carry a revision counter. A refresh stores its result only if no login, logout or other refresh happened in between.

Focused suites pass 15/15. The full mobile suite passes 567/567, and mobile typecheck passes. This adds the native `expo-crypto` module (installed 19 October 00:34), which the 13a42313… privacy APK on the phone does not contain. That APK must not be used to QA uploads.

## Final verification — 19 October

- Full backend suite: three isolated loopback PostgreSQL instances (`chakusa_test`), Vitest shards 1–3. Shards 1 and 3 passed. In shard 2, one assertion in `ai-customer-agent.test.ts` failed: the dispatch worker's due check uses the database clock while enqueue uses the application clock, and the first tick ran before both agreed. The test now polls the real worker (2 s) with the same assertions (at least one dispatch, message `sent`); the file then passed 10/10. Merged and checked for exactly-once file coverage: **1,724 / 1,724 passed**, 0 failed or skipped. No backend source changed after the run started.
- Rerun on the committed tree: backend build and test typecheck pass. Lint shows 0 errors and the 3 existing warnings. Admin typecheck passes. Auth gateway: 42/42. Dependency-patch regressions: 5/5. Repository secret scan passes (1,471 tracked files). Website security browser group: 5/5 (CSP/headers, 19 October).
- Commits: `59f0bb0` backend, `f23be64` admin/gateway, `645cc1d` mobile, `c9fba10` website, `1210161` CI/docs.

## Still open

- Fresh signed release with `expo-crypto`, then a physical-device smoke test (uploads, sign-in, maps, call screening, push) and an artifact-specific MobSF scan. Device and scanner results are recorded only against that artifact's hash.
- `npm audit --audit-level=high` for mobile stays red (braces / node-forge have no upstream fix; local patches mitigate them). The new CI gate shows this intentionally.
- Deploy the backend/admin/gateway/website changes. `CF_ACCESS_ENABLED` identity binding needs a live check against the real Access application after deploy.

## Mobile audit to zero — 19 October

`braces` and `node-forge` still have no upstream fixed release. Patches applied on top of the installed packages do not change what `npm audit` checks, so the gate stayed at 19 high. Codex's patched code now ships as two in-repo forks under `mobile/vendor/` (`braces@3.0.3-chakusa.1`, `node-forge@1.4.0-chakusa.1`, original licenses kept). `overrides` routes every dependent to them, through `$name` references to direct dev dependencies; a relative `file:` override resolves from inside each dependent package and fails. The two `patch-package` patches are retired; the other four still apply.

Result: `npm audit` reports **0 vulnerabilities in all four projects** (root, admin, website, mobile). `npm audit` cannot evaluate local forks. The evidence they are fixed is `npm run security:mobile-dependencies` (5/5: attack inputs rejected, ordinary patterns and valid signatures still work). Mobile 567/567 and typecheck pass. See `mobile/vendor/README.md` for when to remove the forks.

The signed release rebuild compiled and passed R8, then failed at signing: "keystore password was incorrect" for `chakusa-upload-2026-10.p12` with the adjacent password file. Recorded as an owner action. The previous privacy APK was removed from the build output by that failed packaging step; the phone still has it installed.

## Website headers, gateway logout and Android rebuild — 19 October (afternoon)

- **Deployed** (push to `master`, Cloudflare Pages). httpscanner.com scored the live site **31 → 78 → 95/100** (reports `76d415cd…`, `28dc2532…`, `88ce4569…`, `d729d748…`). Every scored header is at full points except CSP (20.4/22; the scanner reports no specific weakness) and Clear-Site-Data (0/3).
- Marketing pages: COEP `require-corp`, COOP/CORP `same-origin`, HSTS 2 years with `includeSubDomains; preload` (the `preload` token alone does not enroll the domain; no preload-list submission was made), full Permissions-Policy, and a CSP of `'self'` plus the two API hosts, with no `'unsafe-inline'`. All 16 inline `style=` attributes became utility classes.
- Sign-in pages keep `same-origin-allow-popups`, no COEP and inline styles only, because Google Sign-In injects `<style>` elements and Turnstile/Google iframes cannot satisfy COEP. Dashboard pages allow `https:` images for uploads. Inline scripts are blocked everywhere.
- Verified before deploy with Wrangler's local Pages server: per-path headers correct; a visible Chrome crawl of all 90 pages found 0 unexpected console errors, CSP violations or failed requests. Website Playwright suite 25/25, including a new contract test that applies `_headers` per path the way Cloudflare does (the old test applied only the first block to every page).
- Found and fixed during the crawl: missing `/favicon.ico` (redirect stubs 404ed), and an uncaught "Failed to fetch" on `/dashboard/business/reviews` when the network fails.
- Pre-existing, not caused by the headers: Google Sign-In reports "The given origin is not allowed for the given client ID" on the live login pages. The web OAuth client needs `https://chakusarecovery.com` as an authorized JavaScript origin (Google Cloud Console).
- Auth gateway (`c9baf86`, committed, **not deployed**): `Clear-Site-Data: "cache", "storage"` on logout (not `"cookies"`, which would clear every cookie on the registrable domain), 2-year preload HSTS, wider Permissions-Policy. Suite 43/43. The gateway deploys only through `wrangler deploy`, so the earlier gateway hardening (`f23be64`) is also not live yet.
- Backend rerun on the deployed code: **1,724 / 1,724 passed** on a fresh loopback database. 1,108 tests exceed Vitest's 300 ms "slow" marker; the median is 350 ms. Measured shared costs: `resetDatabase()` ~1.1 s (about 100 sequential deletes) and Argon2id hashing ~190 ms per registered user. Speeding these up is the next test-infrastructure task.
