# #22 follow-up — Web dashboard completion, batch 2

**Status:** DELIVERED (owner browser click-through pending; no browser automation here).
**Date:** 2026-09-30

## Scope

Continues the 2026-09-29 web dashboard audit. Everything reuses existing backend APIs through the auth gateway's named-route allowlist; the backend stays the sole authority for session, tenancy, capability, entitlement, validation and money.

## Fixes found while building

| Area | Problem | Fix |
|---|---|---|
| Web sign-in (Google) | The page tracked which Google button was clicked with a `pointerdown` listener, but Google renders its button in a cross-origin iframe, so the listener never fired and the credential callback silently did nothing. Matches the owner's "can't sign in" report (no request ever reached the gateway). | Each button now sets `state=<realm>` (echoed back in the credential response) plus `click_listener`; a visible message replaces the silent return. Login and create-account pages. |
| Gateway error messages | Gateway read `payload.message`, but the API returns `{ error: { message } }`, so every specific API message was replaced by a generic one. | `upstreamErrorMessage()` reads the real shape (bounded to 300 chars; 5xx still generic). |
| Setup wizard (data loss) | Re-finishing the web Settings wizard re-ran the legacy service-name sync, archiving/reordering every service not typed into the wizard. | Backend: legacy sync runs only on **first** onboarding completion. Web: after completion the services step points to the Services page. Test added. |
| Team invitation email (phishing) | Business and inviter names were interpolated into the email HTML unescaped, letting an owner inject links/markup into mail Chakusa sends to any address. | Shared `src/lib/html.ts` (`escapeHtml`, `singleLine`); subject flattened and bounded. Tests added. |
| Weekly reports (authorization) | `GET /weekly-reports` (revenue, outstanding balances) had no capability check, so STAFF could read it. | Now requires `financial.report.view` (OWNER/ADMIN). Authorization-matrix test extended. Mobile does not call this route. |
| Customer records | No length limits on name/phone/email/notes. | Bounded (200/40/254/5000), trimmed. |
| Team page | Always showed "no members" (read `data.members` from a plain array). | Rewritten. |

## New web capabilities

- **Services** (`/dashboard/business/services`): catalogue with prices, durations, buffers, deposits, online-bookable flag, staff assignment, archive/restore. Gateway: POST/PATCH/DELETE (DELETE archives).
- **Your account** (`/dashboard/business/account`): name, change/set password, delete account (password + typed confirmation). Client account page gains **Close account**.
  - Gateway `accountAction` handler: never retries a 401 caused by a wrong password (would double-spend the API attempt limit), refreshes only on an expired token, clears both session cookies on deletion, realm-locked.
  - Google/Apple-only accounts are directed to the app for deletion (re-auth needs the provider SDK, which the strict dashboard CSP does not allow).
- **Customer profile** (`/dashboard/business/customers/profile`): facts, editable contact details (capability-gated), bookings, communication timeline, New quote / New invoice shortcuts.
- **Calendar** (`/dashboard/business/calendar`): week view, previous/next/today, links to customer profiles.
- **Team**: invite (email + one-time link returned by the API as `inviteUrl`), revoke, change role, remove, reactivate, seat usage. **Ownership transfer intentionally not on the web.**
- **Support requests**, **Needs attention** panel on the overview, **weekly report detail**.
- **Client**: cancel booking (only when the API reports `canCancel`), invoice detail + **Pay** (redirects only to `https://checkout.stripe.com`), **Book again** links to the business's public page.

## Security layers (unchanged principles)

Backend authority → gateway named routes (UUID-only ids, method-exact, no refunds, no ownership transfer, no generic proxy) → strict dashboard CSP (`script-src 'self'`, `connect-src` gateway only) → textContent-only rendering → https-only links (Stripe host-locked for payments) → capability-aware UI.

## Tests

- Gateway: 31/31 (account actions: wrong password not retried, deletion clears cookies, expired token refreshed once, realm lock; route maps for services, customers, team, client invoices).
- Vitest: `web-service-catalog`, `web-sales-documents`, `web-capabilities`, `team-invitation-email`, `business-onboarding` (new re-completion test), `authorization-matrix` (weekly reports).
- `astro check` 0 errors.

## Limitations / next

- Remaining mobile-only areas: loyalty, message templates, commissions, dispatch, CSV imports, external calendar sync, notification preferences, subscription (Pro) management.
- Local full-suite run requires Docker Postgres (`chakusa_test`).
