# Chakusa Customer Mobile Application

_Program 2 · Loop 7 — foundation & core customer experience._

## What this is

The `mobile/` codebase now builds **two** applications from one Expo
project:

| Variant    | Who it is for            | Selected by                              |
| ---------- | ------------------------ | ---------------------------------------- |
| `business` | Business owners & staff  | default — nothing set                    |
| `customer` | End customers            | `EXPO_PUBLIC_APP_VARIANT=customer`       |

The business application is untouched by Loop 7 except for **one guarded
branch** at the top of [`App.tsx`](App.tsx):

```tsx
if (APP_VARIANT === 'customer') return <CustomerRoot />;
```

When `APP_VARIANT` is `business` (the default for every existing build,
every CI run and every test) the file behaves exactly as before.

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
    customerNav.ts (+test)   deep-link parsing + customer/business boundary guard
    customerHome.ts (+test)  /customer/dashboard shaping
  components/cards.tsx       BusinessCard · ServiceRow · BookingCard
  screens/                   Auth, LegalGate, LegalDocument, Home, Explore,
                             BusinessProfile, BookingFlow, Bookings,
                             BookingDetail, Account, EditProfile,
                             Notifications, Assistant, Rewards (placeholder)
```

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
