# Stage 12.5 — Commercial readiness and subscription value audit

Audit date: 2026-08-25  
Audited revision: `4217a99`  
Scope: existing backend, mobile app, worker, admin console, billing/provider adapters, tests, and launch documentation. No production behavior was changed during this audit.

## 1. Scores

### Commercial Readiness: 63/100

The product foundation is strong: core booking, customer recovery, appointment operations, payments, automation, reports, mobile flows, security controls, and admin operations exist. The score is reduced by unverified live providers, missing store/product configuration, no completed beta cohort, incomplete support operations, and commercial metrics that are not yet proven with real businesses.

### Subscription Value: 76/100

The paid proposition is credible because Chakusa can recover missed demand, automate follow-up, collect appointment revenue, request reviews, and show business activity. The score is reduced because value is distributed across several screens, some ROI measures are incomplete, general customer email is not a messaging channel, and the trial-to-paid promise has not been validated with real businesses.

## 2. Business-value audit

| Capability | Saves time | Revenue impact | Workload reduction | Retention/reputation | Measurable evidence today | Commercial assessment |
|---|---|---|---|---|---|---|
| Public booking | Yes | Booked appointments | Yes | Better response experience | bookings, appointment value | Strong activation feature |
| Appointment management/calendar | Yes | Prevents scheduling loss | Yes | Fewer missed/rescheduled jobs | status, completion, paid amount | Strong operational value |
| Reminders/follow-up | Yes | Recovers opportunities and balances | Yes | Return visits and fewer no-shows | sent timestamps, messages, runs | Strong, provider-dependent |
| Lifecycle automation | Yes | Lead and retention recovery | Yes | Win-back and review follow-up | run status, attempts, failures | Strong paid differentiator |
| Payments/deposits | Yes | Direct collection | Reduces chasing | Trustworthy checkout | transactions, refunds, balances | Strong ROI feature |
| Reviews | Some | Indirect conversion/reputation | Yes | Reputation improvement | requests, reviewed status, ratings | Valuable but outcome attribution is limited |
| Weekly reports | Yes | Shows collected/outcome value | Yes | Encourages continued use | report summary, push/email attempt | Strong retention feature after live delivery |
| Insights/coaching | Some | Identifies opportunities | Some | Flags dormant/at-risk customers | dashboard aggregates and deterministic recommendations | Valuable, but ROI needs clearer prominence |
| Imports | Immediate setup time | Preserves existing opportunity data | Yes | Enables continuity | created/skipped/failed results | Strong onboarding utility |
| External calendars | Yes | Prevents missed appointments | Yes | Better operational reliability | subscription access/revocation | Strong approved-scope feature |
| Team/account/security | Yes | Protects operations | Yes | Trust and continuity | sessions, devices, roles, audit logs | Essential trust layer, not primary upgrade hook |

## 3. Revenue proof gaps

Existing screens already show recovered revenue, appointment collected/outstanding amounts, booked value, completed appointments, customer messages, reviews, automation status, and weekly summaries. The following are still missing or incomplete as first-class proof:

- Revenue saved/prevented with an explicit deterministic definition.
- Potential revenue from open leads, unpaid balances, cancelled appointments, and at-risk customers in one consistent view.
- Appointments recovered as a distinct metric rather than inferred from several screens.
- End-to-end automation funnel: sent → delivered/opened → response → booking → payment → revenue.
- Time saved based on recorded automation actions and a documented time-per-action assumption; never present an invented estimate as fact.
- Marketing/source attribution beyond public-vs-staff booking and payment rail attribution.

## 4. Automation ROI audit

Automation runs expose pending/running/completed/failed states, attempts, error categories, provider message links, and delivery statuses. The current model does not consistently capture opened, responded, booked, or paid outcomes for every automation type. Review requests and appointment payments have downstream records, but they are not unified into one automation ROI funnel.

Recommended deterministic join keys are the existing `AutomationRun`, `Message`, `Lead`, `ReviewRequest`, `Appointment`, and `AppointmentPaymentTransaction` relations. Do not create a second attribution system.

## 5. Subscription value

### Features that can convince owners to subscribe

