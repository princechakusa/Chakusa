# CHAKUSA — AUTONOMOUS MASTER PRODUCT & ENGINEERING ROADMAP

**Status:** Governing implementation roadmap  
**Repository:** Chakusa  
**Execution mode:** Autonomous, stage-gated, production-first  
**Last roadmap position:** #18–#21 complete. OA-6 resolved (`docs/OWNER_DECISION_OA6_STAGE22_WEB.md`) — #22 built on `website/` Astro + `cloudflare/auth-gateway`. #22 V1 delivered: 9/13 high-value workflows usable end-to-end from the web (dashboard, calendar ops, leads, customers, inbox+reply, inventory, reviews+reply, AI receptionist, settings), 4 view-only with named deferrals (quote/invoice creation, team admin, report detail); capability-aware UI + gateway allowlist expansion + drift tests. #23 Production Hardening in progress — worker HTTP-tick parity + step isolation + stranded-dispatch recovery landed; audit doc + runbook + remaining areas next. Production migration backlog is 10, owner-blocked (OA-1); app-link identifiers owner-blocked (OA-5, non-blocking).

---

# 1. PURPOSE

This document is the single forward implementation plan for Chakusa. It exists so an autonomous coding agent can inspect the repository, continue from the current state, implement the remaining product safely, test each stage, audit it, commit it, and proceed without repeatedly asking the owner for ordinary implementation decisions.

The agent must treat the repository as the source of truth. Historical completion notes in this document describe intended/current state but must be verified before changing code.

---

# 2. AUTONOMOUS EXECUTION CONTRACT

For every stage use:

**PROJECT → PHASE → STAGE → INSPECT → DESIGN → IMPLEMENT → TEST → SECURITY AUDIT → REGRESSION → COMMIT → CONTINUE**

Rules:

1. Inspect existing implementation before writing code.
2. Reuse existing architecture; never create parallel systems unnecessarily.
3. Preserve working functionality and backward compatibility.
4. Prefer additive migrations and expand-first deployment patterns.
5. Backend authorization is authoritative. UI hiding is only UX.
6. Tenant isolation is mandatory on every business/customer resource.
7. Entitlement and authorization are separate axes.
8. Do not trust client-supplied tenant, role, ownership, price, payment truth, AI authorization, or other server-derivable authority.
9. Financial state comes from verified server/provider evidence, not client claims.
10. AI output never authorizes actions; server policy/tool layers do.
11. Avoid giant files. Refactor into domain/service/schema/route/UI boundaries when needed.
12. Add tests for invariants, tenant isolation, privilege escalation, retries/idempotency, and failure behavior.
13. Run production TypeScript, test TypeScript, relevant backend tests, mobile TypeScript, and mobile tests before closing a stage.
14. Commit coherent stages with meaningful commit messages.
15. Continue automatically after a passing completion gate.
16. Do not stop for naming, minor UI wording, ordinary implementation choices, refactoring choices, test fixture repair, or other reversible engineering decisions. Choose the safest maintainable option and document it.
17. Stop only for a genuine external/irreversible owner decision: destructive production action, new paid provider commitment, legal/compliance representation requiring owner attestation, secret/credential unavailable, store-account action that cannot be performed safely, or a product decision with materially different irreversible consequences.
18. Physical-device QA is a final release gate, not a blocker for ordinary implementation.
19. Do not mark a feature complete because a schema, flag, placeholder, or screen exists. Verify the complete product path.
20. Never weaken tests merely to make them pass. Repair stale fixtures only when production behavior is correct.

---

# 3. PRODUCT DEFINITION

Chakusa is a global local-service-business SaaS with one installed mobile app and two isolated experiences.

Core promise:

> Turn missed calls into bookings, happy customers into reviews, and past customers into repeat sales.

Target businesses include barbers, salons, beauty clinics, cleaners, plumbers, electricians, car washes, dentists, photographers, movers, mechanics, spas/massage, restaurants, and small contractors.

## Customer experience

- Discover businesses
- Browse services
- Enquire/message
- Book and manage appointments
- Customer AI assistance
- Receive quotes/invoices/payment requests
- Loyalty, tiers, rewards, memberships, referrals
- Provider arrival/live-location experience
- Account/privacy controls

## Business experience

- Leads and CRM
- Customers
- Service catalogue
- Appointments/calendar
- Reviews/reputation
- Retention/comeback
- Messaging/templates
- Team/roles/schedules/commissions
- Quotes/estimates/invoices/payments
- Financial operations/accounting integrations
- Automation
- AI Receptionist
- Inventory
- Dispatch/arrival
- Loyalty
- Marketplace/discovery
- Settings/integrations

