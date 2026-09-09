# Stage #22 — Desktop / Web Business Experience

**Status:** V1 DELIVERED for the high-value workflows, with documented deferrals
(quote/invoice creation, team administration, report detail). Built on the
existing `website/` Astro app + `cloudflare/auth-gateway`, per
`docs/OWNER_DECISION_OA6_STAGE22_WEB.md`.
**Next stage:** finish #23 Production Hardening (a partial landed already).

---

## 1. Architecture reused

- **`website/`** (Astro 5, `output: "static"`) is the business desktop/web client.
  Pages are static HTML; each dashboard page's inline `<script>` island fetches the
  gateway with `credentials: "include"` and renders. No SSR, no client router.
- **`cloudflare/auth-gateway/worker.mjs`** is the web ↔ API boundary: realm-prefixed
  `__Host-*` HttpOnly cookies, auto-refresh on upstream 401, Turnstile, origin +
  `sec-fetch-site` gating, CSP, body cap. **Already present and not changed
  structurally.**
- **Fastify API + `src/lib/capabilities.ts` + entitlements** remain the sole
  authority. No business logic or authorization was reproduced in Astro/JS.
- Existing dashboard shell reused: `DashboardLayout`, `DashboardNav`,
  `DashboardCollection` (the generic list+create island), `styles/dashboard.css`.

## 2. Gateway design and security

The gateway already had a **`protectedRoutes` allowlist** + `matchProtectedRoute`
(exact anchored pattern, method, realm, per-route query-key allowlist) +
`protectedProxy` (session resolve → upstream call → refresh-and-retry on 401 →
sanitised error). This is the "maintainable authenticated forwarding" the decision
asked for — **not** an open proxy. #22 added entries only:

