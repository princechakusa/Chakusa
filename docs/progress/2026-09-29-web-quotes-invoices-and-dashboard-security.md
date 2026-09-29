# #22 follow-up — Web quotes & invoices, dashboard CSP, sign-in legal gate

**Status:** DELIVERED (browser click-through by the owner still recommended — no browser automation in this environment).
**Date:** 2026-09-29

## Baseline inspected

- `docs/progress/2026-09-10-stage-22-desktop-web.md` listed quote/invoice creation as deferred; web Quotes/Invoices were list-only and the list never showed amounts (read `item.total`; the API returns `totals.total`).
- Backend `src/modules/quotes` and `src/modules/invoices` already provide the full lifecycle, each route running authenticate → requireBusiness → `requireCapability` → `assertFeatureAvailable` → Zod → tenant-scoped service with optimistic concurrency and server-side totals.
- The website is served from GitHub Pages (no response headers possible) and had no Content-Security-Policy.

## Architecture reused

No backend change. The web uses the existing API through the existing `cloudflare/auth-gateway` named-route allowlist. One shared component (`SalesDocument.astro`) serves both quotes and invoices; validation/payload logic lives in `website/src/scripts/salesDocuments.js` so it can be unit-tested against the backend schemas (same pattern as `capabilities.js`).

## Implementation

- **Pages:** `/dashboard/business/quotes/document` and `/dashboard/business/invoices/document` (`?id=<uuid>` to open, `?new=QUOTE|ESTIMATE` / `?new=1` to create). Lists gain "New quote / New estimate / New invoice" and a per-row **Open** link, and now show real amounts.
- **Quote actions:** draft create/edit/delete, send (returns the one-time customer link), issue new link, revise (new version + new link), cancel, and **create invoice from an accepted quote**.
- **Invoice actions:** draft create/edit/delete, send, issue new link, create Stripe payment link (only while a balance is outstanding), void, payments list.
- **Refunds are intentionally not on the web** — money leaving the business stays a mobile OWNER/ADMIN action; the gateway has no refund route.

## Security model (layers)

1. **Backend is the only authority** — capability, entitlement, tenancy, validation, concurrency and all money math are unchanged and re-checked on every call. The web never sends totals, currency, numbers or status (asserted by test).
2. **Gateway allowlist** — only named routes are forwarded; ids must be UUIDs; lifecycle actions are POST-only; collections are not deletable; refunds and unknown actions never match. `DELETE` added to the proxy/CORS for draft deletion only, still behind session + origin + `sec-fetch-site` checks.
3. **Dashboard Content-Security-Policy** (meta tag in `DashboardLayout.astro`): `default-src 'none'; script-src 'self'; style-src 'self'; connect-src https://auth.chakusarecovery.com; form-action 'none'; base-uri 'none'; object-src 'none'` + `no-referrer`. To allow this without `unsafe-inline`, `astro.config.mjs` now never inlines scripts or stylesheets. Verified on all 24 built dashboard pages: CSP is the first resource-governing element, zero inline scripts/styles/style attributes, and every dashboard script only contacts the gateway.
4. **Output safety** — all server data rendered via `textContent`/form values; customer links shown only if they are credential-free `https://` URLs, in a read-only field, never stored in the URL or storage.
5. **No silent data loss** — the backend treats an edit as a full replacement, so the editor re-sends lead/appointment/customer-profile links (profile only while the customer is unchanged) and works the tax rate back out of the stored tax amount, asking the user to confirm it.
6. **Size cap** — max 40 lines; payload size checked against the gateway's 32 KB cap before sending.
7. **Capability-aware UI** — controls hidden by role (usability only); a role without `quotes.manage` / `invoices.manage` gets a clear message.

Also in this session (commit `7624112`): the website sign-in no longer auto-records legal acceptance; the gateway checks `/legal/status` after every web sign-in and refuses (and revokes) the session until the user explicitly ticks the acceptance box.

## Migrations

None.

## Tests

- `cloudflare/auth-gateway`: 21/21 (4 new: route mapping, refund/unknown/bad-id/wrong-method refusal, DELETE preflight + session, cross-site DELETE rejected).
- `tests/web-sales-documents.test.ts`: 26 tests — web payloads parse with the backend `create/updateQuoteSchema` and `create/updateInvoiceSchema`; no server-owned fields; max-size document fits the cap; origins carried forward; tax-rate derivation; invalid input rejected; unsafe links rejected. `tests/web-capabilities.test.ts` still 4/4.
- `astro check` 0 errors; `astro build` 78 pages.

## Limitations

- No browser E2E (no Playwright in `website/`); owner click-through recommended.
- The tax **rate** is not stored by the backend; an edited draft's rate is derived from the stored tax amount and may need confirming.
- Refunds remain mobile-only by design.

## Owner actions

None new.

## Next

Remaining web gaps from the 2026-09-29 dashboard audit: service catalogue (prices/durations), business account settings (profile/password/delete account), client booking cancel, customer detail + calendar view, team invites/roles.
