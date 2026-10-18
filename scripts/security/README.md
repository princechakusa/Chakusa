# Chakusa security validation

These checks target Chakusa. PaMarket credentials, URLs, accounts and results are not reused.

## Local API / Postman

Use PostgreSQL on loopback with a database named exactly `chakusa_test` and a separate `security_http` schema. Never point these tools at production. The normal backend suite uses the test database's `public` schema; keep the API fixtures separate.

In a process with `NODE_ENV=test`, set `DATABASE_URL` and `DIRECT_URL` to the loopback test URL with `?schema=security_http`, then:

```text
npx prisma migrate deploy
npm run dev:test
```

Set `PORT=4400` before starting that server. The existing test-server wrapper disables external email, SMS, provider authentication, billing and Sentry integrations. It does not enable the normal rate limiter; rate-limit assertions run separately using `createTestApp({ enableRateLimit: true })`.

The wrapper binds `API_BIND_HOST=127.0.0.1` and disables Cloudflare Access for synthetic local identities. Ordinary deployments retain their default `0.0.0.0` binding. Do not expose this isolated fixture server to the network.

In another process with the same guarded database configuration, set `SECURITY_OUTPUT_DIR` to an absolute private directory outside the repository, then:

```text
npx tsx scripts/security/prepare-local.ts --cleanup
npx tsx scripts/security/prepare-local.ts
node scripts/security/generate-postman.mjs
newman run scripts/security/chakusa.postman_collection.json -e <private-directory>/local.postman_environment.json --reporters cli,json --reporter-json-export <private-directory>/postman-results.json
```

The environment contains synthetic credentials and tokens. Keep it and raw Newman reports outside Git. The collection is restricted to `http://127.0.0.1:4400`. Do not change its target to a deployed service. Generated ordinary users own separate businesses; privileged memberships are inserted only into the isolated schema, including a restricted admin and an MFA-required account.

To use Burp, start its loopback proxy with interception disabled and set `HTTP_PROXY` / `HTTPS_PROXY` for the Newman process to that listener. Remove loopback exclusions in `NO_PROXY`. Install Newman before setting these variables so package installation is not accidentally proxied. Verify that requests reached Burp; installation or a listening port alone is not scan evidence. Community proxy traffic is not a completed Professional automated vulnerability scan or a desktop Repeater test.

Finish by running `prepare-local.ts --cleanup` with the same guarded URL. Stop the temporary API and proxy. The cleanup truncates tables only in `security_http`, retaining its migration ledger.

## HTTP / TLS

```text
node scripts/security/check-http.mjs https://chakusarecovery.com https://auth.chakusarecovery.com https://chakusa-api.onrender.com --output=<private-directory>/http-results.json
```

This performs read-only requests, checks selected response headers and paths, and attempts authenticated TLS 1.2/1.3 handshakes. It records no cookies, credentials or response bodies. It is not an exhaustive cipher, endpoint, injection or availability audit.

## Regression suites

Run the full backend suite only against the guarded local `chakusa_test` database. Run new backend test processes sequentially if they reset the same schema. The focused security suites include `http-security`, `admin-foundation`, `admin-permissions`, `admin-client-session`, `auth-foundation`, `authorization-matrix`, `tenant-isolation`, `request-logging`, provider webhook, billing, upload and policy-engine coverage.

For independent shards, create a separate loopback PostgreSQL instance per process, each with database name `chakusa_test`, apply migrations to each, and use Vitest's `--shard=1/3` (then `2/3`, `3/3`) while retaining the configured sequential file execution. Never run shards against the same resettable schema. Validate the JSON results cover every backend test file exactly once before aggregating totals. Remove only the temporary instances created for that run.

Mobile: `npm --prefix mobile test` and `npm --prefix mobile run typecheck`. Apply and verify the existing `patch-package` patches on a clean install. Native changes require a fresh signed release build and artifact-specific MobSF scan. Never weaken release signing to produce a scan artifact.

`npm run security:mobile-dependencies` exercises the locally maintained `braces@3.0.3` recursion limits and `node-forge@1.4.0` nested RSA DigestAlgorithm validation. It also checks ordinary patterns and valid signatures. Both packages currently have unpatched upstream advisories: these local changes do not change package versions or make `npm audit` clean. Keep the audit gate visible. Mobile installation fails if a patch cannot apply; CI installs the locked mobile tree and runs these regressions. Reassess and remove each patch only after a compatible upstream release includes the fix and the regressions pass without it.

Android release builds enable R8 minification and resource shrinking through the Expo security plugin. Keep the mapping output with the private build evidence for crash retracing. Optimization must pass a signed build and physical-device release smoke tests before store delivery; build success alone does not establish reflection/JNI compatibility at runtime.

Website: build `website/`, then run its Playwright `mocked` project. The security browser tests apply the candidate HTTP CSP to the built pages, test that existing scripts remain usable, inject a harmless blocked inline-script canary, and render a hostile map label using real Leaflet. Those local results do not prove that production has deployed the new headers.

## Reporting

Keep raw scanner exports and synthetic credentials private. Commit a redacted findings report with artifact hashes, exact test outcomes, accepted risks and unresolved work. Do not add overlapping test totals together or describe this process as certification that all vulnerabilities have been eliminated.

The installed Postman CLI can run the same loopback collection using `postman collection run`, the private environment file, `-r cli,json`, `--reporter-json-export`, `--reporter-json-omitAllHeadersAndBody` and `--reporter-json-structure newman`. Do not publish the raw report: its environment section still contains synthetic tokens even when headers and bodies are omitted.

Build a local Chrome evidence viewer with `python scripts/security/build-evidence.py --evidence-dir <private-directory> --output-dir <dedicated-viewer-directory>`. This exports selected counts/test names, source hashes and the reviewed welcome-screen image, not raw environments or scanner strings. Serve only the dedicated output directory: `python -m http.server 8765 --bind 127.0.0.1 --directory <dedicated-viewer-directory>`. Never use the raw evidence directory as the server root. The script expects this investigation's named JSON reports and labels missing final backend/scanner evidence as pending.
