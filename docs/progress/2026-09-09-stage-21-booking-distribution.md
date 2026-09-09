# Stage #21 — Booking Distribution

**Status:** IMPLEMENTED — the unauthenticated public booking flow already exists
end-to-end (`/public/business/:slug` → availability → book → manage). This stage
adds the distribution surface: owner-facing shareable links, deep-link + QR
readiness, privacy-safe attribution, and Universal/App Links.
**Next stage:** #22 Desktop/Web.

---

## Baseline inspected (built, kept)

- `GET /public/business/:slug` — permanent-link public profile (services, hours,
  currency, minimal exposure), 30/min per IP.
- `GET /public/business/:slug/availability` — real `calculateAvailability`, no auth,
  60/min.
- `POST /public/business/:slug/book` — creates the appointment via the shared
  `createAppointment` (conflict engine reused), issues a hashed one-off
  `PublicBookingAccess` management token, sends the confirmation. 8/min.
- `GET/POST /public/business/:slug/bookings/:token[...]` — resolve / confirm /
  cancel / reschedule / `calendar.ics` / `payment-link`, all token-gated, 8–30/min.
- `POST /public/business/:slug/contact` — public enquiry → lead.
- `public-booking.test.ts` covers the booking + management lifecycle.

## Architecture reused

`publicSlug`, `calculateAvailability`, `createAppointment` (+ its conflict engine),
`PublicBookingAccess` tokens, `PUBLIC_REVIEW_BASE_URL` (the shared customer web
origin, already production-required), the per-route `@fastify/rate-limit` config.
**No second booking engine.**

## Gaps found and closed

### A — No owner-facing shareable links
Nothing gave a business its own booking URL(s) to put on a card, a story, or a QR.

- `src/lib/publicBookingLinks.ts` — `buildPublicBookingUrl(slug, { serviceOfferingId?, source? })`
  → `<PUBLIC_REVIEW_BASE_URL>/book/<slug>[?service=…][&src=…]`. One place the
  customer-facing shape is assembled.
- `GET /business/booking-links` (authenticated, `requireBusiness`, tenant-scoped) →
  `{ slug, configured, business:{name,url}, services:[{id,name,url}] }` for every
  active + publicly bookable service. The client renders QR / share sheets from
  these URLs and appends `?src=` per surface.

### B — No distribution attribution
A public-link booking was indistinguishable from a staff booking
(`bookingChannel` defaulted to `"business"`).

- `createPublicBookingSchema` gains `source?: enum(link|qr|profile|social|widget|other)`
  — a **fixed, non-identifying** label set: no free text, and no referrer / User-Agent
  / IP is captured.
- `createPublicBooking` writes `bookingChannel = "public_" + (source ?? "link")` onto
  the appointment — so existing appointment reporting (`bookingChannel`) now
  segments public bookings by surface with zero new PII.

### C — No Universal / App Links
A tapped `/book/<slug>` link always opened the browser.

- `src/modules/wellKnown/wellKnown.routes.ts`, registered at the API root:
  `GET /.well-known/apple-app-site-association` and `GET /.well-known/assetlinks.json`.
  Fully config-driven (`IOS_UNIVERSAL_LINK_APP_ID`, `GOOGLE_PLAY_PACKAGE_NAME`,
  `ANDROID_APP_LINK_SHA256`) — **404 until the owner supplies the identifiers**
  (OA-5). AASA claims paths `/book/*` and `/r/*` (booking + review links).
  Served as `application/json`, generous rate limit, no auth.

## Deep-link / service-specific links

`?service=<id>` on the shared URL deep-links straight to one service. No backend
change was needed for the flow itself — `/availability` and `/book` already take
`serviceOfferingId`; the link builder + the owner endpoint make the deep link
discoverable and shareable.

## Config (no schema change)

- `IOS_UNIVERSAL_LINK_APP_ID` — `<TeamID>.<bundleId>`, regex-validated, optional.
- `ANDROID_APP_LINK_SHA256` — comma-separated cert SHA-256 fingerprints, optional.
- Android package reuses the existing `GOOGLE_PLAY_PACKAGE_NAME`.
- Booking-link origin reuses `PUBLIC_REVIEW_BASE_URL`. No new base-URL env.

## Authorization / privacy / abuse

- `/business/booking-links` is `authenticate` + `requireBusiness`, business-scoped.
- Public booking / availability / management routes are unchanged — token-gated,
  minimal-exposure, per-route rate limited (8/min on `book`, verified by a new
  abuse test that drives it past the limit and asserts `429`).
- Attribution is a closed enum of surface labels — no identifying metadata.
- Well-known docs expose only the app identifiers the owner configured.

## Tests

`tests/booking-distribution.test.ts` (8):
- owner link endpoint: business + per-service URLs, only publicly bookable services,
  service URL = `…/book/<slug>?service=<id>`.
- unauth → 401/403; tenant-scoped (each business its own slug).
- **E2E**: parse the shared link → `/availability` → `POST /book` with `source:"qr"`
  → appointment persisted with `bookingChannel:"public_qr"`.
- attribution defaults to `public_link`; `source:"social"` → `public_social`;
  unknown source → 400.
- well-known docs 404 until configured; serve OS-spec JSON (correct `appID` + paths,
  `android_app` package + split fingerprints, `application/json`) when configured.
- abuse: the public `book` route rate-limits (`429`) past 8/min.

**Results (test DB, PG 16.15):**

- Backend `tsc --noEmit` — clean. Backend `tsc -p tsconfig.test.json --noEmit` — clean.
- `tests/booking-distribution.test.ts` — **8/8 pass**.
- Regression (all pass, run individually / in small batches): `public-booking`,
  `public-business-profile`, `business-onboarding`, `appointments`,
  `customer-booking` (13), `marketplace-discovery-e2e` (4).
- Note: a 7-file parallel batch produced 4 spurious failures (`Internal server
  error` on registration, `resetDatabase` transaction timeout) — Postgres
  connection-pool exhaustion from running that many heavy suites concurrently on
  this machine, not a regression; every file passes on its own.
- No mobile changes in this stage.

## Owner actions

**OA-5** (new, non-blocking): supply `IOS_UNIVERSAL_LINK_APP_ID`,
`GOOGLE_PLAY_PACKAGE_NAME`, `ANDROID_APP_LINK_SHA256`, and add the Associated
Domain / autoVerify intent filter at native build time, for links to open the app.

## Limitations / deferred

- **No `<iframe>` embed / widget** — the roadmap gates this on "existing web
  architecture" and there is no first-party web booking UI in this repo. The
  `widget` source label is reserved for when one ships.
- **No QR image generation server-side** — the endpoint returns the URL; the client
  renders the QR (keeps a barcode lib out of the API).
- **No short-link / redirect service** — links are `…/book/<slug>`, not a 6-char
  code. A `Business.publicSlug` is already short and human-readable.
- The `/book/<slug>` path is a **frontend** route; this stage assumes the customer
  web app serves it (same origin as `PUBLIC_REVIEW_BASE_URL`, as reviews already do).

## Next stage

#22 Desktop/Web.
