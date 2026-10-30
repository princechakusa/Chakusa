# Store compliance audit: App Store + Google Play (2026-10-30)

**Stage:** #26 Release Readiness & Store Compliance (re-audit before submission). **Status:** engineering fixes done; console items are owner actions (OA-24).

## Baseline inspected

- `mobile/app.json`, config plugins, the generated Android manifest and the **merged release manifest of the vc11 build** (`android/app/build/intermediates/merged_manifests/release/...`).
- Call detection module (`mobile/modules/chakusa-call-detection`), its disclosure (`domain/permissionDisclosure.ts`) and the Automation screen flow.
- Subscription screen (`ProScreen.tsx`, `domain/planCatalog.ts`, `BillingContext.tsx`), account deletion (business + customer, Apple token revocation in `src/modules/auth/accountDeletion.ts`).
- UGC surfaces (marketplace business profile, customer reviews) and the backend report route.
- AI surfaces (customer assistant, business AI receptionist) and providers registered on the server (OpenAI, Anthropic, Gemini).
- Website `privacy.astro`, `ai-disclosure.astro`, `delete-account.astro`, `terms.astro`.
- Previous audit: `docs/RELEASE_READINESS_CHECKLIST.md`.

## Already compliant (verified, no change)

| Area | Evidence |
|---|---|
| Play target API level (API 36 required for updates after 2026-08-31) | merged manifest `targetSdkVersion="36"` |
| No advertising ID / tracking | no `AD_ID` permission; iOS `NSPrivacyTracking: false`, privacy manifest present |
| No restricted Android permissions | no SMS/call-log, `QUERY_ALL_PACKAGES`, exact alarm, full-screen intent, `READ_MEDIA_*`, background location |
| Photo access | system photo picker only, camera and microphone permissions removed |
| Sensitive permission disclosure (Play User Data) | in-app prominent disclosure before the call-screening role, `READ_PHONE_STATE` and `READ_CONTACTS` prompts |
| Account deletion in app + on the web (Apple 5.1.1(v), Play) | business + customer delete screens; `/delete-account` page; Sign in with Apple tokens revoked on deletion |
| Sign in with Apple offered next to Google (Apple 4.8) | business and customer auth |
| Digital subscriptions use IAP; restore purchases; manage/cancel link; Terms + Privacy links | `ProScreen.tsx` |
| Encryption export flag | `ITSAppUsesNonExemptEncryption: false` (HTTPS only) |
| Location purpose string is specific; foreground only | `app.json` expo-location plugin |
| 18+ sign-up | committed in `6aa5a9e` |

## Issues found and fixed

| # | Policy | Problem | Fix |
|---|---|---|---|
| 1 | Apple 1.2 (UGC), Play UGC policy | "Report this business" sent labels such as `Spam or scam`; the API only accepts `spam`/`inappropriate`/`closed`/`wrong_info`/`scam`/`other`, so **every report failed silently** (400, error swallowed). Customer review text had no report option. | Labels mapped to the API reasons (`MarketplaceReportReason`), a "Report" link on every review (sent as a business report with the review in `detail`, same admin queue), and a visible error when sending fails. |
| 2 | Apple 5.1.2(i) (share personal data with third-party AI only with explicit permission), Play User Data | Customer AI assistant sent messages + account context to OpenAI/Anthropic/Gemini with no consent; the AI receptionist switch turned on with no disclosure. | `domain/aiDataSharing.ts` disclosure copy. Assistant shows a consent card and sends nothing until "I agree" (stored per user on the device, `services/aiConsent.ts`). The AI receptionist asks for confirmation every time it is switched on. |
| 3 | Apple 3.1.2 / Schedule 2, Play Subscriptions policy | Free-trial label did not say what is charged after the trial; renewal terms were one short sentence. | Trial reads "7-day free trial, then $3.00 / month"; full renewal terms (who charges, auto-renew, cancel 24 h before period end, how to cancel, no charge if cancelled in the trial). Tests in `planCatalog.test.ts`. |
| 4 | Play foreground service declaration | expo-location's library manifest adds `LocationTaskService` with `foregroundServiceType="location"` though the app never tracks in the background. | `withAndroidSecurity` removes it (`tools:node="remove"`); same line added to the git-ignored native manifest. Test in `androidDeviceSupport.test.ts`. |
| 5 | Apple 5.1.1(i), Play User Data (privacy policy must cover all collection) | Privacy policy said "approximate location" (app collects precise location for nearby search, business pin and arrival sharing), did not mention missed-call detection, photos, Gemini, Meta WhatsApp or Nominatim. AI disclosure still described the consent gap. | `privacy.astro` and `ai-disclosure.astro` updated to match the shipped apps. |

## Tests

- Mobile: `tsc --noEmit` clean; vitest **66 files / 619 tests passed**; eslint 0 errors on changed files (one existing unused-import warning in `AiReceptionistScreen.tsx`).
- Website: `astro check` 327 files 0 errors; `astro build` complete.
- The merged Android manifest without `LocationTaskService` is confirmed on the next local release build (grep the merged manifest; see OA-24).

## Commits

- Mobile app changes landed in `1a08d2f` (a parallel session's commit picked them up from the shared working tree).
- Plugin, website and docs: this stage's commit.

## Limits not fixed (product decisions)

- ~~Customer marketplace needs sign-in to browse.~~ **Fixed 2026-10-30 (Apple 5.1.1(v)).** The customer sign-in screen has "Browse without an account": guests get Explore (search, map, categories, nearby) and business profiles from the new unauthenticated `/public/marketplace` routes (same public listing data, records no searches or views, 120 requests/min per IP). Booking, messaging, favourites, follow, share, report, rewards/memberships and the AI assistant ask the guest to sign in. Tests: `tests/public-marketplace.test.ts` (4) plus the existing marketplace suites, and an e2e guest journey (27/27 e2e).
- The web dashboard's AI receptionist toggle does not show the confirmation the app shows (not part of store review).
- Admin transcript visibility is still unredacted (`docs/PRIVACY_ENGINEERING_FOLLOWUPS.md`).

## Owner actions

OA-24 in `docs/OWNER_ACTIONS.md` (store-console declarations).

## Next stage

Owner completes OA-24 / OA-21 / OA-18, then new store builds with these changes.
