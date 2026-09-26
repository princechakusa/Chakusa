# Social sign-in fix, entry motion, "near me" location, full-app E2E

**Status:** COMPLETE (engineering). The Google and Apple sign-in code path is
fixed and verified up to the provider console boundary. The remaining
console steps are **OA-9** in `docs/OWNER_ACTIONS.md`.
**Date:** 2026-09-26 · **Roadmap position:** post-#26 owner-gate period;
this work supports #26 release readiness.

---

## 1. Google / Apple sign-in

### Baseline inspected
- Mobile: `services/googleAuth.ts`, `services/appleAuth.ts`, `state/AuthContext.tsx`,
  `customer/CustomerAuthContext.tsx`, both auth screens, `config.ts`, `eas.json`.
- Backend: `modules/auth/googleVerifier.ts`, `appleAuth.ts`, the auth and
  customer-auth routes. The Apple nonce is passed raw to Apple
  (`expo-apple-authentication` does not hash it) and compared raw
  server-side, so it is consistent end to end.
- Production API probed without credentials: `POST /auth/google` with a fake
  token → **401 GOOGLE_TOKEN_INVALID**, meaning the verifier is live (503 would
  mean "not configured"). `POST /auth/apple/challenge` → **200**. Both
  providers are enabled server-side.

### Root cause
Android is built locally on Windows, and local Gradle builds do **not**
receive `eas.json`'s `env` block. The 2026-09-23 release bundle had **no
API URL and no Google web client ID** inlined. Checked in the built Hermes
bundle. `publicFeatureEnabled()` treats an unset flag as *enabled*, so the
Google button showed and then failed with "not configured".

### Fix
- `mobile/scripts/eas-env.mjs`: runs any command with an `eas.json` profile's
  env applied. The profile wins over a stale shell, and Windows `.cmd` shims
  are handled. New scripts: `android:bundle-release`,
  `android:assemble-release`, `web:prod-config`.
- `withReleaseSigning` plugin (and the generated Gradle file): release builds
  **fail closed** if `EXPO_PUBLIC_API_URL` or
  `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` is missing.
- `socialSignInProviders()` (tested): Google shows only on iOS/Android and
  only when a web client ID is present; Apple shows only on iOS. Web no
  longer offers buttons that can only throw.
- Handoff doc updated with the build command and the two SHA-1s Google
  needs (upload key + Play App Signing). Those are owner console steps: OA-9.

## 2. Entry motion (first screen, launch, both sign-in screens)

- `experience/motion.tsx`: a motion kit built on React Native `Animated`,
  using the native driver. It needs no new native dependency, works on web,
  and honours the OS **reduce-motion** setting everywhere. Every animation
  is `isInteraction: false`: the first version's ambient loop held an
  InteractionManager handle and blocked the experience switch on web. The
  E2E suite caught it.
- **Welcome:** coral light blooms; the logo appears large centre-screen and
  lands in the header; CHAKUSA spells out; the headline rises word by word.
  The two choices spring up, and their feature chips pop in (real features
  only). Each arrow nudges once. On a choice, the chosen card lifts while
  the rest clears. Every beat has a job; nothing decorative loops except the
  soft ambient light.
- **Launch:** logo and pulse rings (a "working" signal) replace the bare
  spinner.
- **Sign-in (business and customer, shared `experience/AuthParts.tsx`):**
  - staggered entrance
  - the Personal/Business pill **slides** before switching experience
  - fields glow coral on focus
  - the create-account fields animate in
  - Google/Apple buttons with per-button progress
  - errors shake, and appear next to the buttons that caused them

## 3. Location: "near me" (free stack only)

Expo Location (device position), Nominatim (address lookups), and Leaflet
with OpenStreetMap tiles (map). No API keys, no cost.

- **Backend (additive, no migration; the listing table already had the columns):**
  - `PATCH /business` accepts `location`, which upserts the caller's own
    marketplace listing. It uses the existing `business.settings.manage`
    capability and is scoped by `request.businessId`. `null` clears the pin.
    `GET /business` returns it.
  - `lib/marketplace/geo.ts`: haversine distance. Nearby discovery now trims
    the bounding box to a **true radius**, ranks **nearest first**, and adds
    `distanceKm`. Cards carry the business's (already public) coordinates.
  - **Privacy:** request logs redact `lat/lng` query parameters
    (`lib/requestLogging.ts`). Verified against a real pino line. A
    customer's search position is never stored.
