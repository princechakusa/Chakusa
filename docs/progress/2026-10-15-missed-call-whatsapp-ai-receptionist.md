# Missed call → WhatsApp → AI receptionist → booking → review (2026-10-15)

**Status:** code complete and tested. Production activation is waiting on owner
console settings (`docs/OWNER_ACTIONS.md` OA-13).

## Baseline inspected (production + owner's Android phone)

- `/health/ai`: Gemini key present, `configured:false`, no active model.
- `/health/worker`: `unavailable`, last success 2026-08-31. No scheduled
  message had been sent since then.
- Phone (Honor LGN-LX2, Android 15, dev build): Chakusa held none of
  READ_PHONE_STATE, READ_CONTACTS or POST_NOTIFICATIONS, and did not hold
  the call-screening role, so calls were invisible to it. After granting
  these, Telecom bound `ChakusaCallScreeningService`, and both owner test
  calls reached production as missed-call leads.
- The owner's business was on the Free plan: the complimentary grant didn't
  match the sign-in email.

## Defects found and fixed

| Defect | Effect | Fix |
|---|---|---|
| `routeAI` always passed `tools: []` | The AI could never check availability or book | Gateway accepts tool declarations; agent offers all receptionist tools with JSON schemas and descriptions (Gemini/OpenAI/Anthropic) |
| Published prompt's system prompt dropped | Receptionist instructions never reached the model | Agent prepends the rendered system prompt; adds `now` to context |
| No published platform prompts in production (seed never ran) | Every AI turn would fail "No prompt template published" | `ensurePlatformPrompts` publishes v1 of missing platform prompts at startup; receptionist prompt rewritten (short replies, booking procedure, escalation, no payments) |
| Missed-call scheduler only matched `channel: "SMS"` rules | The app's WhatsApp channel choice was silently ignored | WhatsApp rule preferred, else SMS; exactly one follow-up |
| WhatsApp business-initiated free text | Rejected by WhatsApp outside 24h window (63016) | Twilio Content templates (`TWILIO_WHATSAPP_*_CONTENT_SID`) for missed-call and review messages |
| Automated outbound not threaded into a conversation | AI didn't see what Chakusa sent when the customer replied | `findOrOpenConversation` shared by inbound and executor |
| Shared sender: inbound matched to every business with that phone | Several businesses' AIs could answer one reply | AI turn only for the business that last messaged the customer |
| Worker loop never ran `sendDueReviewRequests` / location-share expiry | Automatic review requests never sent by the worker | Added (parity with HTTP-tick path) |
| No worker deployed | Nothing scheduled ever sent | `RUN_WORKER_IN_API` runs the worker in the API process |
| Review requests SMS-only | No WhatsApp review asks | Channel follows the customer's latest conversation channel |
| Repeat calls opened duplicate leads | Caller would get two follow-ups | Repeat call within 24h joins the untouched lead |
| No in-app autonomy control (default DRAFT) | AI could only draft | Receptionist screen autonomy selector → audited `setPolicyMode` (keeps rules and the payment denial) |
| Platform AI switch only via admin | "Contact support" | `AI_CUSTOMER_AGENT_ENABLED` creates the platform flag if no admin row exists |
| Lead screen showed no follow-up | Owner couldn't see what was sent | Lead detail shows the run state/reason and the WhatsApp/SMS messages and replies |
| Notification channel `sound: 'default'` | Red console error on every launch | Removed (channel default sound is the system sound) |

## Security / tenancy

- Tool requests from the model are still proposals: Zod re-parse, Tool Broker,
  Policy Engine TOOL_EXECUTION checkpoint and ownership checks are unchanged.
- Autonomy changes require `automation.manage` and the AI_RECEPTIONIST
  entitlement, and go through draft → activate with `AIPolicyChange` audit.
- Inbound AI routing never crosses tenants: each business's inbound is still
  recorded only under its own customer; the AI runs for at most one.
- Startup bootstraps never override existing admin decisions (flag) or
  existing prompt versions.

## Migrations

None.

## Tests

- Backend: 138 files / 1686 tests passed (full suite), plus a re-run of the
  7 changed files (95 tests).
- Mobile: 56 files / 544 tests passed, plus the new `leadFollowUp.test.ts`.
- Typecheck clean (API, tests, mobile); ESLint 0 errors.
- On device: missed-call detection → production lead verified with two real calls.

## Limitations

- SMS to UAE numbers is blocked by sender type (OA-13 item 4).
- LEAD_FOLLOW_UP / retention WhatsApp sends have no template yet; they work
  only inside the 24h window.
- Dual-SIM: call state is read from the default SIM (existing V1 limitation).

## Next

Owner completes OA-13. Then run the live chain end to end on the phone:
missed call → WhatsApp → reply → AI books → complete → review request.
