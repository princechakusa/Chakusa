# Stage #19 — Marketplace & Discovery Completion

**Status:** IMPLEMENTED — audit confirmed the discovery + booking subsystems are
substantially built and correct; closed the gaps that stood between them and the
stage's completion criterion.
**Next stage:** #20 Reputation & Review Growth.

---

## Baseline inspected (built, kept)

- **Discovery** (`src/lib/marketplace/discovery.ts`, `src/modules/marketplace/marketplace.routes.ts`):
  browse / featured / recent / popular / verified / nearby modes; search by name,
  industry, description, tagline, city and service name; `search/suggestions`;
  category browse with an industry→category taxonomy; cursor pagination; verified /
  active / `listed`+`discoverable` filtering; per-page batched rating, loyalty and
  membership badges; empty states. Customer actions: favourite, follow, report
  (`spam`/`inappropriate`/`scam`/…), share, recently-viewed, promotions.
- **Business profile** (`getMarketplaceBusinessProfile`): about, address, opening
  hours, photos, social links, services, team, promotions, review summary + recent
  reviews, loyalty/membership, viewer favourite/follow flags. No availability or
  slots (correct — that lives on the booking surface).
- **Booking** (`src/modules/customer/booking.routes.ts`, `src/lib/booking/customerBooking.ts`):
  `GET …/businesses/:slug/services`, `…/availability` (delegates to the real
  `calculateAvailability` engine), `POST /customer/bookings` (delegates conflict
  checks to `createAppointment`), list / detail / reschedule / cancel / `.ics`.
  Tenant-scoped via `resolveBookableBusiness` (honours `listed`/`discoverable`).
- **Admin curation** (`marketplaceAdmin.service.ts`): `featured` / `featuredRank`
  are editorial, set only through `adminUpsertListing` behind `marketplace.manage`
  RBAC + audit. No payment hook → not pay-to-rank. Left as-is.
- Tests already covering most of the above: `marketplace.test.ts`,
  `customer-booking.test.ts`, `public-business-profile.test.ts`.

## Architecture reused

All of it. No schema change. No new module. `PlatformChannel`, categories taxonomy,
availability engine, appointment conflict engine, RBAC, cursor pagination — untouched.

## Gaps found and closed

### A — Discovery never said whether a business could actually be booked
A discovery card and the marketplace profile advertised services but gave no signal
that online booking was possible, so a customer could tap through to a business with
zero `publiclyBookable` services and hit a dead end — breaking the
"discovery → … → booking" path the stage is meant to complete.

- `serializeCard` now emits **`acceptsOnlineBooking`**, derived from a per-page
  batched `groupBy` on `ServiceOffering` (`active AND publiclyBookable`) — one extra
  query for the whole page, never per card.
- `getMarketplaceBusinessProfile` emits `acceptsOnlineBooking` (from the services it
  already loads) and the per-service `bookable` flag keeps driving the per-service
  CTA (comment corrected from "informational only — booking is a later loop").
- New **`?bookableOnly=true`** filter on `/customer/marketplace`, `…/search`,
  `…/nearby`, `…/categories/:slug` → `serviceOfferings: { some: { active, publiclyBookable } }`.
  This is "availability-aware, but only when backed by real availability" — a real
  config check, not a fabricated open/closed badge.

### B — Default browse order was pure alphabetical
`orderFor(undefined)` was `ORDER BY name ASC` — not a ranking. Replaced with
**verified first (NULLS LAST), then most-recently onboarded, then name** as the
stable cursor tiebreaker. All real indexed columns; no engagement/pay signal in the
default (engagement-weighted ordering stays the dedicated `popular` mode, which
requires a listing row so its counters are never NULL — a relation-scalar
`ORDER BY … DESC` puts NULLs first in Postgres, which would wrongly rank
listing-less businesses above engaged ones).

### C — Category-browse pagination could return a short page
The industry→category mapping is not SQL-expressible, so category browse post-filters
in memory after `take: limit + 1`. Widened the fetch window to `(limit + 1) * 4` for
the category path to make a short page unlikely. A faithful fix (denormalise the
resolved category, or paginate-until-full) is logged in the roadmap deferred-cleanup
register.