| New `/v1/business/*` | Method(s) | Upstream |
|---|---|---|
| `ai-receptionist` | GET, PATCH | `/ai/receptionist` |
| `inventory` | GET, POST | `/inventory/items` |
| `inventory/:uuid/movements` | GET, POST | `/inventory/items/:id/movements` |
| `inventory/:uuid` | PATCH | `/inventory/items/:id` |
| `reviews/metrics` | GET | `/review-requests/metrics` |
| `feedback` | GET | `/feedback` |
| `feedback/:uuid/respond` | POST | `/feedback/:id/respond` |
| `leads/:uuid` | PATCH | `/leads/:id` |
| `leads/:uuid/(mark-contacted\|booked\|won\|lost)` | POST | `/leads/:id/mark-*` |
| `appointments/:uuid` | PATCH | `/appointments/:id` |
| `appointments/:uuid/status` | POST | `/appointments/:id/status` |
| `messages/:uuid` | GET | `/messages/conversations/:id` |
| `messages/:uuid/read` | POST | `/messages/conversations/:id/read` |
| `messages/send` | POST | `/messages/send` |
| `booking-links` | GET | `/business/booking-links` (#21) |

Security properties (verified by `worker.test.mjs`, 12 tests): every new route is
realm-scoped `business`; a non-UUID id never matches a parameterised route; an
unknown sub-path is **not** forwarded (no passthrough); wrong method → no match;
missing session → 401 before any upstream call; `messages/send` never matches the
parameterised `GET /messages/:id`. No platform-admin path, secret, credential or
cross-tenant resource is reachable — the API still runs `authenticate` +
`requireBusiness` + `requireCapability` + entitlement + Zod on every forwarded call.

## 3. Pages / workflows completed

| # | Area | Web state |
|---|---|---|
| 1 | Dashboard / attention | ✅ metrics, recent activity, recovery snapshot (existing `/v1/dashboard` bundle) |
| 2 | Calendar & appointments | ✅ list (12-month window) + create booking + per-row status: confirm / complete / no-show / cancel. *No visual calendar grid — deferred.* |
| 3 | Leads | ✅ list + create + status transitions (contacted / booked / won / lost) |
| 4 | Customers | ✅ list + create |
| 5 | Unified inbox | ✅ conversation list + thread view + reply (send with per-conversation idempotency key; server runs the same consent/budget/entitlement checks) |
| 6 | Quotes | ⚠️ list / view only — **creation deferred** (multi-line-item document builder) |
| 7 | Invoices & payments | ⚠️ invoice list / view + Stripe Connect status & onboarding link (owner-gated). **Invoice creation deferred.** |
| 8 | Team | ⚠️ roster view only. **Member/role management deferred** (OWNER-only admin surface) |
| 9 | Inventory | ✅ item list + create item + stock-movement recorder (RECEIVE/RESTOCK/CONSUME/SERVICE_USE/WASTE, and ADJUST/CORRECTION gated to `inventory.adjust`) |
| 10 | Reviews / reputation | ✅ request list + create request + **feedback list + public reply** (#20) |
| 11 | AI Receptionist / after-hours | ✅ on/off, SMS/WhatsApp toggles, ALWAYS vs AFTER_HOURS_ONLY, live "answering now" + plan/hours status |
| 12 | Business settings / catalogue / availability | ✅ 4-step setup wizard (basics, opening hours, services, Google review link) — pre-existing, verified |
| 13 | Reports / financial summaries | ⚠️ weekly-report list only — **detail view deferred** |

**9 of 13 are usable end-to-end; 4 are read-only (real data, not stubs).**

## 4. API gaps added

None. Every web workflow uses an existing backend route. `GET /business/booking-links`
(added in #21) is now surfaced. No web-only business logic was created.

## 5. Capability / entitlement behaviour

- `website/src/scripts/capabilities.js` — a **UX-only** mirror of the backend
  OWNER/ADMIN/STAFF matrix. `tests/web-capabilities.test.ts` asserts it never
  disagrees with `src/lib/capabilities.ts` for any capability × role, and denies
  unknown roles.
- `DashboardCollection` `manageCapability` prop → the **create** control is hidden
  unless the member's role holds it (customers→`customers.manage`,
  leads→`leads.manage`, bookings→`appointments.manage`, reviews→`reviews.manage`,
  inventory→`inventory.manage`).
- Row actions (lead / booking transitions, feedback reply, inventory movement,
  message reply) render only when the role holds the capability.
- `DashboardNav` carries a capability per item; `DashboardLayout` hides sidebar
  links the role cannot use (e.g. STAFF loses Automation, AI Receptionist, Reports,
  Settings; keeps Customers, Leads, Bookings, Inventory, Reviews, Team, Payments).
- **Backend/gateway remain authoritative**: a STAFF member who forges a request to a
  hidden action still gets 403 from the API. Verified conceptually by the gateway
  tests (missing/again-checked session, no passthrough) + the backend
  `authorization-matrix` / `entitlements` suites (unchanged, still green).

## 6. Session / auth security

Inspected, not changed: realm-prefixed `__Host-chakusa_access` / `_refresh`
HttpOnly+Secure+SameSite=Strict cookies; business and client sessions are separate
prefixes and separate backend auth roots (`/auth` vs `/customer/auth`); no token is
ever placed in `localStorage` or rendered HTML (`safeAuthPayload` strips them);
auto-refresh on upstream 401; `logout` clears cookies even if the API call fails;
origin + `sec-fetch-site` rejection before auth; CSP `default-src 'none'`. All
mutations are POST/PATCH JSON through the same-site gateway with credentialed CORS
restricted to the two website origins.

## 7. Responsive / accessibility work

- `DashboardLayout`: skip link, semantic `<header>/<aside>/<main>`, `aria-current`
  on the active nav item, labelled nav landmarks.
- New pages use real headings, `<label>`-wrapped controls, `role="status"` on async
  messages, keyboard-operable `<button>`s (no click-only `<div>`s), and
  loading / auth-required / permission-denied / empty states.
- CSS: the messages two-pane collapses to one column ≤ 800px; forms and readiness
  cards collapse to one column ≤ 700px; row action bars wrap.
- `astro check` (310 files) — 0 errors / warnings / hints.

## 8. Tests and browser verification

- `cloudflare/auth-gateway` `node --test` — **12/12** (cookie codec, token
  stripping, realm separation, origin + sec-fetch-site, route + query allowlist,
  the 15 new upstream mappings, non-UUID / wrong-method / no-passthrough rejection,
  missing-session 401).
- `tests/web-capabilities.test.ts` — **4/4** (matrix mirror parity + unknown-role
  denial).
- `website`: `astro check` clean; `astro build` — **76 pages** built.
- Backend `tsc -p tsconfig.test.json` clean.
- **Browser E2E not run**: the environment has no browser and `website/` has no
  Playwright. The islands are small vanilla-JS fetch+render units verified by
  build + typecheck + the gateway/security tests; a Playwright smoke against a
  preview deploy is a recommended follow-up (dev-only dependency, reversible).

## 9. Regressions

- Existing website marketing + auth + client-dashboard pages: `astro check` and
  `astro build` both clean (76 pages, unchanged count aside from no new *public*
  pages).
- Backend + gateway: no backend route changed; gateway change is additive
  allowlist entries; existing gateway tests still pass.
- `DashboardCollection` change is backward compatible — pages without
  `manageCapability` / a `ROW_ACTIONS` kind behave exactly as before.

## 10. Files / commits

- `feat(web): AI Receptionist + Inventory pages, capability-aware dashboard` —
  gateway routes + tests, `capabilities.js/.d.ts`, `DashboardCollection`
  (`manageCapability`), `DashboardNav` + `DashboardLayout` nav gating, 2 new pages,
  `tests/web-capabilities.test.ts`.
- `feat(web): row-level lead/booking status actions + feedback replies` —
  `DashboardCollection` `ROW_ACTIONS`, reviews feedback section, `dashboard.css`.
- `feat(web): messages thread view + reply` — gateway message routes + tests,
  two-pane `messages.astro`.

## 11. Limitations deferred to post-V1 (a #22 follow-up)

- **Quote & invoice creation** from the web (line-item document builder + send).
  View works today.
- **Team administration** (invite / change role / remove) — OWNER-only surface;
  roster view works.
- **Report detail** rendering (weekly report body) — list works.
- **Calendar grid** view for appointments — list + create + status work.
- **Attachments** in the web inbox (send/receive files) — text reply works.
- **Per-page dedupe of the `/v1/dashboard` identity fetch** — currently each island
  fetches it for the role; a shared `sessionStorage` cache is a small optimisation.
- **Playwright smoke** against a preview deploy for true browser E2E.

## Owner actions

None new. OA-1 (prod migration) and OA-5 (app-link identifiers) still tracked and
still non-blocking for engineering.

## Next

Finish #23 Production Hardening (worker HTTP-tick parity + step isolation +
stranded-dispatch recovery already landed as `fix(worker): …`). Remaining: the
audit doc + operational runbook, the remaining hardening areas review, and
fault-injection tests.
