# Stage #20 — Reputation & Review Growth

**Status:** IMPLEMENTED — the review-request subsystem was already broad
(manual + campaign creation, public token links, lifecycle, templates, follow-up
automation, policy-safe public page). This stage adds the missing pieces from the
completion criterion: the automatic post-completion request, the business reply
workflow, and a reputation metrics surface.
**Next stage:** #21 Booking Distribution.

---

## Baseline inspected (built, kept)

- `ReviewRequest` + lifecycle (`pending→sent→opened→reviewed→feedback_received`),
  `Feedback`, message `review_request` templates + industry defaults.
- Manual `POST /review-requests`, campaign `bulk-create` / `bulk-send` (Pro+),
  `generate-message`, per-request public link (`/:id/public-link`).
- Public unauthenticated flow (`/public/reviews/:token`): opaque id.secret token,
  hash-only storage, timing-safe compare, one-time `publicTokenConsumedAt` claim
  (idempotent submission). The choice screen shows the Chakusa feedback form **and**
  the Google review link **unconditionally** — no sentiment routing, no gating.
- Follow-up automation: `REVIEW_REQUEST_FOLLOW_UP` trigger + `sweepReviewRequestFollowUps`
  + per-`(rule, request)` dedupe key ("one reminder, never a repeating nag").
- Entitlement: `reviewRequestsPerMonth` limit on the manual/campaign path.

## Architecture reused

`ReviewRequest`, `generatePublicReviewLink`, `buildPublicReviewUrl`, the
`review_request` template + `getDefaultTemplateBody`, `renderTemplate`,
`sendOutboundMessage` + `messagingBudgetAvailable` + `customerOptOut` (the exact
worker-send primitive `sendCustomerAppointmentMessage` uses), `recordActivity`,
the `scheduledWorkTrigger` cadence. No new messaging path, no second review model.

## Gaps found and closed

### A — No automatic review request after a completed appointment
Nothing turned a completed appointment into a review request. The campaign audience
was won-lead customers "never asked ever" — not per-appointment, not windowed.

New `sendDueReviewRequests` worker sweep (`src/modules/reviews/reviewAutomation.ts`),
wired into `runTriggeredScheduledWork` next to the other appointment sweeps:

- **Eligibility**: `status = COMPLETED`, ended between 1 hour and 30 days ago, the
  business opted in (`reviewRequestAutoEnabled`), `platformStatus = ACTIVE`,
  `messagingConsentConfirmedAt` set, customer present with an E.164 phone. Due only
  once `reviewRequestDelayHours` (default 24, business-configurable 1–336) has
  elapsed since the appointment **end**.
- **Consent**: messaging entitlement (`OUTBOUND_MESSAGING`), messaging budget, and
  an SMS/ALL `customerOptOut` check — all before any send.
- **Window / one-request policy**: no send if the customer has *any* review request
  (manual, campaign or auto) within `reviewRequestMinIntervalDays` (default 45,
  1–365). Enforced across the whole customer, not just this appointment.
- **Idempotency**: an atomic claim on the new `appointment.reviewRequestSentAt`
  column (same pattern as `noShowFollowUpSentAt`) **plus** a unique
  `ReviewRequest.appointmentId` — a hard DB guarantee of one auto request per
  appointment. A *policy* skip (opt-out / windowed) also claims the column so the
  sweep stays O(new completions). A *transient* failure (no budget, provider
  soft-fail, unexpected error) releases the claim and deletes the half-created
  request so the next sweep retries cleanly.
- **Template**: the business's `review_request` template (or the industry default),
  rendered with a freshly-minted public review link.
- **Never sentiment-gated**: there is no rating anywhere in the query; a customer
  who left a 1-star review last quarter is asked again once the window passes.

### B — No business reply to a review ("response workflow")
`Feedback` had a status but no reply. Added `Feedback.response` / `respondedAt` /
`respondedByUserId` (additive) + `POST /feedback/:id/respond` (needs
`reviews.manage`; empty string clears). The reply is surfaced on the marketplace
profile's `reviewsSummary.recent[].response` — visible to customers, the point of a
response workflow. Not sentiment-gated: any feedback can be answered.

