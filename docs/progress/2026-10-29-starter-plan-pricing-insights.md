# Starter plan, admin-set pricing, new Subscription and Business Insights screens, subscription-bypass hardening

**Status:** complete and tested. Store-side products and prices are owner actions (OA-18). No new mobile build yet; builds follow this commit.

## What the owner asked for

- Plans **Starter $3, Pro $8, Business $13**; **7-day free trial on Starter**.
- Prices and trial days never hard-coded: they come from the admin console's App configuration.
- A Subscription screen that is easy to understand and shows your own plan plus the other plans.
- Business Insights that look premium and are easy to understand.
- Dead code cleaned up.
- No one can get around paying for a subscription.
- Screenshots of the Subscription screen, Business Insights and the website pricing page.

## Baseline inspected

- `src/lib/entitlements.ts` (feature and limit tables, status-sensitive features), `src/plugins/tenant.ts` (per-request plan), `src/lib/billing/*` (Apple/Google verification, product catalog, reconciliation, complimentary grants), `src/modules/subscription/*`, `src/modules/appConfig/*`, admin console settings page.
- Mobile `domain/billing.ts`, `state/BillingContext.tsx`, `ProScreen.tsx`, `InsightsScreen.tsx`; website `pricing` components and `siteConfig.ts`.
- The previous agent's uncommitted work (handoff `docs/HANDOFF_2026-10-29.md`).

## Architecture reused

- One plan order (`PLAN_ORDER`/`planRank`) and the existing entitlement tables; `/plans` describes plans from the same tables that enforce them.
- Existing platform settings (admin App configuration) for prices and trial days; the public `/app-config` already feeds the website and apps.
- Existing store verification and reconciliation; Starter is just another catalog entry.

## Implementation

### Plans and pricing
- `Plan` enum gains `STARTER` (additive migration `20261029120000_starter_plan`). Starter: Free's tools with roomier limits (150 leads/month, 1,000 customers, 150 review requests, 150 reminders, 3 templates per type, 1 seat) and extended history; nothing that sends messages or acts for the business.
- Admin-editable settings: `app.price_currency`, `app.price_starter_monthly` (3), `app.price_pro_monthly` (8), `app.price_business_monthly` (13), `app.trial_days_starter` (7), `app.trial_days_pro` (0), `app.trial_days_business` (0). Public `GET /plans` returns limits, features, reference price and trial days.
- In the apps, the price charged and shown is always the store's own price. When the store has no price to show (web preview, product not live yet), the plan card falls back to the admin-configured reference price.
- Website: prices and trial days render from `/app-config` and plan contents from `/plans`; `data/pricingDefaults.ts` is the only fallback (used until the API answers). All "14-day" copy is replaced by the configured trial length.