---

# 4. LOCKED PLATFORM ARCHITECTURE

## One app, two isolated experiences

`ExperienceRouter → CustomerRoot | BusinessRoot`

Customer and business auth/session/API transport/push/navigation/legal state remain isolated. Same device may hold both identities. Only one shell is mounted at a time. Never copy tokens or merge sessions.

## Business authorization

Central `Role → Capability` authorization is authoritative.

Roles remain:
- OWNER
- ADMIN
- STAFF

No giant customizable RBAC system unless separately justified.

Entitlement answers **whether the plan has the feature**. Capability answers **whether this member may perform the action**. Both must pass.

## AI architecture

Reuse the existing AI Gateway, model registry, invocation ledger, Policy Engine, Tool Broker, conversation runs, memory, provider adapters, human takeover, and customer-agent/receptionist runtime. Do not build a second AI stack.

## Financial separation

Keep separate:

A. Chakusa subscription billing — Apple/Google billing, server verified.  
B. Business→customer commerce — existing provider/Stripe Connect architecture.  
C. Business financial operations — quotes, invoices, payments, balances, expenses, accounting.

Never conflate these domains.

---

# 5. COMPLETED FOUNDATION — VERIFY, DO NOT REBUILD

The following are considered completed unless repository inspection proves otherwise:

- Business platform foundation
- Customer platform foundation
- Business authentication
- Customer authentication
- One-app/two-experience routing
- Secure session isolation/switching
- Leads/CRM
- Customers
- Service catalogue
- Appointments/calendar
- Reviews/feedback
- Retention/comeback foundation
- Team/roles foundation
- Messaging/templates foundation
- Workflow/automation foundation
- AI architecture foundation
- Marketplace foundation
- Customer booking
- Loyalty foundation/UI/backend
- Subscription entitlements
- Apple + Google billing foundation
- Quotes/estimates
- Invoicing
- Business↔customer invoice payments
- Financial Management
- Accounting integration foundation
- On My Way / arrival
- Dispatch
- Advanced Team / commissions / centralized capabilities
- Inventory movement ledger
- Appointment-scoped foreground Live Location
- AI Receptionist business control layer
- After-hours AI schedule gate
- No-show Automation

Do not reopen these stages without a regression, security issue, dependency required by a later stage, or explicit owner direction.

---

# 6. LOCKED DOMAIN DECISIONS

## Quotes

- One QuoteDocument with `ESTIMATE | QUOTE`.
- Stable document + immutable revisions.
- Server-computed exact totals.
- DRAFT can be empty; SEND requires valid line item(s).
- Quote acceptance is a commercial application signal, not e-signature.
- Acceptance tokens bind to exact revision and expire/revoke.
- At most one non-VOID invoice per quote at a time.
- After VOID, reconversion creates a new invoice number and preserves history.

## Invoice payment truth

Do not store client-controlled PAID/PARTIALLY_PAID/OVERDUE truth.

Derive:
- amountPaid <= 0 → UNPAID
- 0 < amountPaid < total → PARTIALLY_PAID
- amountPaid >= total → PAID

Overdue is separate: outstanding balance > 0 + due date passed + lifecycle permits collection.

## Inventory

Inventory movement ledger is authoritative. Item quantity is derived from immutable movements. Corrections use compensating movements; history is not rewritten.

## Live Location

Appointment-scoped provider→customer arrival sharing only. No workforce surveillance. Foreground permission only unless a separate owner decision authorizes background location. Latest fix only, no route history, mandatory expiry, assignment/customer authorization.

## AI Receptionist

Existing Customer Agent is the receptionist engine. Activation gates include platform switch, plan entitlement, business opt-in, channel, Policy Engine and server-side Tool Broker. Model output never grants authority.

## After-hours AI

A deterministic schedule gate on the existing receptionist. Server business timezone/hours are source of truth. Human takeover always wins. No scheduled model calls.

## No-show

NO_SHOW is an explicit appointment outcome, never AI/predictive inference. No automatic fee, charge, invoice, loyalty penalty, blacklist or customer risk score. Follow-up is business-controlled and idempotent.

---

# 7. IMMEDIATE STAGE — CONTROLLED PRODUCTION DEPLOYMENT CHECKPOINT

Before #18, reconcile the migration backlog and production safely.

Expected pending migration families must be verified from the repository, including the recent additions for:

- business logo data URL
- appointment arrival state
- member commission rules
- inventory ledger
- appointment location share
- AI receptionist settings
- after-hours AI
- no-show automation