## Completion criterion — "discovery → business → service → availability → booking E2E, tenant/public-data boundaries, performance tests"

New `tests/marketplace-discovery-e2e.test.ts`:

- **E2E**: customer searches the marketplace → reads the business profile → picks a
  bookable service → gets real availability slots → `POST /customer/bookings` (201,
  attributed to the profile) → sees it in `GET /customer/bookings?scope=upcoming`.
- **Public-data boundary**: suspended and `discoverable:false` businesses are absent
  from the list and 404 on their profile; the owner account email never appears on a
  card or in the profile; the profile carries none of `ownerId` / `subscription` /
  `stripeCustomerId` / `platformStatus` / `internalNotes`.
- **Tenant boundary**: a business (non-customer) session is rejected from the
  customer marketplace.
- **Performance / N+1 guard**: with a Prisma `$use` operation counter, discovery
  query volume is flat (Δ ≤ 2 ops) between a 4-result and a 15-result page and
  bounded (≤ 14 ops) — proves the rating / loyalty / membership / bookable lookups
  stay per-page-batched, not per-card.

Plus in `tests/marketplace.test.ts`: `acceptsOnlineBooking` reflects real
`active + publiclyBookable` services (and ignores inactive / non-public ones);
`?bookableOnly=true` filters correctly; default ranking puts verified first then
newest; the profile exposes `acceptsOnlineBooking`.

**Results (test DB, PG 16.15):**

- Backend `tsc --noEmit` — clean. Backend `tsc -p tsconfig.test.json --noEmit` — clean.
- `tests/marketplace-discovery-e2e.test.ts` — **4/4 pass** (E2E, public-data boundary,
  tenant boundary, N+1 guard).
- `tests/marketplace.test.ts` — **19/19 pass** (incl. the 4 new #19 tests).
- Regression: `tests/customer-booking.test.ts`, `tests/public-business-profile.test.ts`
  — pass unchanged.
- One iteration: the first default-ranking attempt ordered by the relation scalar
  `marketplaceListing.favouriteCount desc`, which puts listing-less businesses
  (NULL) *first* in Postgres — ranking them above engaged businesses. Dropped the
  engagement terms from the default order (verified + recency only); engagement
  ordering remains the `popular` mode.
- No mobile changes in this stage.

## Authorization / privacy

- All discovery + booking routes stay under `authenticateCustomer`; every query is
  business-scoped and honours `listed`/`discoverable`/`platformStatus`.
- Location-aware discovery still works at city/area granularity without coordinates
  (`?city=`), and `nearby` needs explicit `lat`/`lng` supplied by the client — no
  precise location is required or stored for discovery.
- No pay-to-rank: `featured` remains admin-only editorial curation.

## Files changed

- `src/lib/marketplace/discovery.ts` — `bookableBusinessIds` batch helper;
  `acceptsOnlineBooking` on cards + profile; `bookableOnly` filter; default ranking;
  wider category fetch window.
- `src/modules/marketplace/marketplace.routes.ts` — `bookableOnly` query param
  threaded through discovery / search / nearby / category routes.
- `tests/marketplace.test.ts` — 3 new discovery tests + 1 profile test.
- `tests/marketplace-discovery-e2e.test.ts` — new (E2E + boundaries + performance).
- `docs/CHAKUSA_AUTONOMOUS_MASTER_ROADMAP.md` — deferred-cleanup register: no-show
  item marked DONE (#18); category-pagination item added.

## Limitations / deferred

- Category-browse short-page edge case (register item above).
- Default ranking is trust + freshness, not rating-weighted — rating is not
  denormalised onto the listing; adding `ratingAvg`/`ratingCount` counters is a
  candidate for #20 (Reputation) where the feedback write path is already in scope.
- No full-text index — search is `contains`/`ILIKE`. Acceptable at current scale;
  a `pg_trgm` / tsvector index is a #23 hardening candidate.

## Next stage

#20 Reputation & Review Growth.