- **App:**
  - `services/geocoding.ts` follows Nominatim policy: 1 request/second,
    cached, and an identifying User-Agent on native.
  - `services/devicePosition.ts`: one foreground fix. No watching, nothing
    persisted.
  - `components/map/`:
    - `LeafletMap` (WebView on native, iframe on web). Its escaped,
      SRI-pinned page is tested.
    - `LocationPicker`: GPS, place search, or tap-to-pin. Save waits while a
      pin's address is still resolving. The E2E suite caught the race that
      saved bare coordinates.
  - Business → Business profile gets a "Business location" card.
  - Customer → Explore gets **Near me**: an area label, 5/15/50 km, list or
    map view, and "choose a place on the map". Cards show "3.5 km away".
  - Business profile shows a map and a free OpenStreetMap **Get directions**
    link.
- New native dependency: `react-native-webview` 13.16.1 (via `expo install`;
  Java/Kotlin only, so no NDK patch).
- iOS location purpose string updated to cover all three uses.
- The web map iframe must share the app origin. OSM's tile servers returned
  403 to the opaque-origin sandbox, which sends no Referer.

## 4. Bugs found by testing, and fixed

| Found by | Bug | Fix |
|---|---|---|
| Expo web + Chrome | Web app threw at startup: the attachment queue touched `expo-file-system` (unsupported on web) | In-memory queue on web |
| Playwright | `Alert.alert` is a **no-op on web** (90 uses): sign out, archive, delete etc. silently did nothing | `utils/webAlert.ts` maps it to browser confirm/alert (tested) |
| Playwright | Services list nested buttons inside a button (invalid; unreachable for screen readers) | Card split into a details button plus separate actions |
| Playwright | Ambient motion blocked `runAfterInteractions`, so experience switching stalled on web | `isInteraction: false` throughout |
| Playwright | OSM tiles 403 in the web map | iframe on the app origin (Referer sent) |
| Playwright | Location Save could store a pin before its address resolved | Save waits for the lookup |
| Accessibility scan | 9 screens' form fields had no accessible name; unlabeled add-client button; lead caller-mode toggle had no role/state; quote/invoice line inputs unnamed | Labels, role and state added |
| Review | Customer coordinates would be written to production request logs | URL redaction serializer |
| Review | "Harare, Harare" duplicate labels | De-duplicated |

## 5. Tests

- **E2E (new):** `mobile/e2e/`, Playwright in Google Chrome against Expo web,
  a local API, and a throwaway `chakusa_test` DB. See `mobile/e2e/README.md`.
  Two fresh accounts per run (business and customer), 17 tests covering
  every tab, all 24 business "More" destinations, the account screens,
  sign-up/in/out, location, booking, and the business seeing the booking.
  Every test fails on any page error, console error, or blocked map request.
  `npm run e2e` / `npm run e2e:watch` (visible, slowed).
- **Unit/integration (new):** backend `business-location-nearby` (6) and
  `request-logging` (2); mobile `places` (6), `leafletHtml` (5),
  `webAlert` (4), `mobileProduction` (+1).
- Results: see §7.

## 6. Owner actions
OA-9: Google Android OAuth clients (both SHA-1s); `GOOGLE_OAUTH_CLIENT_IDS`
includes the web client ID; Apple client ID = bundle ID; rotate the
Render/Supabase keys pasted in chat; store privacy wording for location;
map-provider scale (a future vendor decision, no cost now).

## 7. Results (2026-09-26)