## Required checkpoint

1. Inspect exact chronological migration chain from repo.
2. Audit every pending SQL migration for destructive operations, defaults/backfills, constraints, enum changes, indexes, FKs and lock risk.
3. Determine actual production `_prisma_migrations` state using a safe/read-only method. Never guess.
4. Run Prisma validate/generate/status and backend/test typechecks.
5. Rehearse complete migration history on disposable clean PostgreSQL.
6. Rehearse the production-like upgrade path from immediately-before-pending state.
7. Validate existing-data compatibility.
8. Determine safe code-vs-schema deployment order.
9. Verify enum deployment behavior.
10. Confirm backup/recovery readiness; do not invent backup availability.
11. Run broad regressions for all features touched by pending migrations.
12. Classify SAFE / SAFE WITH PRECONDITIONS / NOT SAFE.
13. If safe and authorized by the existing deployment workflow, deploy using the documented production mechanism; otherwise report the exact external prerequisite and continue all non-blocked work without destructive action.
14. Verify health/auth/tenant resolution/appointments/arrival/commissions/inventory/live-location/AI settings/after-hours/no-show/messaging after deployment.

Never reset, drop, or manually rewrite production data.

---

# 8. REMAINING PRODUCT ROADMAP

The agent must execute these stages in order unless repository inspection shows a stage is already substantially implemented. If so: audit → close gaps → test → mark complete → continue.

## #18 Omnichannel Communications

Goal: unify supported customer conversations without building disconnected inboxes.

Scope:
- Inspect existing Conversation/Message/provider architecture first.
- Preserve SMS + WhatsApp.
- Build a provider-neutral channel abstraction only where missing.
- Unified business inbox with channel identity, assignment, status, unread state, human takeover, templates and AI eligibility.
- Strong inbound webhook verification/idempotency.
- Outbound consent/opt-out/provider-budget enforcement.
- Move important automated outbound side effects toward durable outbox/event processing where appropriate; specifically review the no-show route-level best-effort send.
- Do not add email/social/voice merely for feature count. Add only channels supportable with current provider/configuration architecture and no unresolved paid-provider commitment.
- No cross-channel identity merging based on unsafe guesses.
- Tenant isolation, provider-message idempotency and retries mandatory.

Completion: E2E inbound/outbound, assignment/takeover, retry/idempotency, opt-out, AI gating, mobile inbox, security tests.

## #19 Marketplace & Discovery Completion

Goal: make customer discovery a production-quality acquisition surface.

Scope:
- Audit existing marketplace foundation before changing schema.
- Search/browse by service/category/business.
- Location-aware discovery only with appropriate customer permission and privacy; do not require precise location when city/area is sufficient.
- Business profile, services, hours, ratings/reviews, booking CTA.
- Availability-aware results only when backed by real availability.
- Verified/active business filtering.
- Pagination, ranking and empty states.
- Abuse/spam/reporting/moderation path where required.
- Do not create pay-to-rank behavior without explicit monetization rules.

Completion: customer discovery → business → service → availability → booking E2E, tenant/public-data boundaries, performance tests.

## #20 Reputation & Review Growth

Goal: turn completed service into compliant review/reputation growth.

Scope:
- Reuse reviews, feedback, messaging, templates, workflow automation.
- Business-controlled review request after eligible completed appointment.
- Idempotent one-request policy per configured event/window.
- Internal feedback vs public review path must not become prohibited review gating.
- No suppression of negative customers from legitimate review opportunities based on sentiment.
- Response workflow, review metrics and mobile UX.
- Provider/external review links configurable if already supported safely.

Completion: eligibility, consent, retries, idempotency, template, reporting, policy-safe UX, tests.

## #21 Booking Distribution

Goal: make booking links/widgets easy to distribute.

Scope:
- Secure public booking URLs using existing customer booking engine.
- Business/service-specific links.
- QR/deep-link/share surfaces.
- Website/embed strategy only if existing web architecture supports it cleanly.
- Universal/App Links readiness.
- No duplicate booking engine.
- Attribution only with minimal privacy-safe metadata.

Completion: link → service/business → availability → booking → app/web continuation, deep-link tests, abuse/rate-limit tests.

## #22 Desktop / Web Business Experience

Goal: business operators can manage Chakusa efficiently on larger screens.

Scope:
- Inspect existing admin/website/web app architecture first.
- Do not expose platform-admin surfaces to normal businesses.
- Prioritize dashboard, calendar, leads, customers, inbox, quotes/invoices/payments, team, inventory, AI settings, reports.
- Reuse backend APIs and capability matrix.
- Responsive, keyboard-friendly, accessible.
- Do not duplicate business logic client-side.

