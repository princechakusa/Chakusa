# #22 follow-up — Web dashboard batch 3 + Chrome end-to-end testing

**Status:** DELIVERED. Date: 2026-09-30.

## Batch 3 features (web)

Business: Loyalty (programme settings, counter redemption lookup, rewards, members + point adjustments, campaigns, membership plans), Commissions (report + owner rules), Plan & usage (read-only), private calendar feed links, owner data export, message templates, customer CSV import. Client: Rewards wallet with redeem.

Intentionally mobile-only: dispatch / live location, historic appointment import, ownership transfer, refunds, subscription purchase (App Store / Google Play only).

## Security fixes in this batch (API)

- Loyalty PATCH routes validated nothing; now bounded like create (unknown keys stripped for mobile compatibility).
- Membership plans could include another business's services; campaigns could reference another business's reward. Both now verified against the caller's business.
- Campaign updates cannot end before they start; commission report range capped at one year.
- Gateway: per-route body cap (CSV import 256 KB, everything else 32 KB); `PUT` proxied for commission rules.

## Found by end-to-end testing

- **Nav capability gating never actually hid links**: the code set `hidden`, but `.dashboard-sidebar nav a{display:flex}` overrode it, so STAFF saw owner/admin menu items (the API still refused the actions). Fixed with a dashboard-wide `[hidden]{display:none!important}`; overview shortcuts to Settings are now capability-gated too.

## End-to-end suite (`website/e2e`, Playwright in installed Google Chrome)

- `npm run test:e2e:live` — every built page (90) loaded from production, signed out: status < 400, no uncaught errors, no CSP violations, no broken same-origin requests; every dashboard page ends on its sign-in/error state with no content rendered and carries the strict CSP. **90/90 passed.**
- `npm run test:e2e:mocked` — built site served locally, gateway answered by fixtures: attention queue + XSS escaping, STAFF nav gating, services validation + payload, quote editor payload (no totals/currency/status), https-only customer links, invalid ids never sent, team invite/roles for OWNER vs STAFF, account deletion confirmation + server error surfacing, calendar rendering, loyalty redemption, requests only to the gateway host, client pay redirects only to `checkout.stripe.com`, booking cancel only when `canCancel`, slug-validated book-again links. **14/14 passed.**
- Sign-in itself is not automated: Cloudflare Turnstile is deliberately not bypassed. Owner verifies live sign-in manually.

Run `npm run build` in `website/` first (the live suite enumerates `dist/`).

## Tests overall

Backend: full suite 1652/1653 earlier in the session (single failure was a mid-run edit race, re-run green), all touched suites green after each batch; typecheck + eslint clean. Gateway 36/36. `astro check` 0 errors.
