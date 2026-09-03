# Chakusa Mobile — one app, two experiences

_Program 2 · Loop 7 (customer foundation) · Loop 8 (customer loyalty) ·
Loop 9 (unified runtime experience router)._

## What this is

**Chakusa is ONE public app.** One installation, one bundle id, one store
listing. Inside it a person can use the **customer experience** (find &
book services, rewards) or the **business experience** (the original
owner app). The two are chosen at **runtime**, and their security
boundaries stay fully separate.

```
App.tsx
  └─ (web-only public routes short-circuit — unchanged)
  └─ ExperienceRouter               src/experience/ExperienceRouter.tsx
       ├─ <BusinessRoot/>           src/BusinessRoot.tsx   (exactly one
       ├─ <CustomerRoot/>           src/customer/CustomerRoot.tsx   mounted
       └─ <ExperienceSelectScreen/> src/experience/ExperienceSelectScreen.tsx  at a time)
```

`ExperienceRouter` holds **no token**. It reads a small preference
(`chakusa.experience.v1` — the string `customer` / `business`, nothing
else), probes whether each session store has something, classifies any
incoming deep link, then mounts one shell. `BusinessRoot` /
`CustomerRoot` own all auth, session, transport and navigation — the
router never touches them.

### Cold-start decision (`resolveInitialExperience`, pure + tested)

1. dev `EXPO_PUBLIC_APP_VARIANT=customer` override (internal builds only)
2. a trusted incoming deep link that names an experience
3. the saved `chakusa.experience.v1` preference
4. **existing-user migration**: exactly one session present → that
   experience (an existing logged-in business owner upgrading sees the
   business app immediately, never the selector)
5. otherwise → the experience selector

A corrupt/unknown preference reads back as "unselected" and never crashes.

### Switching

`useExperience().switchExperience('business' | 'customer')` (wired into
**Account → Switch to …** on both sides) persists the preference and
swaps the mounted shell. Each shell restores its own session on mount; if
there is none, that shell shows its own auth screen. Switching never
re-authenticates the other side and never carries a screen path across.

### Logout

Unchanged and independent: customer logout clears
`chakusa.customer.session.v1` only; business logout clears
`chakusa.auth.session.v2` only. The business "Sign out of all devices"
still only revokes business sessions. The other identity is never touched.

### Deep links & notifications

`classifyDeepLinkExperience(url)` (pure) → `customer` (via Loop 7/8's
`parseCustomerDeepLink`, which still refuses business routes) /
`business` (an allowlist) / `null` (unknown → no switch). At cold start it
biases the initial experience; at runtime, a link for the *other*
experience switches only when that experience already has a session.
`classifyNotificationExperience(data)` maps `data.experience` or a known
customer `data.category` to an experience, else `null` (never guesses from
title/body).

### Pending-intent handoff (Loop 10)

A validated incoming destination survives auth / legal / onboarding.

- `src/experience/pendingIntent.ts` (pure, tested) — `normalizeDeepLinkIntent`
  / `normalizeNotificationIntent` turn a raw link or a **structured**
  notification payload (`data.experience` / `data.category` /
  `data.loyaltyKind` / `data.deepLink` — never title/body) into a
  `PendingIntent { experience, source, route: string|null, params?, createdAt }`.
  Customer links go through `parseCustomerDeepLink` (guard intact); only
  `ResetPassword` / `TeamInvite` are navigable business routes, everything
  else business → `route: null` ("just enter business").
- `src/experience/pendingIntentStorage.ts` — persisted at
  `chakusa.pending-intent.v1`, **15-minute TTL**, re-validated on every
  read, `consumePendingIntent(experience)` clears then returns (exactly
  once; an intent for the *other* experience is left for its shell).
  Contains no token.
- `ExperienceRouter` writes the intent from `Linking.getInitialURL()` /
  `Notifications.getLastNotificationResponseAsync()` at cold start
  (terminated-state taps included), and from runtime `url` /
  notification-response events **only when they target the other
  experience** (then switches). Same-experience warm links stay with the
  shell's own `linking` config / `NotificationTapHandler` (unchanged).
