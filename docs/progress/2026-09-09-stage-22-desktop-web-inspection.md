# Stage #22 — Desktop / Web Business Experience — INSPECTION (owner decision required)

**Status:** BLOCKED on an owner decision (`docs/OWNER_ACTIONS.md` OA-6). The stage's
own first instruction is "Inspect existing admin/website/web app architecture
first" — that inspection is complete and its outcome is a scope/approach choice
that is the owner's to make, not the agent's.

---

## What exists

| Surface | Stack | Purpose | Relevance to #22 |
|---|---|---|---|
| `admin/` | React 19 + Vite + React Router, deployed via Wrangler | **Platform-admin console** — Businesses, Users, Subscriptions, Security, Audit, Legal, Finance-ops. Talks to `/admin/*`, `chakusa-api.onrender.com`. | **Not** the operator app. The roadmap forbids exposing platform-admin surfaces to normal businesses. |
| `website/` | Astro 5 (static + inline `<script>` islands) | Marketing site (`index`, `pricing`, `features`, legal…) **plus a partially scaffolded business dashboard**. | This is where the operator web experience lives. |
| `website/src/pages/dashboard/business.astro` | Astro page + inline script | The one wired operator page — fetches `auth.chakusarecovery.com/v1/dashboard`, renders metrics + recent activity + recovery snapshot. Works. | The seed of #22. |
| `website/src/pages/dashboard/business/*.astro` (13) | Astro stubs | `automation, bookings, customers, invoices, leads, messages, payments, quotes, reminders, reports, reviews, setup, team` | Shells — not wired to data. |
| `website/src/pages/dashboard/client/*` (5) | Astro | Customer-side dashboard (account, bookings, businesses, invoices, notifications) — separate realm. | Out of #22 scope (operator-focused). |
| `cloudflare/auth-gateway/worker.mjs` (358 lines) | Cloudflare Worker | The edge auth gateway `website/` uses. Realm-separated HttpOnly-cookie sessions, Turnstile, Google sign-in, cookie→bearer exchange, CSRF. | The API boundary for the web dashboard. |

## The gap

The auth gateway currently proxies only:

```
POST /v1/login  /v1/register  /v1/google  /v1/forgot-password  /v1/reset-password  /v1/logout
GET  /v1/dashboard                       (a read-only bundle)
PATCH /v1/business                       POST /v1/business/onboarding/complete
```

It exposes **none** of leads, customers, inbox/messages, quotes, invoices, payments,
team, inventory, calendar/appointments, AI settings, or reports. So 13 of the 14
operator pages have no data path. #22 "core operational parity for high-value
workflows" therefore needs, at minimum:

1. Expanding the gateway with a proxied `/v1/*` route per operator area (each with
   the gateway's session + CSRF + realm enforcement).
2. Building out the 13 Astro pages against those routes — capability-aware
   (reuse the backend capability matrix via the identity the gateway returns),
   responsive, keyboard-navigable, accessible.
3. A UI/gateway regression approach (`website/` has no UI test harness today;
   `cloudflare/auth-gateway/worker.test.mjs` covers the gateway only).

## Why this is an owner decision (OA-6)

- **Approach**: continue as Astro pages + inline islands vs. a React island app for
  interactive CRUD; which design system (mobile's M3 kit, `admin/`'s components, or
  new).
- **Gateway expansion** is the bulk of the backend-adjacent work and should be
  reviewed as one architectural unit.
- **V1 scope**: which workflows are the "high-value" parity set for the first cut.
- **Verification**: UI correctness across ~13 screens cannot be self-verified by the
  agent; the test strategy needs a decision.

Each of these is a materially-different, hard-to-reverse product/architecture choice
— exactly the class of decision `CLAUDE.md` says to stop for.

## Recommendation

Have the owner set OA-6 (1)–(3). Meanwhile **#23 Production Hardening** is fully
backend (worker reliability, outbox guarantees, webhook replay defense, rate limits,
DB/index + N+1 audit, pool/timeouts, structured logs, health endpoints) — it does
not depend on #22 and is the next agent-executable stage if work should continue in
parallel with the #22 decision.

## Next

Owner decision on OA-6, then #22 build. Or proceed to #23 in the meantime.
