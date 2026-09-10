# Stage #25 — Manual QA Preparation

**Status:** COMPLETE (engineering deliverables). Physical-device execution is an
owner action (OA on #26).
**Next stage:** #26 Release Readiness & Store Compliance.

---

## Deliverables

### 1. `docs/RELEASE_QA_MATRIX.md`
A release-candidate QA matrix: 17 sections (launch, auth, experience switching,
IAP, notifications/deep links, messaging, booking, quotes/invoices/payments,
arrival/live location, inventory, AI receptionist, no-show, reviews,
offline/poor-network, web dashboard, security spot-checks, store-readiness
pre-checks), each with concrete steps, expected results, priority (P0/P1/P2), and a
per-platform run column (iOS-B, iOS-C, And-B, And-C, Web-B). A sign-off table gates
the release on "all P0 on all platforms, all P1 on ≥1 iOS + ≥1 Android".

### 2. `scripts/seed-qa.ts` (`npm run seed:qa`)
A guarded QA seed with **no production secrets**:
- Refuses unless `--i-understand-this-writes-test-data` is passed **and** the
  `DATABASE_URL` host is loopback **and** it carries no production indicator
  (`prod`, `render.com`, `supabase`, …) **and** the DB name looks like
  dev/qa/test/local. Fail-closed, verified (refuses a `db.production.render.com`
  host and refuses without the flag).
- Creates one business workspace with an **OWNER + ADMIN + STAFF** member and one
  **customer** account (all password `qa-password-123456`), then a data spread that
  exercises every matrix area: 3 services (2 public, 1 internal), 5 customers,
  5 leads (one per status), 6 appointments (CONFIRMED / SCHEDULED / COMPLETED /
  NO_SHOW / CANCELED + one `ON_MY_WAY` with a live location share), 1 inventory
  item + an OPENING + a CONSUME movement, 1 sent review request, 2 feedback rows
  (one already replied), 1 open conversation with an inbound + outbound message,
  an AI Receptionist settings row (disabled, `AFTER_HOURS_ONLY`). Business on the
  BUSINESS plan, ACTIVE.
- Uses `registerUser` / `registerCustomer` for valid accounts; the fake AI
  provider; no Twilio/Stripe wiring (real send/charge needs sandbox provider creds
  on staging).
- Prints the four logins + a seeded-row summary as JSON.

Smoke-tested end to end against a throwaway `chakusa_qa` database (migrated from
zero): exits 0, all rows created, credentials printed.

## Verification

- `npm run seed:qa` runs clean against a fresh migrated DB.
- Guard refuses: no flag → "Refused. Re-run with …"; non-loopback / production
  host → "Refused: … not loopback".
- Backend `tsc` unaffected (scripts are not in the `tsc` include set; run via
  `tsx`).

## Commits

- `chore(qa): release-candidate QA matrix + guarded no-secrets seed (roadmap #25)`

## Limitations / owner actions

- **Physical-device execution of the matrix is the owner's** — it is the final
  release gate and cannot be done from this environment.
- Real messaging / payment / AI paths in the matrix need **sandbox** provider
  credentials on a staging deploy (OA-3 for AI, sandbox Twilio/Stripe for 6.x /
  8.x). The seed creates the rows directly so the UI can be exercised without them.
- Store-readiness rows (17.x) feed directly into #26.

## Next stage

#26 Release Readiness & Store Compliance.