Completion: core operational parity for high-value workflows, auth/session security, capability-aware UI, regression coverage.

## #23 Production Hardening

Goal: operational reliability before release.

Scope:
- Background worker reliability, retries, dead-letter/recovery strategy.
- Outbox processing guarantees.
- Webhook signature verification and replay defenses.
- Rate limits.
- DB query/index review and N+1 audit.
- Connection pool/timeouts.
- Structured logs and correlation IDs.
- Sentry/monitoring integration review.
- Health/readiness endpoints.
- Backup/recovery documentation verification.
- Feature-flag failure modes.
- Provider circuit breakers.
- Push notification failure handling.
- Remove debug/test bypasses from production paths.

Completion: fault-injection/retry tests, operational runbooks, no P0/P1 findings.

## #24 Pre-release Security & Privacy Audit

Goal: release-grade security/privacy review.

Audit:
- authentication/session/token storage
- business/customer session isolation
- tenant isolation / IDOR
- role/capability escalation
- entitlement bypass
- mass assignment
- injection
- SSRF/path/file upload risks
- webhook forgery/replay
- secrets/config leakage
- payment verification
- AI prompt injection/tool authorization/data leakage
- PII minimization/logging
- live-location retention/access
- account deletion/export
- privacy-policy consistency
- mobile secure storage
- dependency vulnerabilities

No release with unresolved P0/P1.

## #25 Manual QA Preparation

Goal: make physical-device QA systematic rather than exploratory chaos.

Create a release candidate QA matrix for:
- iOS business mode
- iOS customer mode
- Android business mode
- Android customer mode
- experience switching
- Google Sign-In
- Apple Sign-In
- subscriptions/IAP
- notifications/deep links
- messaging
- booking
- quotes/invoices/payments
- arrival/live location
- inventory
- AI receptionist/after-hours
- no-show
- offline/poor-network/error recovery

Prepare seeded test accounts/data without production secrets.

## #26 Release Readiness & Store Compliance

Goal: ship safely.

Required:
- all migrations deployed and verified
- production environment/config audit
- Android local release build according to project rules
- iOS EAS/TestFlight release path
- `expo install --check`
- native permission audit
- verify no unintended Android AD_ID
- Google Play Data Safety aligned to actual code/SDK behavior
- Apple App Privacy aligned to actual collection
- Live Location disclosure: treat 5-decimal coordinates as precise location; foreground appointment functionality; not tracking
- privacy policy updated for actual data collection/sharing/retention
- account deletion flow/URL verified
- store reviewer credentials/instructions where required
- screenshots/metadata accurate
- crash-free launch and smoke tests
- physical-device QA complete
- rollback/recovery plan

No declaration should claim a feature/control exists unless the shipped app actually implements it.

---

# 9. POST-V1 / CONTROLLED EXPANSION BACKLOG

These are planned but must not destabilize V1. Execute only after #26 unless a dependency makes one necessary earlier.

## Customer/booking
- Authenticated Received Quotes inbox with secure identity linkage
- Authenticated Received Invoices inbox where identity linkage is unambiguous
- Secure one-tap rebooking links
- Waitlist
- recurring appointments
- memberships/packages expansion
- customer favorites
- richer booking history

## Business operations
- multi-location businesses
- richer staff shifts/recurring leave/rota
- own-commission view if privacy/product policy is defined
- inventory service-consumption recipes/BOM
- suppliers/purchasing
- stock transfers
- inventory reversal UX
- derived no-show counts in customer profile

## Finance
- deeper accounting integrations
- reconciliation workflows
- deposits/milestones only under explicit financial rules
- tips where appropriate
- tax/COGS/valuation only after accounting/product design

## AI
- web receptionist channel
- voice receptionist only after provider/cost/consent/recording policy decision
- additional channel adapters
- improved approval queue UX
- AI settings activity events
- evaluation dashboards

## Location/dispatch
- embedded map/ETA
- optional start-sharing notification
- background location only after explicit owner/store/privacy decision
- no historical employee surveillance

## Reputation/growth
- referral campaigns
- win-back campaigns
- compliant review integrations
- campaign analytics with privacy-safe attribution

## Platform
- richer admin console
- support tooling
- business data export improvements
- advanced observability
- enterprise controls if market demand justifies them

---

# 10. DEFERRED CLEANUP REGISTER

Handle opportunistically when touching the relevant subsystem; do not derail major roadmap stages.

