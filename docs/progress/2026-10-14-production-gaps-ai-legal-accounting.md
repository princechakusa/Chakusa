# Production gaps: AI, legal, "coming soon", double back buttons, accounting export

**Status:** code complete, tested and deployed (API on Render, website on
Cloudflare Pages). iOS build 7 is going to TestFlight with auto-submit.
The production switches that need owner credentials are listed in
`OWNER_ACTIONS.md` (OA-10, OA-11, OA-12).

## What the owner reported, and what was found

| Report | Cause | Fix |
|---|---|---|
| AI not working | No ACTIVE model in the registry and no provider key in production. There is no deployed admin console to add either. | `src/lib/ai/bootstrapModel.ts` registers `OPENAI_DEFAULT_MODEL` at startup when no model is active. OpenRouter free models work through `OPENAI_BASE_URL` (OA-12 #1). |
| Terms: "This document hasn't been published yet" | Production had no published Legal Platform documents (all 404). | The owner confirmed the text is reviewed. `ensureDefaultLegalDocuments()` publishes v1 at startup and never edits existing versions. All four documents now return 200 in production. The apps fall back to the website copy if a document is ever missing. |
| "Coming to Chakusa": AI receptionist, quotes, invoicing, marketplace, accounting | A stale, hard-coded card. Four of the five already ship. | Now "Included in Chakusa", and each row opens its real screen. Accounting ships as a CSV export (QuickBooks/Xero import). Direct sync has no provider adapters yet. |
| Double back buttons (More, estimates) | 8 screens drew their own header and also kept the stack header. | Stack header hidden on those screens. The Quotes and Invoices lists get their own back arrow. |
| Google Sign-In not working | The iOS client ID belongs to an unreachable old Google Cloud project, while the web client is in project 1004047431327. | Needs a new iOS OAuth client in the Chakusa project (OA-12 #2), then an iOS rebuild. |
| Missed calls did nothing | Detection is Android-only (iOS gives apps no call access). The Android AAB is blocked on the lost keystore password (OA-11). Twilio SMS is not live yet (OA-10). Automation screens defaulted to off in production. | `app.automation_enabled` now defaults to on (verified in production). The rest are owner actions. |

## Security and tenancy

- **Accounting export:** the link needs `financial.report.view` and the
  accounting entitlement. The link is HMAC-signed for 10 minutes and bound
  to the business and the period. The download is rate-limited, `no-store`,
  and neutralises spreadsheet formulas. A forged business ID gets 403.
- **AI bootstrap:** only runs while no model is ACTIVE, so admin-managed
  models always win.
- **Legal bootstrap:** only creates v1 for document types that have no
  version at all.

## Tests

- New test files:
  - `tests/accounting-export.test.ts`
  - `tests/ai-bootstrap-model.test.ts`
  - `tests/legal-default-documents.test.ts`
- Updated: the app-config default test, and the mobile capabilities test
  (every capability routes to a real screen; no "coming" copy).
- Backend full suite: 1671/1672 passed. The one failure was a fixed 300 ms
  timer wait in the lifecycle worker test (failed 1 run in 3). It now polls
  and passed 5 out of 5 runs.
- Mobile: 544/544 tests pass and the typecheck is clean.
- Production checks after deploy: four legal documents return 200,
  `/app-config` reports `automation: true`, and `/accounting/export-link`
  returns 401 without authentication.
