# Chakusa — Release Candidate QA Matrix (#25)

Physical-device QA is the final release gate (`CLAUDE.md`). This matrix makes it
systematic. Run **every P0 row on every platform** before sign-off; P1 rows on at
least one iOS + one Android device; P2 rows opportunistically.

## Test fixtures (no production secrets)

Seed a local/staging database with `npm run seed:qa -- --i-understand-this-writes-test-data`
(`scripts/seed-qa.ts`). It refuses any non-loopback or production-looking
`DATABASE_URL` and requires the explicit flag. It creates:

| Login | Role | Password |
|---|---|---|
| `qa-owner-<stamp>@chakusa.test` | business OWNER | `qa-password-123456` |
| `qa-admin-<stamp>@chakusa.test` | business ADMIN | `qa-password-123456` |
| `qa-staff-<stamp>@chakusa.test` | business STAFF | `qa-password-123456` |
| `qa-customer-<stamp>@chakusa.test` | customer | `qa-password-123456` |

Data: 3 services (2 public, 1 internal), 5 customers, 5 leads (one per status),
6 appointments (CONFIRMED / SCHEDULED / COMPLETED / NO_SHOW / CANCELED + one
`ON_MY_WAY` with a live location share), 1 inventory item + 2 movements, 1 sent
review request, 2 feedback rows (one already replied), 1 open conversation with an
inbound + outbound message, an AI Receptionist settings row (disabled,
`AFTER_HOURS_ONLY`). The business is on the BUSINESS plan, ACTIVE.

AI uses the in-repo fake provider (`OPENAI_API_KEY`/`ANTHROPIC_API_KEY` unset →
receptionist stays off until OA-3). Twilio/Stripe are not wired for the seed —
messaging/payment rows are created directly; to exercise real send/charge, point
staging at sandbox provider credentials.

## Legend

- **Platforms:** iOS-B (iOS business mode), iOS-C (iOS customer mode), And-B, And-C, Web-B (browser dashboard).
- **Priority:** P0 = release-blocking, P1 = must fix before GA, P2 = track.
- Record: device model, OS version, build number, pass/fail, notes, screenshot ref.

---

## 1. Launch & shell — P0

| # | Step | Expected | Platforms |
|---|---|---|---|
| 1.1 | Cold launch | App opens to the correct entry screen with no crash, < 3 s to interactive | iOS-B, iOS-C, And-B, And-C |
| 1.2 | Kill & relaunch while signed in | Returns to the last section, session still valid | all mobile |
| 1.3 | Rotate / large text / dark mode | Layout holds, no clipped controls | iOS-B, And-B |
| 1.4 | Web dashboard cold load | `/dashboard/business` renders metrics; `astro`-built pages load < 2 s | Web-B |

## 2. Authentication — P0

| # | Step | Expected | Platforms |
|---|---|---|---|
| 2.1 | Email+password register (business) | Account + business created; lands on setup | iOS-B, And-B, Web-B |
| 2.2 | Email+password register (customer) | Customer account; lands on customer home | iOS-C, And-C, Web (client) |
| 2.3 | Login / wrong password | Clear error, no lockout leak, rate-limited after repeated attempts | all |
| 2.4 | **Google Sign-In** | Native Google flow completes; correct realm session; new-vs-existing handled | iOS-B, iOS-C, And-B, And-C, Web |
| 2.5 | **Apple Sign-In** | Native Apple flow completes; hidden-email relay handled; correct realm | iOS-B, iOS-C (Web: button hidden or works per config) |
| 2.6 | Forgot password → reset link → new password → login | Full loop works; old password rejected | iOS-B, And-C, Web |
| 2.7 | Logout | Session revoked server-side; relaunch requires login; web cookies cleared | all |
| 2.8 | Business token cannot reach customer screens / vice versa | Blocked (realm isolation) | iOS switch, Web |
| 2.9 | Session expiry mid-use | Graceful re-auth prompt, no data loss on the in-progress form where feasible | iOS-B, And-B |

## 3. Experience switching — P0

