# Twilio toll-free verification fix: SMS consent, company email, raw-SQL UTC

**Status:** code complete and tested. Resubmitting the Twilio verification is an owner action (see the end).

## Why

Twilio rejected toll-free verification for **+1 844 604 1271** with two errors:

- **30482:** the contact email was a generic provider address (`@gmail.com`).
- **30513:** opt-in was not shown. The proof URL (`/create-account`) had no phone field and no SMS consent wording, and the app never asked customers for text consent.

The review also found these problems in the submitted form:
- "Contains Age Gated Content" was ticked.
- The contact phone was the toll-free number itself.
- The street address was just "Harare", with postcode 00000.
- The sample message had no STOP wording.

## Baseline inspected

- Twilio console (number configuration and the verification form, read-only).
- Cloudflare Email Routing: the domain had no MX/SPF records.
- Customer booking: `BookingFlowScreen` → `POST /customer/bookings` → `createCustomerBooking`.
- Messaging gates: `appointmentReminders.ts`, `messagingPlatform.enqueueMessage`. STOP is already handled by `/twilio/inbound` together with suppressions and `CustomerOptOut`.
- The existing `CustomerConsentEvent` ledger. It is defined in the schema, but nothing wrote to it until now.

## Implementation

**Email (Cloudflare, live).** Email Routing is enabled for chakusarecovery.com, with MX, SPF and DKIM records added. These addresses forward to the owner's verified Gmail:
- support@, privacy@, info@, prince@, legal@, billing@, security@, hello@, admin@ and noreply@.

**SMS consent (app and API).**
- `src/lib/messaging/smsConsent.ts`: disclosure text with a version, plus `recordSmsConsent` and `smsConsentDeclined`.
- Booking accepts `smsConsent?: boolean`. Each choice, granted or declined, is written to `CustomerConsentEvent`:
  - Fields: business, customer, `SMS`/`APPOINTMENT_TEXTS`, `customer_app_booking`.
  - Evidence: disclosure text, its version, appointment id and profile id.
  - The row is written before the confirmation SMS is sent.
  - Older app builds send no value, so no row is written and behaviour is unchanged.
- Appointment texts (confirmation, reminders, arrival) and `enqueueMessage` skip any customer whose latest choice with that business is a decline. Consent is scoped per business.
- The confirmation SMS now ends with "Reply STOP to opt out."
- Booking confirm step: a checkbox that is unticked by default, showing the full disclosure, with `aria-checked`.

**Website.**
- New `/sms` page (SMS Terms & Opt-In): program details, a real screenshot of the consent step, the exact wording, what messages are sent and how often, STOP/HELP, privacy, and sample messages.
- The page is linked from the legal nav and the footer.
- The privacy policy now states that numbers and consent are never shared or sold for marketing.

**Bug found and fixed: raw SQL was only correct on a UTC database session.**
- Every app `DateTime` column is `timestamp(3)` holding UTC. A JS `Date` in raw SQL is sent as `timestamptz`, so comparisons and assignments went through the session `TimeZone`.
- On a +04:00 database, due owner reminders were never selected, and lease timestamps were written 4 hours off.
- Production (Supabase) runs in UTC, so it was not affected. The bug was latent.
- Fix: `src/lib/sqlTime.ts` adds `utc(date)` and `UTC_NOW`, applied to every raw query that compares or assigns a date:
  - reminders, outbox, domain event bus, trigger engine, workflow runtime, automation scheduler, message dispatch, insights, weekly reports, admin read.
- `appointments.test.ts › delivers an upcoming owner reminder at most once` failed on a non-UTC database before the fix and passes after it.

**E2E setup fix.** `/app-config` turns email sign-in off by default, which overrode the web build, so a fresh test database could not sign anyone up.
- New `scripts/seed-e2e-app-config.ts`, guarded by `assertLocalTestDatabaseTarget`.
- The step is added to `mobile/e2e/README.md`.
- The journey spec now asserts that the consent box starts unticked and can be ticked.

## Authorization / tenant / security

- Consent rows are tenant-scoped by `businessId`. Declining with one business never affects another.
- No new routes. The consent field rides on the authenticated customer booking route.
- No secrets in the code or docs. The Cloudflare and Twilio work was done in the owner's signed-in browser.

## Migrations

None. `CustomerConsentEvent` already existed.

## Tests

- Backend: new tests in `tests/appointments.test.ts` (a decline blocks the confirmation; a later opt-in allows it) and `tests/customer-booking.test.ts` (true, false and absent cases).
  - Typecheck, test typecheck and lint are clean.
  - The full suite was run against a non-UTC database; the result is in the commit message.
- Mobile: 543/543 tests pass and the typecheck is clean.
- Manually verified in Chrome against a local API and throwaway database:
  - The box starts unticked (`aria-checked=false`), and ticking it sends `smsConsent:true`.
  - Booking without ticking records `granted:false`.
- The `/sms` page was checked at 1280 px and 390 px: no horizontal scroll, image loads, no console errors.

## Owner actions

See OA-10 in `docs/OWNER_ACTIONS.md`: resubmit Twilio toll-free verification.
