# Store compliance follow-up: reports, blocking, privacy, call line (2026-10-31)

**Stage:** #26 Release Readiness & Store Compliance. **Status:** engineering done; console items stay with the owner (OA-24, OA-26).

## Baseline inspected
`docs/progress/2026-10-30-store-compliance-audit.md` (report reasons, review reporting, AI consent, renewal terms, privacy/AI disclosure, foreground service, guest browsing were already fixed there), the customer inquiry module, privacy and terms pages, the Automation screen.

## Implementation
- **Report and block on message threads (Apple 1.2, Play UGC).** `POST /customer/inquiries/:id/report` (writes to the existing moderation queue as a business report with the thread id) and `PUT /customer/inquiries/:id/block`. New `customer_business_links.blocked_by_customer` (additive, default false). A blocked business cannot reply (`sendBusinessInquiryReply`) and the customer cannot send until unblocked. The thread screen has a menu with Report (4 reasons) and Block/Unblock, and a blocked bar.
- **Terms:** new "Objectionable content and reporting" clause (what is not allowed, how to report and block, moderation, contact).
- **Privacy policy:** Resend (account emails), Cloudflare (website, sign-in gateway, DNS, email forwarding), OpenRouter (AI routing), Twilio voice call-line calls (caller number and time only, no recording), and the iPhone call-forwarding path in the missed-calls row.
- **iPhone missed calls:** Automation screen explains the iOS limit and shows the business's call line with the dial codes; `/webhooks/twilio/voice` turns a call on the line into a missed-call lead (shipped earlier, `b3a39fa`). Fixed a character-encoding slip in that commit (a curly apostrophe saved as a single byte).
- **Reviewer notes:** `docs/APP_REVIEW_NOTES.md`.

## Authorization / tenant model
Customer routes use `authenticateCustomer` and `ownedThread` (a customer can only report or block their own thread; another customer gets 404). The voice webhook verifies Twilio's signature and resolves the business only from the dialled number.

## Migrations
`20261031120000_customer_blocks_business` (additive column with default). `20261030120000_business_call_line` already deployed.

## Tests
Backend: `tests/inquiry-block-report.test.ts` (3), call-line webhook tests (2), existing inquiry/marketplace/leads suites. Mobile: `tsc` clean, vitest all pass, eslint clean on changed files. Website build passes (91 pages).

## Unresolved limitations
- No automatic word filter on messages or reviews: objectionable content is handled by reporting, blocking, moderation and the Terms. A keyword filter can be added later.
- Twilio account is a trial: the call line only accepts verified callers. UAE numbers cannot be verified on a trial, and the owner's carrier refuses forwarding to US numbers (OA-26).
- A business cannot yet report a customer message from the business inbox (customers can be blocked by the business already).

## Owner actions
OA-24 (store-console declarations), OA-26 (Twilio upgrade, call-line number for UAE), OA-18 (Starter product metadata, agreements), OA-21 (reviewer logins).

## Next stage
Owner completes the console items, then store submission.