| Suite | Result |
|---|---|
| E2E, Playwright in Google Chrome (Expo web + local API + test DB) | **17/17** (welcome and motion 6/6, journey 11/11; journey also green headless) |
| Backend vitest (isolated `chakusa_test` DB) | **122 files, 1589/1589**, plus `request-logging` 2/2 run separately |
| Mobile vitest | **55 files, 534/534**, plus new files (webAlert 4) |
| Typecheck | backend `tsc` clean; mobile `tsc` clean (includes e2e) |
| Lint | clean on all changed files (one pre-existing warning in LeadsScreen) |
| Repository secret check | passed; no pasted keys anywhere in tree or diff |
| Accessibility scan (every screen visited) | 0 unnamed buttons after fixes (checker negative-controlled) |

Pro-gated for a Free business, as designed: Quotes (dashboard Estimate),
Commissions, Inventory.

### Known limitations / not verified here
- **Not run on a physical device or native build this session.** Web covers
  the shared JS. Native-only paths are the real Google/Apple sheets and the
  WebView map. They stay a release-QA gate (roadmap rule), and the Google
  Android flow also needs OA-9 step 1.
- UX note: the dashboard "Estimate" shortcut lets a Free business fill in a
  whole quote before revealing it is Pro. Consider gating at entry. Left
  unchanged because it is a product decision.
- OSM/Nominatim are volunteer services, suited to current scale (OA-9 step 5).

---

## 8. Follow-up (same day): profile pictures, more flows, defects found

### Profile pictures
- **Business photo.** The owner could upload one, but customers never saw
  it, although the settings text promised it on the public page. Upload was
  also broken on web, and phone photos (2–5 MB) always hit the size limit.
  - `GET /public/business/:slug/photo` serves the photo as an image, with the
    same visibility rule as the public page (a public link and an active
    business) and cacheable.
  - A versioned `photoUrl` is added to the public profile, the Explore card
    and the in-app business profile.
  - Customers now see the photo on Explore and on the business profile.
- **Customer profile picture.** The `avatarUrl` column existed, but the API
  took only 2 KB links and there was no UI.
  - The API now accepts a validated image data URI (PNG/JPEG/WebP/GIF, up
    to 400 KB), an https link, or `null` to remove it. `javascript:`,
    `http:` and non-image data URIs are rejected.
  - Edit profile gets add, change and remove photo. The photo shows on the
    Account screen.
- One shared validator (`lib/imageDataUrl.ts`) now backs both pictures.
- The picker (`services/pickProfileImage.ts`) uses `expo-image-picker`
  (photo library only; the camera and microphone permissions are
  explicitly removed) and `expo-image-manipulator`. Any photo is cropped
  square and shrunk to 512 px JPEG (about 30–80 KB).
- Tests: backend `profile-pictures` (3); E2E for both pictures (business →
  customer sees it; customer → account).

### Defects found and fixed
- **Every bodyless DELETE in the app returned 500.** For example, "Stop
  sharing location" and removing blocked time.
  - The app's two API clients sent `Content-Type: application/json` on
    every request.
  - The API's custom JSON parser threw on an empty body, and the error
    handler reported that as a 500.
  - Fixed on both sides: the clients send the header only with a body; the
    parser treats an empty body as no body and malformed JSON as 400; Fastify
    4xx errors are no longer disguised as 500. Regression test:
    `request-shape-errors`.
- **Blank screen forever if the brand fonts failed to load.** The app now
  opens with system fonts after 4 s or on a font error. E2E check with all
  fonts blocked.
- Customer "Display name" input had no accessible name.

### New end-to-end flows (both accounts)
- Customer reschedules.
- The business confirms, marks "On my way" and **shares live location**,
  and the customer sees it on the embedded OpenStreetMap map (two browsers
  at once). The business stops sharing and completes the appointment.
- Customer books again and cancels.
- Business adds a service that the customer then sees.
- Business blocks time off and removes the block.
- Customer edits their name.
- Both profile pictures.

The live-location card on booking detail now embeds the Leaflet/OSM map
instead of linking out to Google Maps (post-V1 backlog: "embedded map").

### Test infrastructure
- The suite now runs against a **production web build** served statically
  (`npm run e2e:build` / `e2e:serve`) instead of `expo start`. On this
  machine the dev server took minutes per page under load; the static build
  takes about 1 s.
- Metro ignores generated output folders.
- Watch mode shows a caption naming the running test.
- Video is off; failures keep a screenshot and a trace.