### Subscription screen (`mobile/src/screens/ProScreen.tsx`)
- "Your plan" card on top (plan, status, renewal date, payment-problem and non-renewal notes, manage/cancel in the store).
- All three plans below, each with price, tagline, trial badge, what it includes (from `/plans`) and one clear button: Start 7-day free trial / Subscribe / Upgrade / Switch (downgrades open the store's subscription settings) / Your current plan. Restore purchases and the legal links stay.

### Business Insights (`mobile/src/screens/InsightsScreen.tsx`)
- Hero with this month's recovered revenue and the change versus last month, plus new leads, new customers and reviews.
- "What to do next" action cards ranked Do first / Important / Worth doing.
- Six-month chart with metric tabs and month-over-month change; money tiles; best services; customer lifecycle bar; customers who haven't been in for a while; "How Chakusa is helping" meters.
- Coaching copy is now written in the business's own currency (`$1,614` instead of `$1614.00`, `€` for euro businesses).

### Security: nobody keeps a paid plan without paying
Audit findings and fixes:

1. **Lapsed subscriptions kept paid limits (fixed).** `Subscription.plan` keeps the last purchased plan after expiry. Only three features checked status; usage limits and the other paid features read the plan alone. A cancelled Starter trial or a lapsed Pro plan kept its paid limits indefinitely. New `resolveSubscription()` in `entitlements.ts` is now the single source of the *effective* plan: anything not ACTIVE/TRIALING/GRACE_PERIOD is FREE. It is used by tenant resolution (every authenticated request), `/subscription/status` (features and limits; the purchased plan is still reported so the app can say it expired), automation scheduler/executor, workflow runtime and messaging gateway, appointment reminders, review automation, the AI customer agent, public booking, public profile and team invitations (seat limits).
2. **Lost store notifications (fixed).** No sweep existed, so a missed "expired" notification left a row ACTIVE forever. A store-managed period that ended more than 3 days ago with no renewal on record (31 days for a grace period) now resolves to FREE/EXPIRED. Owner-granted complimentary plans (no store) are unaffected.
3. **Ambiguous product IDs (fixed).** If Starter were configured with Pro's product ID, a $3 purchase would have unlocked Pro. A product ID that maps to two plans now resolves to nothing (fail closed).
4. Verified unchanged and sound: purchases are verified server-side with Apple/Google (bundle ID / package name, signed payloads), owner-only, bound to the caller's business; a receipt already linked to another business is refused (409); webhooks are signature/OIDC-authenticated; complimentary grants come only from a server environment variable; price/trial settings are display-only and admin-write needs `settings.manage` plus CSRF; the client never decides entitlement.
5. **Owner decision recorded (OA-20):** `APPLE_STORE_ENVIRONMENT` defaults to SANDBOX. Until it is set to PRODUCTION, sandbox purchases (only possible for owner-invited TestFlight and Play license testers) unlock plans and real purchases are refused. Switch before public sale.

### Messaging that cannot be sent is prepared instead
Production WhatsApp uses Meta's test number and SMS is off, so a store reviewer sending a campaign could hit failed messages. The public `/app-config` now publishes `features.outboundMessaging`: true only when the API has an enabled, configured SMS or WhatsApp sender (same pattern as `passwordReset`). The app combines it with the plan's `outboundMessaging` entitlement in `PlanExperienceContext`, so the Reviews and Comeback screens fall back to their existing "Prepare messages" flow when the server cannot send. Older API versions without the flag count as able to send. Turning WhatsApp off for review is OA-21.

### 18+ age confirmation (owner decision: 18+ for everyone)
- **Server, account creation:** `/auth/register`, `/customer/auth/register` and new accounts through `/auth/google`, `/auth/apple`, `/customer/auth/google`, `/customer/auth/apple` (including team-invitation sign-ups) are refused unless the request carries `ageConfirmed: true` (`AGE_CONFIRMATION_REQUIRED`, 400). Nothing is created on refusal. New column `users.age_confirmed_at` (additive migration `20261029160000_user_age_confirmation`) records when it was given. Existing accounts signing in through Google/Apple are not refused by the API.
- **Server, Terms:** accepting the Terms of Service requires `ageConfirmed: true`; it is stored on the immutable acceptance row (`metadata: { ageConfirmed: true, minimumAge: 18 }`). Other documents are unaffected.
- **App:** a required "I confirm I am 18 or older" tick on the business sign-in/sign-up screen, the customer sign-in/sign-up screen, and the shared form used for team invitations; email, Google and Apple are all blocked until it is ticked. The "updated Terms" screens (business and customer) ask for it before the Terms can be accepted.
- **Website and auth gateway:** the sign-up and sign-in forms have the same required tick; the gateway (`cloudflare/auth-gateway`) refuses sign-up, sign-in and Google without it before calling the API, and forwards it on registration, Google and every legal acceptance.
- **Legal text:** Terms and Privacy Policy now say 18+ (website pages and the default in-app documents).
- **Compatibility:** app builds older than this change (iOS 11, Android vc10) cannot create new accounts until updated; existing accounts keep working. The gateway must be deployed before the API (see OA-22).

### Sign out asks where
One "Sign out" button on the business and customer Account screens (and the customer legal gate) opens a sheet: "Sign out of this device", "Sign out of all devices", or "Stay signed in". The separate "Sign out of all devices" row is gone, and the business screen no longer uses native alerts, which do nothing on web. Customers can now sign out of all devices (the API route already existed).

### Maps compliance
- Address search in the location picker now runs only when the person presses Search or Enter. Nominatim's usage policy forbids search-as-you-type on its public API; the previous 600 ms auto-search was effectively that. Rate limit (1/s), caching, identifying User-Agent and attribution were already in place.
- Directions use a public Google Maps URL (no API key, no Google map drawn in the app), which Google permits. Map tiles come from the public OpenStreetMap server with attribution; moving to a tile provider before launch traffic is OA-23.

### Dead code removed
- Mobile: `futureCapabilities`, `trialExperience`, `activationJourney`, `dashboardAudiences`, `milestones` (+ tests), unrouted `SettingsCompletionScreen`, unused `ActivationJourneyCard`, `AudienceSummary`, `DashboardAudienceSummary`, `PublicProfileGrowthCard`, `ValueProofCard`, `useKeyboardHeight`, `milestoneStorage`, and the unused `canPurchasePlan`/`verifyPayload` helpers.
- Backend/website: unused imports and variables flagged by ESLint and `astro check` (both now report zero warnings).

## Authorization / tenant / security model

Backend stays authoritative. Plans change only through verified store purchases (owner-only, tenant-bound) or the owner's server-side complimentary grants. Every limit and feature check starts from the effective plan. Pricing settings are display-only and cannot grant access.

## Migrations

`20261029120000_starter_plan`: `ALTER TYPE "Plan" ADD VALUE IF NOT EXISTS 'STARTER' BEFORE 'PRO'`. Additive; runs with the normal `prisma migrate deploy`.

## Tests

- Backend: `npm run typecheck` clean, `npm run lint` 0 problems. Full suite: 1,809 of 1,810 passed. The one failure (`auth-foundation` refresh-token race) passes 3/3 on its own and touches no changed code; it is load-sensitive. New `tests/subscription-lapse-safety.test.ts` (lapsed and stale subscriptions resolve to Free over the API, active Pro is unaffected, duplicate product IDs fail closed), `tests/starter-plan-pricing.test.ts`, updated coaching tests (currency formatting).
- Mobile: `tsc --noEmit` clean; 613 tests in 66 files pass (new `planCatalog`, `insightsPresentation` tests).
- Website: `npm run build` (astro check + build): 0 errors, 0 warnings, 91 pages.

## Screenshots

The Subscription screen (Pro and Free accounts), Business Insights and the website pricing page were captured from a local web build with demo data and shown to the owner on 2026-10-29. At the owner's request they are not kept in the repository.

## Unresolved limitations

- Android purchases stay off until the owner sends the Google product IDs (OA-18).
- The stale-period safety net relies on the stored period end; a store that stops sending notifications entirely is caught after 3 days, not instantly.
- The mobile e2e specs have drifted from the current sign-in screen copy (placeholders changed); not part of this stage.

## Owner actions

OA-18 (store products, prices, Starter trial, Google product IDs, Render env), OA-19 (rotate the two pasted tokens), OA-20 (store environment before public sale), OA-21 (turn off test-number WhatsApp and add reviewer notes before store review), OA-22 (deploy the auth gateway before the API; publish the 18+ Terms and Privacy versions; store age declarations), OA-23 (map tile provider before launch traffic).

## Next

iOS build 12 via EAS with auto-submit to TestFlight, then Android versionCode 11 built locally; then roadmap #18.
