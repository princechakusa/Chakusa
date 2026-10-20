# 2026-10-20 — Premium marketplace: map-first Explore, photo business pages, Ask the business; instant launch; reset hardening

**Stage:** #19 Marketplace & Discovery Completion (follow-up) + startup and auth hardening.
**Status:** Implemented and tested; device QA on Android release build; iOS via TestFlight.

## Baseline inspected
- Listings already carried photos (admin-only) and coordinates; discovery cards showed only the small logo.
- No customer -> business direct messaging (only the AI assistant); business inbox (#18) existed.
- Launch: a remembered side reopened its sign-in form when signed out; returning users waited on `/me` (API cold start) before seeing anything.
- Password reset: hashed single-use tokens, TTL, session revocation, non-enumerating text - but per-IP limits only, email sent before replying (timing leak), no change notice, token left in the page URL.

## Architecture reused
Marketplace discovery/profile services, public photo route pattern, inbox `Conversation`/`Message`, customer notifications + push, Leaflet map, SecureStore, auth services. No new vendor; Google Places is optional and off by default.

## Implementation
- **Gallery:** `business_gallery_photos` (bytea, magic-byte sniffed JPEG/PNG/WebP, 700 KB, 12 max, row-locked cap), immutable public route, owner screen (upload 1600 px, cover, remove).
- **Ask the business:** one in-app thread per customer per business (`contextType = CUSTOMER_APP_INQUIRY`); business replies in-app from the inbox; push both ways; customers only see in-app messages; blocks and hourly flood cap.
- **Google ratings (OA-17):** place ID only stored; live rating with attribution; "also nearby" list excluding places already on Chakusa; never on the OSM map.
- **Explore:** full-screen map with rating pills, synced photo-card strip, list view with photo carousels; opens on the customer's area only if location was already granted.
- **Business page:** full-bleed gallery, Chakusa + Google ratings, quick actions, services with Book, photo grid + viewer, sticky Ask / Book.
- **Startup (both platforms):** welcome page unless the remembered side is signed in; keychain/keystore profile snapshot for instant open with background `/me` (unauthorized still signs out and clears it).
- **Reset hardening:** see commit `e97620e`.

## Authorization / tenant / security
Gallery writes need `business.settings.manage`; replies need `messaging.operate`; every query is scoped by `businessId` or `contextId = customerProfileId`. Public photos follow the profile visibility rule. Map labels are DOM text, never HTML. The snapshot grants nothing; tokens still authorise every call.

## Migrations
`20261020120000_marketplace_gallery_inquiries` (additive): new table, `businesses.google_place_id`, conversations context index. Verified with `prisma migrate diff` = empty.

## Tests
- Backend: new `marketplace-gallery-inquiries` (10) and `password-reset-hardening` (3); related suites green; full suite run before push.
- Mobile: 603/603; typecheck clean; map selection/escaping tests added; experience-resolution test updated for the new launch rule.
- E2E: Explore journey updated for map-first layout (same assertions: distance, radius, map render, place search).

## Owner actions
OA-15 (reset email), OA-17 (Google Places key), gateway deploy (from 2026-10-20 release report).

## Next
Release-build device QA of Explore, business page, messaging and launch on Android and iOS (TestFlight).