### C — No reputation metrics surface
New `GET /review-requests/metrics` → `reviewMetrics`: request counts by status,
sent→converted conversion (all-time and last-30-days), rating average + count,
and reply coverage (`responses.responseRate`).

## Schema (additive migration `20260909160000_review_growth`)

- `businesses.review_request_auto_enabled BOOLEAN NOT NULL DEFAULT false`,
  `review_request_delay_hours INT NOT NULL DEFAULT 24`,
  `review_request_min_interval_days INT NOT NULL DEFAULT 45` — constant defaults,
  metadata-only.
- `appointments.review_request_sent_at TIMESTAMP(3)` (nullable claim column).
- `review_requests.appointment_id TEXT` + unique index + FK `ON DELETE SET NULL`
  (all-NULL new column → index builds instantly, NULLs never collide).
- `feedback.response TEXT`, `responded_at TIMESTAMP(3)`, `responded_by_user_id TEXT`.
- `ActivityEventType += FEEDBACK_RESPONDED, FEEDBACK_RESPONSE_CLEARED`
  (`ALTER TYPE ADD VALUE`, value unused in-migration — matches the repo's existing
  `MessageType` enum migrations; transaction-safe on PG12+).

Tenth pending migration on Render — `docs/OWNER_ACTIONS.md` OA-1 batch grows to 10.

## Authorization / privacy / policy

- All review/feedback business routes stay under `authenticate` + `requireBusiness`;
  every mutation needs `reviews.manage`. `respond` and `metrics` are business-scoped
  (cross-tenant → 404 / empty).
- The auto sweep is a worker; it re-checks entitlement + budget + opt-out per
  appointment and isolates per-appointment failures (never fails the batch).
- **No review gating**: the public page still offers the Chakusa form and the Google
  link together, regardless of rating. **No sentiment suppression**: eligibility is
  completion + consent + window only.

## Tests

`tests/review-automation.test.ts` (12):
- one request per eligible completed appointment; idempotent second sweep; unique
  `appointmentId`; claim column set; `review_request` Message row; public token minted.
- not before the configured delay; disabled business → nothing; no messaging
  consent → not even a candidate (claim untouched).
- per-customer window skip is terminal (claimed), and the *same previously-negative*
  customer IS asked once the window passes — explicitly asserting no sentiment
  suppression.
- SMS opt-out → skipped + claimed, no request created.
- provider soft-fail → claim released + half-created request removed → next sweep
  sends.
- tenant isolation on the sweep.
- response workflow: `POST /feedback/:id/respond` sets fields, appears in the public
  profile recent reviews, empty string clears; tenant-scoped.
- metrics: funnel counts, 0.5 conversion, rating average, response rate.

**Results (test DB, PG 16.15):**

- Backend `tsc --noEmit` — clean. Backend `tsc -p tsconfig.test.json --noEmit` — clean.
- `npx prisma validate` — valid. `npx prisma migrate status` — up to date (migration
  applied via `migrate reset` on the disposable test DB; the `ALTER TYPE ADD VALUE`
  applied cleanly).
- `tests/review-automation.test.ts` — **11/11 pass**.
- Regression (all pass): `reviews-feedback-reminders`, `public-reviews`, `feedback`
  coverage, `marketplace`, `marketplace-discovery-e2e`, `public-business-profile`,
  `scheduled-work-trigger`, `automation-phase1`, `no-show-automation`, `appointments`,
  `appointment-arrival`, `entitlements`, `authorization-matrix` — 13 files, ~217 tests.
- No mobile changes in this stage.

## Limitations / deferred

- **Mobile UX** for the reply workflow and the metrics view is not built here (no
  way to exercise mobile UI from this environment). The API + data + public surface
  are complete; the mobile screens are a follow-up.
- `reviewRequestsPerMonth` is `null` (unlimited) for every plan that can send
  outbound messaging, so the sweep has no monthly-limit branch (the manual/campaign
  path keeps its check for if that ever changes).
- Delay is measured from appointment **end**; there is no per-service or
  per-customer override of the delay/window (business-level only).
- No external-provider review-link management beyond the existing
  `business.googleReviewLink` / `reviewRequest.googleReviewLink` fields.

## Next stage

#21 Booking Distribution.
