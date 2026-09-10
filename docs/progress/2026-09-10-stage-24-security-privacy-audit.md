# Stage #24 — Pre-release Security & Privacy Audit

**Status:** COMPLETE. All 18 audit areas reviewed. One P1 (dependency
vulnerabilities) fixed; no other P0/P1 found. Release gate ("no release with
unresolved P0/P1") is met for the engineering scope.
**Next stage:** #25 Manual QA Preparation (owner/device-gated).

---

## Method

Systematic review of each scope area against the code, plus `npm audit`, plus
verification that the security invariants in `CLAUDE.md` hold at the call sites
added in #18–#23 and the new web/gateway surface (#22). Existing security test
suites (`authorization-matrix`, `entitlements`, `customer-platform`, `sentry`,
`ai-policy-engine`, `messaging-webhooks`) were re-run and remain green after the
dependency bump.

## Findings

### P1 — dependency vulnerabilities — FIXED
`npm audit` (prod deps): 3 advisories.

| Package | Severity | Advisory |
|---|---|---|
| `fast-uri` (transitive, ajv/fastify) | **high** | host confusion via percent-encoded scheme normalization |
| `fastify` ≤ 5.12.0 | moderate | schema-validation bypass via root primitive coercion; **X-Forwarded-\* spoofing under trustProxy hop-count** |
| `qs` (transitive, twilio) | moderate | array-limit bypass; isBuffer DoS |

The fastify `X-Forwarded` advisory is load-bearing: the #23 correlation-id trust
and IP-based rate limiting both depend on `trustProxy` being sound.

**Fix:** `npm audit fix` (non-forced) — lockfile only, `fastify 5.11.3 → 5.12.3`
within `^5.0.0`, no `package.json` change. `npm audit` now reports **0
vulnerabilities**. Regression: prod `tsc` clean; 106 tests across auth,
authorization-matrix, entitlements, worker-health, appointments, marketplace,
messaging, customer-booking — all pass. Committed `fix(deps): npm audit fix …`.

### All other areas — reviewed, no P0/P1

| Area | State |
|---|---|
| **Authentication / session / token storage** | JWT (`type:"access"`) + a DB `AuthSession` row that must match on `id`, `userId`, `revokedAt IS NULL`, `expiresAt > now` **and `scope`**. Web tokens live only in `__Host-chakusa_*` HttpOnly+Secure+SameSite=Strict cookies at the gateway; `safeAuthPayload` strips every token from any JSON returned to the browser. Mobile stores the session and push token in `expo-secure-store` with `keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY` (Keychain / Keystore, not iCloud/Android-backup). Logout revokes the session server-side and clears cookies even if the API call fails. |
| **Business / customer session isolation** | `authenticate` requires `scope: "PRODUCT"`; `authenticateCustomer` requires `scope: "CUSTOMER"` **and** an ACTIVE `CustomerProfile`; admin uses `scope: "admin"` in the JWT. A token of one realm can never satisfy another. Covered by `customer-platform.test.ts` ("a CUSTOMER token cannot access business routes" / vice versa). |
| **Tenant isolation / IDOR** | Every business route runs `fastify.requireBusiness` (server-resolved `request.businessId` from the caller's `BusinessMember` row) and every query is `where: { …, businessId }`; `:id` routes use `findFirst({ where: { id, businessId } })` → 404 cross-tenant. Spot-checked the #18–#22 additions (conversation read/`:id`/`/read`, feedback `respond`, review-request `metrics`, booking-links, inventory, ai-receptionist) and the #22 gateway (exact-pattern allowlist, realm-scoped, non-UUID rejected, no passthrough — 12 gateway tests). |
| **Role / capability escalation** | Single authoritative matrix `src/lib/capabilities.ts` (`OWNER`/`ADMIN`/`STAFF`, no custom roles, no per-member overrides); `requireCapability` after `requireBusiness`. The web mirror (`website/src/scripts/capabilities.js`) is UX-only and drift-tested against the backend (`tests/web-capabilities.test.ts`). A STAFF/ADMIN request to a higher surface still 403s at the API regardless of what the web nav shows. |
| **Entitlement bypass** | `assertFeatureAvailable(plan, status, feature)` / `hasFeature` — a separate axis from capability, both enforced. Status-aware: a lapsed PRO (EXPIRED/CANCELED) cannot keep sending billable messages. `entitlements.test.ts` green. |
| **Mass assignment** | Every request body is `zod.parse`d to an explicit shape before use; no `data: { ...request.body }` into Prisma anywhere in `src/`. |
| **Injection** | Prisma parameterised queries throughout; raw SQL uses `Prisma.sql` tagged templates with `${}` bindings. The only `Prisma.raw` use (`triggerEngine.ts`) is a ternary between two hard-coded column-name literals, not user input. No `$queryRawUnsafe` / `$executeRawUnsafe`. |
| **SSRF / path / file upload** | Server-side `fetch` targets are fixed provider hosts only (Apple StoreKit, Apple ID issuer, Google, Stripe, Twilio, the configured AI base URL) — no user-supplied URL reaches a server fetch (`googleReviewLink` / `logoDataUrl` are stored/rendered, never fetched). Attachments: declared size (≤ 20 MB) + mime + SHA-256 checksum on init, then an async **malware scan**; downloads only when `uploadStatus:"READY"` + `malwareScanStatus:"CLEAN"`, served with the **sniffed** `detectedMime`; infected content is deleted from storage. Download links are short-lived signed tokens scoped to `(id, businessId)`. |
| **Webhook forgery / replay** | `verifyWebhookSignature` (Twilio) / `constructEvent` (Stripe) before any processing → 401 on mismatch. Replay is neutralised by idempotency: delivery receipts upsert on `(provider, providerEventId)`, inbound messages dedupe on `(businessId, provider, providerMessageId)` under a tx advisory lock (#18). |
| **Secrets / config leakage** | Sentry `beforeSend` deletes request headers/cookies/query-string and scrubs a sensitive-key regex recursively (`authorization`, `*token*`, `password`, `*secret*`, `databaseurl`, `twilioauthtoken`, …); `sendDefaultPii:false`. No `console.log` of tokens/secrets/keys/passwords in `src/`. `config.ts` validates required secrets at boot (fails the deploy, not the first request). |
| **Payment verification** | Stripe: webhook `constructEvent` signature; Apple: signed-transaction JWS verified against the configured Apple root certs (`assertValidAppleRootCertificates` at boot); Google: Play Developer API server-to-server. No client-reported payment state is trusted. |
| **AI prompt injection / tool authorization / data leakage** | Each tool call runs through the Policy Engine inside the executor — a disallowed call throws `POLICY_DENIED` / `POLICY_APPROVAL_REQUIRED`; the model's tool *requests* are filtered, never trusted. A second `evaluatePolicy` at the `CUSTOMER_RESPONSE` checkpoint gates the reply (DENY / ESCALATE / REQUIRE_APPROVAL). Runs are idempotent (`agent:${runId}:…`). AI never authorises a tool or an action — the policy decision does. `ai-policy-engine.test.ts` green. |
| **PII minimisation / logging** | Structured pino JSON + a per-request correlation id (#23). Sentry tags carry only internal ids (`userId`, `businessId`, `role`, `requestId`) — never email/phone/name. Marketplace/public serializers deliberately omit `ownerId`, subscription, credentials, internal notes (verified in #19/#21 boundary tests). |
| **Live-location retention / access** | Ephemeral, appointment-scoped, auto-expiring; `expireStaleLocationShares` runs every worker cycle so no share outlives its window even if every client disappears. Customer access is derived from owned appointments; provider `POST /location-share` requires `ON_MY_WAY`. No permanent location history (a `CLAUDE.md` non-negotiable). |
| **Account deletion / export** | `POST /auth/delete-account` requires re-verification (password, or a fresh Google id-token with matching subject, or an Apple proof). `GET /business/export` behind `requireBusiness`, tenant-scoped. |
| **Privacy-policy consistency** | Legal documents + per-user acceptance tracking (`/business/legal/*`, `/customer/legal/*`); the gateway records website-registration acceptances for all three document types. Data-Safety / App-Privacy declarations for Live Location are tracked as OA-2 for the store submission. |
| **Mobile secure storage** | `expo-secure-store` device-only for session + push token; experience preference likewise. No token in `AsyncStorage` / `localStorage` (web fallback aside, which is the browser dashboard's HttpOnly-cookie model, not token-in-JS). |
| **Dependency vulnerabilities** | See the P1 above — now 0. |

## Migrations

None.

## Tests / regressions / typechecks

- `npm audit` (prod) — **0 vulnerabilities** (was 1 high + 2 moderate).
- Backend `tsc --noEmit` clean after the fastify bump.
- 106 tests across 8 suites (auth, authorization-matrix, entitlements,
  worker-health, appointments, marketplace, messaging-platform-core,
  customer-booking) — all pass after the bump.
- Existing security suites unchanged and green: `customer-platform`
  (realm isolation), `authorization-matrix`, `entitlements`, `sentry`
  (scrub / classification), `ai-policy-engine`, `messaging-webhooks`.

## Commits

- `fix(deps): npm audit fix — fastify 5.12.3, qs, fast-uri (roadmap #24)`

## Unresolved limitations

- **OA-2** (store Data-Safety / App-Privacy declarations for Live Location) and
  the **privacy policy text** are owner/store-console actions for #26, not
  engineering gaps.
- Dependency audit is a point-in-time result; wire `npm audit --omit=dev` (fail on
  high) into CI so a new advisory is caught before the next release — recommended
  for #26.
- Global messaging-provider circuit breaker remains a P3 (from #23).

## Owner actions

None new. OA-2 (store privacy declarations) reconfirmed as required before the #14
Live-Location feature ships.

## Next stage

#25 Manual QA Preparation — a physical-device QA matrix. Largely
owner/device-gated; the engineering deliverable is the matrix document.