1. Missed-call and quiet-lead follow-up that runs without the owner remembering.
2. Deposits, payment links, balance reminders, and refunds that directly protect cash flow.
3. A weekly report that proves bookings, completed work, collected revenue, reviews, and customer activity.
4. Public booking plus availability conflict prevention.
5. Customer win-back and review workflows with clear outcome evidence.
6. Calendar subscriptions, imports, and team controls that reduce operational friction.

### Technically complete but commercially weak

- The Pro screen lists features but does not yet lead with a quantified owner outcome or a concise “value created this month” narrative.
- The Business tier mainly communicates team seats; it needs a clear operational/team ROI story before launch.
- Advanced analytics exist, but the most important revenue opportunities are not yet the first visual hierarchy on app open.
- Weekly reports are generated, but their commercial impact depends on real push/email delivery and owner engagement.
- Trial messaging records activity, but there is no proven trial activation-to-paid conversion path.
- Support exists technically, but response expectations and refund guidance are operationally undefined.

## 6. Missing revenue opportunities

- Unpaid completed appointments without a usable payment link.
- Cancelled appointments that could be rebooked.
- No-shows without a deterministic recovery prompt.
- Completed appointments without a review request.
- Dormant high-value customers without a return booking.
- Leads that were contacted but never booked.
- Businesses that configure Chakusa but never publish a bookable service.
- Businesses with automation configured but no provider delivery.

## 7. Ranked improvements by expected ROI

### P0 — unify the owner value proof

Reuse existing dashboard/subscription aggregates to make one owner-facing value panel: collected revenue, outstanding revenue, booked value, recovered leads, completed appointments, reviews earned, automation runs, and explicit next opportunities. This is the highest-impact commercial improvement because it changes perceived value without creating a parallel calculation system.

### P0 — complete the automation outcome funnel

Reuse existing relations to expose downstream outcomes for each automation class: delivery, response, booking, payment, and revenue. Keep unknown values explicitly unknown; never infer success from a sent message alone.

### P1 — make trial success deterministic

Use the existing activation journey and subscription value data to define trial milestones: setup complete, first booking, first automated follow-up, first completed/paid appointment, first review, and first weekly report. Test conversion with real store products.

### P1 — strengthen paid-tier packaging

Keep the current entitlement authority, but express tiers in owner outcomes: recovery automation, revenue collection, reporting, team operations, history, and analytics. Final prices and limits require owner approval and beta evidence.

### P1 — close operational recovery gaps

Add deterministic paths for cancelled/no-show recovery and completed unpaid appointments, reusing existing appointment, reminder, payment, and automation services.

### P2 — improve delight through business milestones

Add restrained, evidence-backed milestones such as first recovered booking, first paid appointment, first review, and monthly recovery summary. No points or speculative claims.

### P2 — instrument commercial beta success

Create a platform-level admin beta view using existing aggregates and audited access: onboarded, active, first booking, automation delivery, payments, reviews, weekly report delivery, retention at 7/14/30 days, and trial conversion.

## 8. Commercial-readiness blockers

1. Stripe live credentials, Connect onboarding, webhook replay, payment/refund validation.
2. Apple/Google product IDs, credentials, signed notifications, sandbox and production purchase tests.
3. Twilio SMS sender, WhatsApp sender approval, opt-out, delivery callbacks, limits, and cost monitoring.
4. Resend verified domain and report/invitation/password email delivery.
5. Expo/Sentry DSNs and verified alert destinations.
6. Worker deployment, heartbeat, retries, and scheduled-job observation.
7. Isolated database integration suite execution with a real test database.
8. Physical iOS/Android acceptance, offline/retry/account recovery behavior.
9. Support response policy, refund guidance, escalation ownership, and privacy/terms/store listing review.
10. 15–20-business beta with recorded activation, revenue, retention, and trial conversion evidence.

## 9. Final recommendation

Do not launch broad paid acquisition yet. The architecture is suitable for a controlled commercial beta, and the product has a credible subscription thesis. First implement the P0 owner value proof and automation outcome funnel, then run the documented provider/device/beta acceptance gate. If the beta demonstrates recovered or collected revenue exceeding the subscription price for a meaningful share of businesses, Chakusa is ready to scale the paid proposition.

No production code was implemented during Stage 12.5. This audit requires approval before any recommended changes are made.
