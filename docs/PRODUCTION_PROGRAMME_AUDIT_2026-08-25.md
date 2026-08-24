# Chakusa production programme audit

Audit date: 2026-08-25  
Repository: `master` at `079f3bf`

## Executive result

The repository contains a substantial, tested production foundation, but it is not yet possible to claim that all 22 programmes are fully production-validated. Code-complete means the behavior exists behind authenticated, tenant-scoped APIs and has automated coverage. Production-ready additionally requires configured providers, deployed migrations, physical-device checks, and real-business acceptance.

Backend static checks pass (`build`, `typecheck`, `lint`, repository secret scan). The mobile suite passes 31 files and 248 tests. Database integration tests require a configured isolated `DATABASE_URL` and were not treated as passed without that database.

## 22-area audit

| # | Programme | Status | Evidence | Gap / reason |
|---:|---|---|---|---|
| 1 | Online booking | Code complete | `src/modules/public/publicBusinessProfile.*`, `tests/public-booking.test.ts`, mobile public booking screens | Live SMS/email confirmation and deployed-domain verification remain |
| 2 | Customer booking management | Code complete | Public confirm/reschedule/cancel/payment-link routes; per-booking ICS export; `mobile/src/screens/PublicBookingManagementScreen.tsx` | Physical customer-device testing remains |
| 3 | Appointment communication | Mostly complete | `src/modules/appointments/appointmentReminders.ts`, worker scheduling, lifecycle delivery fields, appointment tests | Provider delivery, retries, opt-outs, and timezone behavior need live validation |
| 4 | Production messaging | Partial | Twilio adapter, delivery webhooks, SMS and configured WhatsApp support, Resend email for selected workflows | Customer email messaging is not a general channel; credentials, sender approval, cost controls, and delivery monitoring need production validation |
| 5 | Deposits and payments | Code complete | Stripe Connect, checkout links, refunds, signed webhooks, duplicate-webhook protection; `tests/appointment-payments.test.ts` | Live Stripe account/webhook/payment/refund testing remains |
| 6 | Lifecycle workflows | Code complete for implemented triggers | `LEAD_CREATED`, `LEAD_FOLLOW_UP`, `REVIEW_REQUEST_FOLLOW_UP`, `CUSTOMER_RETENTION`; scheduler/executor/worker tests | More trigger classes would be future product scope; worker deployment must be verified |
| 7 | Revenue attribution | Partial-to-complete | Dashboard/insights report Stripe, manual, public-booking, staff-booking, and payment-reminder attribution | Attribution is appointment/payment-source based, not a complete marketing/source attribution model; validate definitions with real businesses |
| 8 | Weekly owner reports | Code complete | Durable report model, scheduled generation, in-app list, push notification, optional Resend email; `tests/weekly-owner-reports.test.ts` | Provider delivery and report usefulness need live testing |
| 9 | Production calendar | Code complete | Availability engine, conflict locks, blocks, appointment lifecycle, mobile calendar/editor/import screens | Physical device and timezone acceptance remains |
| 10 | Availability engine | Code complete | `src/modules/availability`, deterministic conflict tests, preparation/cleanup handling | Real-business schedule edge cases remain |
| 11 | External calendar integration | Complete for approved scope | Hashed/revocable subscription tokens, minimal ICS feed, owner-only mobile management, PII exclusion tests | This is read-only subscription sync; two-way OAuth event editing is not implemented and was not required by the authorization granted |
| 12 | Service management | Code complete | Categories, ordering, pricing, deposits, durations, staff assignments, archive behavior; mobile catalog screen | Commercial catalog validation remains |
| 13 | Store subscriptions | Code complete with deployment dependencies | Apple/Google verification, signed notifications, product catalog, event ordering, restore paths | Store credentials, product IDs, sandbox/production console setup and physical purchase tests remain |
| 14 | Trial experience | Partial | Trial status, expiry/grace handling, mobile trial copy and outcome messaging | Trial activation/conversion must be exercised with real store products and dates |
| 15 | Plan structure | Code complete, commercial validation pending | Central entitlements and status-sensitive feature gates in `src/lib/entitlements.ts`; mobile billing states | Final prices, limits, packaging, and upgrade conversion require owner decision and beta evidence |
| 16 | Business setup | Mostly complete | Onboarding completion validation, business settings, payment/messaging consent, service synchronization | Provider setup and guided real-business onboarding remain |
| 17 | Data import | Code complete for supported imports | Customer CSV preview, validated customer bulk write, appointment CSV/mobile import; no device-contact upload by design | Physical import testing and customer-data quality review remain |
| 18 | First-success journey | Code complete | `mobile/src/domain/activationJourney.ts`, activation dashboard evidence, tests | Measure completion with real businesses |
| 19 | Account controls/device validation | Code complete | Session revocation, logout-all, password reset, device registration/revocation, mobile security screens | Physical iOS/Android and recovery testing remain |
| 20 | Monitoring | Code foundation complete | Sentry redaction, `/health`, `/health/ready`, `/health/worker`, worker heartbeat, admin health metrics, mobile monitoring service | Configure DSNs, alert destinations, and verify real alerts |
| 21 | Customer support | Basic code complete | Support tickets, help UI, admin read-only context, audited support access | Staffing, response targets, refund guidance, and escalation operations remain |
| 22 | Real-business beta validation | Not started | No cohort results or conversion dataset in repository | Run the 15–20-business acceptance cohort before declaring commercial readiness |

## Why a business can subscribe

The product already has a credible paid value proposition when the deployment dependencies are configured:

- It converts public inquiries and bookings into a managed customer and appointment pipeline.
- It protects revenue with deposits, payment links, balance reminders, Stripe reconciliation, and refund handling.
- It reduces missed follow-up through scheduled reminders, lifecycle automation, review requests, and retention workflows.
- It gives owners measurable outcomes: recovered leads, collected/outstanding appointment revenue, reviews, customer lifecycle, automation success, and weekly reports.
- It supports daily operations with availability conflict prevention, service/team assignment, calendar subscriptions, imports, and account controls.
- It provides a secure operational model: tenant isolation, role checks, rate limits, opaque revocable calendar tokens, audit logging, and secret scanning.

The subscription promise should be presented as “turn missed demand into booked, paid, and retained customers with measurable automation,” not as a claim that every provider integration or beta metric has already been proven.

## Main reasons we are behind

1. Provider and store configuration is external to the repository and requires real credentials, verified sender domains, approved WhatsApp/store products, and signed webhooks.
2. Physical device behavior cannot be proven by TypeScript tests alone.
3. Revenue definitions, plan prices, trial conversion, support response targets, and beta success thresholds are commercial decisions requiring real-business evidence.
4. Full general-purpose customer email messaging and two-way OAuth calendar editing are not currently implemented product capabilities.

## Recommended release gate

Do not announce full production completion until the go-live checklist is executed, the isolated database integration suite passes, all provider webhooks have a successful replay test, and 15–20 businesses complete the booking-to-payment-to-report journey with recorded results.