| # | Step | Expected | Platforms |
|---|---|---|---|
| 3.1 | Switch business → customer within the app | Correct data set, correct nav, no cross-leak of the other realm's data | iOS, Android |
| 3.2 | Switch back | Prior business context restored | iOS, Android |
| 3.3 | Preference persists across relaunch | `expo-secure-store` value honoured | iOS, Android |

## 4. Subscriptions / IAP — P0

| # | Step | Expected | Platforms |
|---|---|---|---|
| 4.1 | View plans (FREE account) | Plans shown; current plan marked | iOS-B, And-B |
| 4.2 | Purchase PRO (sandbox) | StoreKit / Play Billing sheet; on success plan upgrades **after server verification**, not optimistically | iOS-B, And-B |
| 4.3 | Restore purchases | Entitlement restored on a fresh install / re-login | iOS-B, And-B |
| 4.4 | Cancel / lapse (sandbox) | Entitlement drops to FREE at period end; PRO-only features gate off | iOS-B, And-B |
| 4.5 | Feature gate | A FREE business cannot send outbound messages / use INVENTORY / AI receptionist; UI shows the upgrade path | iOS-B, And-B, Web-B |

## 5. Notifications & deep links — P0

| # | Step | Expected | Platforms |
|---|---|---|---|
| 5.1 | Grant push permission | Token registered; appears server-side | iOS-B, And-B, iOS-C, And-C |
| 5.2 | Deny push permission | App still fully usable; no repeated nag | iOS-B, And-B |
| 5.3 | Receive a booking / message / review push | Delivered; tapping opens the right screen | iOS-B, And-B |
| 5.4 | Invalid/expired token | Server deactivates it (`provider_reported_invalid`); no send loop | (verify server-side) |
| 5.5 | Booking deep link `/book/<slug>` | Opens the native app when app-links are configured (OA-5); else the web page | iOS, Android |
| 5.6 | Review link `/r/<token>` | Opens the public review page; submit once works, second attempt is a no-op | iOS, Android, Web |

## 6. Messaging — P0

| # | Step | Expected | Platforms |
|---|---|---|---|
| 6.1 | Open the inbox (seeded conversation present) | List renders; unread state correct | iOS-B, And-B, Web-B |
| 6.2 | Open a thread | Messages in order; opening marks it read | iOS-B, And-B, Web-B |
| 6.3 | Reply (sandbox Twilio) | Message queued → sent; consent/opt-out/budget enforced; appears in the thread | iOS-B, And-B, Web-B |
| 6.4 | Inbound STOP | Customer suppressed; a later outbound is blocked (403) | staging inbound |
| 6.5 | Provider failure / retry | Failed dispatch retries with backoff; `/messages/failures` shows it; manual retry works | staging |
| 6.6 | Attachment (mobile) | Upload → malware scan → send; a "dirty" file is quarantined, never delivered | iOS-B, And-B |
| 6.7 | Capability | STAFF can reply (messaging.operate); the reply control is hidden for a role without it on web | Web-B |

## 7. Booking — P0

| # | Step | Expected | Platforms |
|---|---|---|---|
| 7.1 | Customer discovers a business (marketplace) → opens profile | Public data only; `acceptsOnlineBooking` correct | iOS-C, And-C, Web |
| 7.2 | Pick service → see real availability → book | Slot honoured; double-book rejected (409); confirmation sent | iOS-C, And-C, Web |
| 7.3 | Public link booking `/book/<slug>?service=…&src=qr` | Books; `bookingChannel = public_qr` recorded | Web, mobile browser |
| 7.4 | Reschedule / cancel inside vs outside the notice window | Allowed outside, blocked inside with a clear message | iOS-C, And-C, Web |
| 7.5 | Business creates a booking | Appears on the calendar; customer notified | iOS-B, And-B, Web-B |
| 7.6 | Business changes status (confirm / complete / no-show / cancel) | State transitions correctly; from web too (row actions) | iOS-B, And-B, Web-B |
| 7.7 | `.ics` export | Valid calendar file opens in the OS calendar | iOS-C, And-C, Web |

