# Web dashboard: session sign-out fix, plan-aware states, UX overhaul

**Date:** 2026-09-30. **Status:** DELIVERED.

## Owner-reported problems

1. "Invoices told me to return to sign in."
2. "Many dashboard pages are empty."

## Root causes

1. **Plan-locked features looked like sign-out.** A new business is on the Free plan, which includes none of invoicing, quotes, inventory, AI Receptionist, automations, messaging or team management. The API correctly answered `403 FEATURE_NOT_AVAILABLE`, but every dashboard page rendered *any* error inside a "Sign in required / Return to sign in" box. The API message also always said "Pro plan", even for Business-only features.
2. **Real sign-outs from concurrent refresh.** Dashboard pages fire 2-4 gateway requests at once. After the 15-minute access cookie expires, each request refreshed with the same refresh token; the API's (deliberate, tested) reuse detection then revoked the whole session family, signing the user out. The backend invariant is kept; the web now serialises renewal.
3. **Empty pages** were a new account with no data and bare "No records" lists.

## Fixes

- **Session gate** (`website/public/scripts/session-gate.js`, classic script in every dashboard `<head>` so it runs before any page module): every gateway request first awaits one `GET /v1/session`, serialised across tabs with the Web Locks API. The gateway's new `/v1/session` refreshes only when the access JWT is missing or within 90 s of expiry and returns `expiresIn`; the gate re-checks 2 minutes before expiry. Astro reordered module scripts, which is why this is a classic script.
- **Gateway error hints:** error responses now carry strictly-shaped `code`, `requiredPlan`, `feature` (whitelisted patterns only).
- **API:** `FEATURE_NOT_AVAILABLE` names the cheapest plan that includes the feature (Pro vs Business); subscription status adds the `inventory` flag.
- **Typed client errors + shared states** (`dashboardApi.ts`, `PageStates.astro`): signed out → "Please sign in again"; plan-locked → feature pitch, benefits and "Compare plans"; role without access → "You don't have access"; outage → "Something went wrong" with **Try again**. Every dashboard page now uses these (no page shows sign-in for a non-401).

## UX overhaul

- Grouped navigation (Today / Customers / Money / Automate / Insights / Business) with icons and **Pro/Business badges** on features outside the plan; top bar shows business, plan chip, user and role.
- New **overview**: getting-started checklist (hideable), four headline metrics linking to detail, today's schedule, suggestions, readable recent activity, quick actions.
- **List pages:** search, helpful empty states with the next action, primary/secondary actions.
- **Payments** rewritten in plain language; Stripe onboarding redirect restricted to `*.stripe.com`.
- New **client home**: upcoming bookings, amount to pay, reward points, businesses with Book again.

## Tests

- Gateway 40/40 (session check: no refresh when fresh, one refresh when missing/near expiry, 401 when signed out; error-hint whitelist).
- Playwright mocked 19/19, including: locked feature shows upgrade (not sign-in), nav plan badges, real 401 shows sign-in, outage retry recovers, **session checked exactly once and before any other request**, empty-state CTA.
- Backend: entitlement/subscription suites green; new `feature-required-plan` test; typecheck + eslint clean.