- `usePendingIntentConsumer(experience, ready, navHandle)` runs inside each
  navigator. `ready` = `navContainer onReady` **and** that experience's
  gate is open (customer: `authenticated && !legalAcceptanceRequired`;
  business: `routes.main`). It fires once, skips if already on the target
  route, and never uses a timer.
- Explicit sign-out / account-close clears the pending intent;
  `session-expired` does **not** (it must survive re-auth).

### `APP_VARIANT` today

Retained as an **internal development override** only
([`src/config.ts`](src/config.ts)). Production never sets it and never
depends on it — the runtime router decides. The `eas.json` `customer`
profile stays for focused internal QA builds.

### Store identity

**One public Chakusa application.** No second bundle identifier, Android
package, App Store record, Google Play record or EAS project was created.
A future marketing rename, if wanted, is a store-side decision and is not
made here.

---

## Customer experience internals (Loop 7 / 8)

## Architecture (Stage 2 decision — Option C)

One codebase, a dedicated customer shell under
[`src/customer/`](src/customer/), switched at build time.

```
src/customer/
  session.ts                 namespaced customer token store
  customerApi.ts             self-contained transport → /customer/auth/refresh
  endpoints.ts               customer API clients bound to customerApi
  CustomerAuthContext.tsx    customer auth + secure session state machine
  push.ts                    customer Expo-token registration
  CustomerRoot.tsx           provider tree + NavigationContainer for the variant
  navigation/
    types.ts                 CustomerRootStackParamList / CustomerTabParamList
    CustomerNavigator.tsx    stack + bottom tabs (Home · Explore · Bookings · Account)
    customerLinking.ts       deep links, filtered through domain/customerNav
    customerNavigationRef.ts
  domain/
    customerNav.ts (+test)      deep-link parsing + customer/business boundary guard
    customerHome.ts (+test)     /customer/dashboard shaping
    customerLoyalty.ts (+test)  wallet/hub shaping, reward/redemption/membership
                                display, loyalty-notification deep-link mapping
  components/
    cards.tsx                BusinessCard (loyalty badges) · ServiceRow · BookingCard
    loyalty.tsx              PointsSummary · LoyaltyBusinessCard · TierProgressBar ·
                             RewardCard · MembershipCard · RedemptionCodeCard ·
                             ReferralProgressCard
  screens/                   Auth, LegalGate, LegalDocument, Home, Explore,
                             BusinessProfile, BookingFlow, Bookings,
                             BookingDetail, Account, EditProfile,
                             Notifications, Assistant, and the loyalty set:
                             Rewards (hub), LoyaltyBusiness, LoyaltyHistory,
                             RewardDetail, Redemptions, RedemptionDetail,
                             Memberships, MembershipPlans, Referrals
```

## Loyalty experience (Program 2 Loop 8)

Account → **My Rewards** opens `CustomerRewardsScreen`, the loyalty hub.
Every screen binds to an existing `/customer/loyalty/*` route (Program 2
Loop 5) through `loyaltyApi` in `src/customer/endpoints.ts` — same customer
transport, no business session.

| Screen | Route(s) |
| --- | --- |
| Rewards hub | `/customer/loyalty/wallet` |
| Business loyalty detail | `/customer/loyalty/accounts/:businessId` (+ `/enrol`) |
| Points history | `/customer/loyalty/accounts/:businessId/transactions` (cursor paginated) |
| Reward detail / redeem | `POST /customer/loyalty/accounts/:businessId/rewards/:rewardId/redeem` |
| Issued rewards + code | `/customer/loyalty/rewards` |
| Memberships | `/customer/loyalty/memberships` (+ `/memberships/:id/cancel`) |
| Membership plans / join | `/customer/loyalty/businesses/:slug/membership-plans` (+ `POST …/memberships`) |
| Referrals | `/customer/loyalty/referrals`, `/referrals/code`, `/referrals/redeem` |

Cross-surface: marketplace cards show Rewards/Membership badges
(`loyaltyBadge` / `membershipBadge`); the business profile shows a loyalty
block with a Join/View action; the booking flow shows server-computed
member prices; loyalty notifications deep-link into the customer loyalty
screens only (never business loyalty-management).

**Points are not money.** Each business's points stay with that business —
the hub copy says so explicitly. There is no cash-out, transfer, top-up or
stored-value anywhere.