## 8. Quotes / Invoices / Payments — P0 (view) / P1 (create on mobile)

| # | Step | Expected | Platforms |
|---|---|---|---|
| 8.1 | View quotes / invoices list | Renders; statuses correct | iOS-B, And-B, Web-B |
| 8.2 | Create & send a quote (mobile) | Line items, totals, send; public quote link opens and can be accepted/declined | iOS-B, And-B |
| 8.3 | Convert quote → invoice; record a manual payment | Balance updates; no client-authoritative money state | iOS-B, And-B |
| 8.4 | Stripe Connect onboarding (sandbox) | Owner-only; status reflects charges/payouts enabled | iOS-B, And-B, Web-B |
| 8.5 | Customer pays an invoice via link (sandbox) | Checkout completes; invoice marked paid **on webhook**, not on redirect | Web, mobile browser |
| 8.6 | Payment reminder sweep | A due unpaid completed appointment gets one reminder | staging worker |

## 9. Arrival / Live Location — P0 (privacy-critical)

| # | Step | Expected | Platforms |
|---|---|---|---|
| 9.1 | Provider sets "On my way" | Customer sees status; **foreground** location permission requested, background explicitly not | iOS-B, And-B |
| 9.2 | Customer polls provider location | Coordinates shown while sharing; updates | iOS-C, And-C |
| 9.3 | Share expires / appointment ends / marked no-show | Share stops immediately; `{sharing:false}`; no residual location returned | iOS-C, And-C |
| 9.4 | Kill the provider app mid-share | Share still auto-expires server-side within its window | verify server-side |
| 9.5 | Permission denied | Arrival status still works without coordinates; no crash | iOS-B, And-B |
| 9.6 | No history | There is no screen or export anywhere showing past location points | all |

## 10. Inventory — P1

| # | Step | Expected | Platforms |
|---|---|---|---|
| 10.1 | View items + current stock (seeded item at 400 ml, low) | Low-stock flagged | iOS-B, And-B, Web-B |
| 10.2 | Create an item (OWNER/ADMIN) | Saved; STAFF cannot (control hidden on web, 403 on API) | iOS-B, Web-B |
| 10.3 | Record RECEIVE / CONSUME | Balance moves; ledger row immutable | iOS-B, And-B, Web-B |
| 10.4 | ADJUST / CORRECTION | Requires `inventory.adjust` (OWNER/ADMIN); STAFF blocked | iOS-B, Web-B |
| 10.5 | Negative stock rule | Honoured per the item's `allowNegative` | iOS-B |

## 11. AI Receptionist / after-hours — P1

| # | Step | Expected | Platforms |
|---|---|---|---|
| 11.1 | Open AI Receptionist settings | Shows off, `AFTER_HOURS_ONLY`, plan/hours status | iOS-B, And-B, Web-B |
| 11.2 | Toggle on (Business plan, provider configured per OA-3) | Saves; "answering now" reflects business hours + mode | iOS-B, Web-B |
| 11.3 | Inbound during hours vs after hours | Answers per the mode; deterministic server-side hours decision, not the model's | staging inbound |
| 11.4 | Human takeover | A teammate owning the conversation stops the AI answering | staging |
| 11.5 | STAFF | Cannot change AI settings (`automation.manage`); nav item hidden on web | Web-B |

## 12. No-show — P1

| # | Step | Expected | Platforms |
|---|---|---|---|
| 12.1 | Mark a past appointment NO_SHOW | Allowed; a future one is rejected (409) | iOS-B, And-B, Web-B |
| 12.2 | Follow-up (business opted in) | One polite, non-accusatory SMS via the worker sweep; never twice | staging worker |
| 12.3 | No financial record | No invoice / charge / fee created by a no-show | verify |
| 12.4 | Customer reply to the follow-up | Still passes the full AI receptionist gate (no bypass) | staging |

## 13. Reviews / reputation — P1

