# Premium customer UX, keyboard/chat, device reach, assistant fix (2026-10-20/21)

**Status:** complete in code, pushed; Android vc6 ready to build (owner runs the signed build). iOS build intentionally not started (owner request).

## Owner requests and outcome
| Request | Outcome | Commits |
|---|---|---|
| Play: vc5 dropped ~5,209 devices | minSdk 29→24 (React Native floor), camera/location/telephony/microphone/portrait `required=false`; app-integrity check falls back below Android 9/11; regression test | `f67577d` |
| Customer delete account | Permanent deletion with password/Google/Apple re-auth + final Yes/No, shared with business (`/customer/auth/delete-account`) | `84f1d79`, `74edd7a` |
| Sign out / switch business↔customer must ask | Shared bottom-sheet Yes/No (`components/ConfirmSheet.tsx`) | `74edd7a`, `5679ad7` |
| Keyboard covers messages; must feel like WhatsApp | Chat kit: fixed header, only messages scroll (inverted list, day chips, bubbles, typing dots), composer moves with the keyboard frame by frame (`react-native-keyboard-controller` + reanimated, Expo SDK 57 pins). Forms use `KeyboardAwareScrollView`. Root cause: edge-to-edge (Android 15) disables `adjustResize` | `74edd7a`, `5679ad7` |
| Time overlaps message text | Time sits beside short messages, wraps under long ones | `5679ad7` |
| Assistant not premium / "internal error" | Redesigned; vendor failures → 503 `AI_UNAVAILABLE`; failed turn no longer leaves the question behind. **Root cause in production: Gemini HTTP 400** - tools were declared with empty `parameters`; tools now carry real parameters (Zod → Gemini-safe JSON Schema), argument-free tools omit `parameters` | `87d1e98`, `5679ad7`, `fee0771` |
| Notifications not premium | Redesigned (All/Unread, Today/This week/Earlier, category colours, taps deep-link) | `74edd7a` |
| Currency / time zone / language must be dropdowns | Searchable `SelectField` (business settings, customer profile); server now accepts current IANA names (Asia/Kolkata, Europe/Kyiv) | `74edd7a`, `62087a9`, `5679ad7`, `c528427` |
| Explore must open on the map; choosing a business shows its interior | Map-first Explore (asks location once, Harare fallback); business page hero is the photo gallery with "1 / N", dots, full-screen viewer | `8a3d28e` |
| Everything premium | Home rebuilt, Account, tab bar and remaining customer screens on the premium palette; stuck pull-to-refresh spinner fixed on 15 screens | `8a3d28e`, `5679ad7` |
| Directions must use Google Maps (compliant) | Official keyless Google Maps URLs (`/maps/dir/?api=1&destination=`) - app if installed, web otherwise | `fee0771` |
| Business inbox polish | App customers named, CHAKUSA APP badge; readable industry; currency code in field | `c528427` |

## Verification
- Phone (Android 15, Expo Go against a LOCAL API + local test DB only): sign-up/sign-in, keyboard on forms and chats (customer and business), message bubbles, sign-out/switch/delete confirmations (incl. wrong-password refusal), time zone/language/currency dropdowns persisted, map-first Explore, interior gallery + viewer, business setup, business reply.
- Tests: backend suites for touched areas (auth/deletion 87, business 165, AI 112, assistant 14), mobile 611; typecheck clean.
- Production AI: Render logs showed `aiProvider.kind=bad_request status=400` before the fix; confirm with one assistant message after `fee0771` is live.

## Limitations / follow-ups
- iOS: changes are cross-platform (keyboard-controller has native iOS support, Google Maps URLs open the Maps app/Safari) but need the next iOS build to verify on device; held per owner.
- Login lock / reminder throttle remain in-process memory (single Render instance).
- Business screens keep the business (rust) theme by design; customer app is on the premium palette.

## Owner actions
- Run the release build (vc6) and upload `chakusa-v1.0.0-vc6-<date>.aab` to Play; discard the unpublished vc5 release.
- Send one message to the assistant in production after deploy to confirm Gemini answers.