- Quote native App/Universal Links readiness.
- Authenticated customer Received Quotes/Invoices when identity linkage is secure.
- Quote VIEWED event only if race-safe/idempotent first-view semantics are implemented.
- Refactor oversized quote/invoice services if complexity warrants it.
- Distinguish corrupt business-hours configuration from never-configured/default state rather than silently inventing availability.
- No-show outbound follow-up should be reviewed for durable outbox/event dispatch instead of only post-request best-effort execution. — DONE (#18): moved to the `sendDueCustomerAppointmentMessages` worker sweep with an atomic claim; the route no longer fires it.
- Marketplace category browse resolves the industry→category mapping partly in memory (not SQL-expressible), so a page for a very sparse category can come back short even though more matches exist beyond the fetch window. #19 widened the over-fetch to mitigate; a faithful fix needs either denormalising the resolved category onto the listing row or a paginate-until-full loop.
- Commissions remain operational estimates, not payroll/tax/payout.
- Inventory movement history remains immutable.
- Live Location remains ephemeral and appointment-scoped.

---

# 11. TESTING STANDARD FOR EVERY STAGE

Minimum where relevant:

- domain unit tests
- API happy path
- schema validation
- authorization/capability tests
- entitlement tests
- cross-tenant/IDOR tests
- idempotency/retry tests
- concurrency tests for state/financial/stock mutations
- provider failure tests
- no client-authoritative financial state
- AI tool-policy tests
- mobile TypeScript
- mobile tests
- backend production TypeScript
- backend test TypeScript
- targeted regression suite

A test that proves only the UI hides a control is insufficient for security.

---

# 12. MIGRATION STANDARD

- Prefer additive migrations.
- Never edit an already-applied production migration to change history.
- Never reset production.
- Never drop production data as a shortcut.
- Validate migration order and clean-DB install.
- Rehearse production-like upgrade for meaningful migration batches.
- Use explicit defaults/backfills before NOT NULL constraints where existing rows require it.
- Review enum deployment behavior.
- Keep Prisma schema, migration history and generated client aligned.
- After deployment verify `_prisma_migrations`/`prisma migrate status` and application health.

---

# 13. SECURITY NON-NEGOTIABLES

- Server-resolved tenant identity.
- Capability enforcement on backend.
- Cross-business references rejected.
- Customer-owned resources resolved through server-side ownership predicates.
- No self-role elevation.
- No arbitrary model/tool execution.
- No raw AI/provider secrets to clients.
- No payment success based on redirect/client claim.
- No permanent live-location history.
- No hidden employee tracking.
- No customer punitive score from no-shows.
- No destructive production action without explicit authorization and recovery readiness.

---

# 14. MOBILE/NATIVE BUILD RULES

The app contains native modules and is not an Expo Go target.

Use custom Expo development/release builds.

Known native dependencies include Google Sign-In, local call detection, IAP, Sentry, expo-location and expo-dev-client. Generated `ios/` and `android/` are CNG/gitignored unless repository state changes.

On Windows, Android builds are local according to project setup. iOS native builds require EAS/macOS/TestFlight workflow.

Do not remove native functionality merely to make Expo Go work.

---

# 15. AUTONOMOUS CONTINUATION BEHAVIOR

At startup, the coding agent must:

1. Read this roadmap.
2. Read repository status/history and relevant engineering docs.
3. Determine the earliest unfinished stage.
4. Verify the baseline.
5. Continue from there.
6. After each stage, write a completion report in `docs/progress/` (create directory if needed) with:
   - architecture reused
   - decisions
   - files changed
   - migrations
   - security findings
   - tests
   - commits
   - limitations
   - next stage
7. Update this roadmap's status markers when materially necessary, without rewriting locked product rules casually.
8. Continue automatically.

Do not repeatedly ask the owner “should I continue?” after green stages.

When an external owner action blocks only one part, document it in `docs/OWNER_ACTIONS.md`, continue every independent safe task, and return to the blocked item later.

---

# 16. DEFINITION OF DONE FOR THE APP

Chakusa is release-ready only when:

- core business and customer workflows are complete
- remaining roadmap stages through #26 pass
- migrations are reconciled/deployed
- no unresolved P0/P1 security issues
- financial truth is provider/server verified
- AI actions are policy/tool authorized
- tenant isolation is proven
- privacy/store declarations match shipped behavior
- production monitoring/recovery is ready
- native release builds succeed
- manual physical-device QA passes
- store submission assets/declarations are accurate

Until then, the agent should continue the roadmap rather than declaring the whole application finished.