**Membership takes no payment.** Loop 5 records the entitlement without a
charge; the app shows plan prices only alongside the statement that
Chakusa is not collecting the payment. No Stripe / Apple IAP / Google Play
Billing / card form / checkout.

Reused from the business app without modification: `src/theme.ts`,
`src/components/ui.tsx`, `src/domain/booking.ts`,
`src/domain/legalAcceptance.ts`, `src/services/googleAuth.ts`,
`src/services/appleAuth.ts`, `src/services/api.ts` (`ApiError` type only),
and the shared DTO types in `src/apiTypes.ts`.

## Session isolation

Token scope is kept completely separate:

| | Business | Customer |
| --- | --- | --- |
| SecureStore key | `chakusa.auth.session.v2` | `chakusa.customer.session.v1` |
| Push-token key | `chakusa.push.expo-token.v1` | `chakusa.customer.push.expo-token.v1` |
| Refresh route | `/auth/refresh` | `/customer/auth/refresh` |
| Transport | `src/services/api.ts` | `src/customer/customerApi.ts` |

`customerApi.ts` only ever reads/writes the customer session. A customer
build never imports `src/services/endpoints.ts`; a business build never
imports `src/customer/`. There is no code path in which a customer token
is attached to a business endpoint or vice-versa.

### Boundary guard

`domain/customerNav.ts` refuses to resolve any business-owner deep link
(`chakusa://dashboard`, `team-invite/…`, loyalty-management routes, …) to
a navigation action. `customerLinking.getStateFromPath` runs every
incoming URL through it, so a crafted link cannot land a customer on a
business screen.

## Backend

Every screen maps to an existing `/customer/*` route delivered by Program
2 Loops 1–5. No backend, schema or migration change was made in Loop 7.

| Screen | Route(s) |
| --- | --- |
| Auth | `/customer/auth/{login,register,google,apple,apple/challenge,me}` |
| Legal gate | `/customer/legal/status`, `/customer/legal/accept`, `/legal/documents/:type` |
| Home | `/customer/dashboard` |
| Explore | `/customer/marketplace`, `/customer/marketplace/search`, `/customer/marketplace/categories` |
| Business profile | `/customer/marketplace/businesses/:slug` (+ favourite / follow) |
| Booking flow | `/customer/bookings/businesses/:slug/{services,availability}`, `POST /customer/bookings` |
| Bookings / detail | `/customer/bookings`, `/customer/bookings/:id` (+ reschedule / cancel) |
| Account | `/customer/profile` (+ preferences, close account) |
| Notifications | `/customer/notifications`, `/customer/auth/devices` |
| Assistant | `/customer/ai/assistant/*` — shown only when `/customer/dashboard` reports the entry is enabled |

## Rewards

Loop 7 deliberately does **not** build the customer loyalty UI (that is
Loop 8). The "My Rewards" location exists in Account →
[`CustomerRewardsScreen`](src/customer/screens/CustomerRewardsScreen.tsx),
which states that the experience is being finished — it shows no
fabricated points or tier data.

## Deployment identity — requires owner decision

The [`customer` build profile](eas.json) sets `EXPO_PUBLIC_APP_VARIANT`
and disables billing, but **intentionally does not set a bundle
identifier or package name.** The repository has no convention for a
customer-app identity, and Loop 7 must not invent a production app
identifier.

Before a customer build can be distributed the owner must decide:

- iOS `ios.bundleIdentifier` / Android `android.package` for the customer
  app (a separate app record from `com.chakusa.mobile`), plus its own EAS
  project or a shared one;
- the customer app's display name, icon and store presence;
- whether Google/Apple client IDs are shared with the business app or
  minted per app.

Until then the `customer` profile is for internal builds only. Nothing in
Loop 7 was submitted to the App Store, Google Play or an Expo production
channel.

## Build & test

```bash
# customer variant, locally
EXPO_PUBLIC_APP_VARIANT=customer EXPO_PUBLIC_API_URL=… npx expo start

# EAS internal build
eas build --profile customer --platform android   # per build-environment rules
```

Gates (unchanged): `npx tsc --noEmit` and
`npx vitest run --config vitest.config.mjs`.