| # | Step | Expected | Platforms |
|---|---|---|---|
| 13.1 | Create a review request | Public link generated; message rendered | iOS-B, And-B, Web-B |
| 13.2 | Auto request after a completed appointment (opted in) | One request, after the configured delay, respecting the per-customer window; never sentiment-gated | staging worker |
| 13.3 | Public review page | Shows the feedback form **and** the Google link together (no gating) | Web, mobile browser |
| 13.4 | Business replies to feedback | Reply saved; visible on the marketplace profile | iOS-B, Web-B |
| 13.5 | Metrics | Funnel + rating average + reply rate render | Web-B |

## 14. Offline / poor network / error recovery — P0

| # | Step | Expected | Platforms |
|---|---|---|---|
| 14.1 | Airplane mode, then use the app | Clear offline states, no crash, no infinite spinner | iOS-B, And-B, iOS-C, And-C |
| 14.2 | Slow / flaky network (Network Link Conditioner / throttle) | Requests time out gracefully; retry works; no duplicate writes | iOS-B, And-B |
| 14.3 | Submit a form, lose connection mid-request | Either succeeds once or fails cleanly; never a double booking / double send | iOS-C, And-B |
| 14.4 | Backend 5xx | Friendly error + retry; correlation id available in logs for support | all |
| 14.5 | Token refresh under load | Concurrent 401s refresh once, requests replay, no logout storm | iOS-B, Web-B |

## 15. Web business dashboard (#22) — P1

| # | Step | Expected | Platforms |
|---|---|---|---|
| 15.1 | Sign in (email / Google), land on the dashboard | Metrics + recent activity render | Web-B |
| 15.2 | Each nav section loads its data (customers, leads, bookings, inbox, quotes, invoices, inventory, reviews, AI receptionist, reports, team, payments, settings) | Real data, loading/empty/error/permission states present | Web-B |
| 15.3 | STAFF login | Automation, AI Receptionist, Reports, Settings nav items hidden; create controls hidden where the role lacks the capability; a forged request still 403s | Web-B |
| 15.4 | ADMIN login | Sees operational sections; not billing/ownership/settings | Web-B |
| 15.5 | Keyboard-only navigation | Skip link, focus order, all controls reachable and operable | Web-B |
| 15.6 | Responsive down to ~768px | No horizontal scroll; two-pane inbox collapses | Web-B |
| 15.7 | Logout | Cookies cleared; back button does not restore an authed view | Web-B |

## 16. Cross-cutting security spot-checks — P0

| # | Step | Expected |
|---|---|---|
| 16.1 | Try to read another business's resource by id (IDOR) on 3 endpoints | 404 |
| 16.2 | STAFF hits an OWNER-only endpoint directly | 403 |
| 16.3 | FREE plan hits a PRO/BUSINESS feature endpoint | 402/403 entitlement error |
| 16.4 | Inspect logs / Sentry for a test session | No token, password, email, phone in logs; only ids + `requestId` |
| 16.5 | Webhook with a bad signature | 401, no side effect |

## 17. Store-readiness pre-checks (feeds #26) — P1

| # | Step | Expected |
|---|---|---|
| 17.1 | `npx expo install --check` | No mismatches |
| 17.2 | Generated Android manifest | No `ACCESS_BACKGROUND_LOCATION`, no unintended `AD_ID` |
| 17.3 | Generated iOS Info.plist | Location usage string present, foreground only |
| 17.4 | Account deletion in-app + the public deletion URL | Both reachable and functional |
| 17.5 | Every store/privacy declaration | Matches a feature the built app actually ships (reconcile against `docs/progress/` reports) |

---

## Sign-off

| Platform | Build | Tester | Date | P0 pass | P1 pass | Blocking issues |
|---|---|---|---|---|---|---|
| iOS business |  |  |  |  |  |  |
| iOS customer |  |  |  |  |  |  |
| Android business |  |  |  |  |  |  |
| Android customer |  |  |  |  |  |  |
| Web business |  |  |  |  |  |  |

Release requires: all P0 pass on all platforms, all P1 pass on ≥1 iOS + ≥1 Android,
no open P0/P1 issue.
