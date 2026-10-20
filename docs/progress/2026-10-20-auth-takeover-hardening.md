# Forgot-password fix and account-takeover hardening (2026-10-20)

**Status:** complete; API deployed via Render auto-deploy; Android vc4 build prepared.

## Baseline inspected
- Live: `/app-config` reports `passwordReset: true`; Resend domain `chakusarecovery.com` verified; Render on latest master.
- Root cause of "no email": the reporting account was created with Google (no password). The old code sent nothing for it. Render logs showed the requests at 18:38–18:42, all before the fix; Resend showed no `POST /emails` at all.

## Implementation
| Commit | Change |
|---|---|
| `7ba51cd` | Google/Apple-only account → "How to sign in" email (no link), 1 per 10 min, identical HTTP reply |
| `aee36ef` | Customer reply/app copy no longer promise a "reset link" |
| `d516f14` | Logs which path a reset took and Resend's error (never the address) |
| `53c302e` | Takeover hardening (below), configurable email footer (admin App config), Android vc4 |
| `449ef84`, `79f5918` | Android Google sign-in always shows the account chooser (iOS flow unchanged); vc5 |

## Threat review of the reset/sign-in path
| Attack | Status |
|---|---|
| Guess/brute-force a reset token | Not feasible: 384-bit random secret, SHA-256 stored, constant-time compare |
| Reuse an old/leaked link | Single use, 60-min TTL, a new request voids older links, a reset voids all links |
| Keep access after a reset | Every session revoked on reset; "password changed" notice emailed |
| Email enumeration | Same reply whether or not an account exists; mail sent after the response |
| Inbox flooding | Per-IP route limits + 1/min and 5/hour per account; reminders 1/10 min |
| Host-header / link poisoning | Link base is fixed config (`PASSWORD_RESET_URL`), never the request |
| Lookalike/Unicode address steering | **New:** mail goes to the address stored on the account, never the typed text |
| Token leaking via Referer/history | Website: `Referrer-Policy: no-referrer`, token removed from URL on load, `no-store` |
| Bots on the web flow | Gateway requires Cloudflare Turnstile, 12+ chars with mixed case and digit |
| Distributed password guessing | **New:** 10 wrong passwords per email / 15 min → 429 for that email (exists or not); reset clears it |
| Hash-cost DoS (huge password) | **New:** new passwords ≤ 128 chars, sign-in ≤ 1024 |
| Weak replacement password | **New:** common-password blocklist on reset and change |
| Google pre-hijack (attacker pre-registers victim's email) | Google never auto-links to an existing email (409 `ACCOUNT_LINK_REQUIRED`) |
| Unverified email after reset | **New:** completing a reset marks the email verified |

## Tests
- `tests/account-takeover-hardening.test.ts` (4): per-account lock incl. unknown email, reset clears lock + verifies email, common/oversized passwords refused, mail to stored address.
- Full backend suite: 148 files / 1760 tests passed. Mobile: typecheck clean, 64 files / 604 tests passed.
- Device: signed vc5 APK (Play upload key SHA-256 03:A5:1A:46:...) installed on the Android test phone and launches.

## Limitations
- Login lock and reminder throttle are in-process memory (one Render instance today). Move to Redis/DB before scaling out.
- Common-password list applies to reset/change, not registration (registration UI on web already enforces 12+ mixed).
- A locked account is locked for everyone for up to 15 min (owner can still use Google/Apple or reset).

## Owner actions
- Run the release build script (needs the upload-key password from the password manager).
- Upload `chakusa-v1.0.0-vc5-2026-10-20.aab` to Play Console (supersedes vc4).
- Set **Registered address** in admin App config to show it in email footers.
- iOS build 9 predates the map-first Explore; a new iOS build is needed for it (held at owner's request).

## Next stage
Controlled production deployment/migration checkpoint before #18.
