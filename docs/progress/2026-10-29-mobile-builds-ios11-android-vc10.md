# Mobile builds: iOS build 11 and Android versionCode 10

**Status:** both built and delivered.

## Contents
Both builds include the new SMS/WhatsApp consent wording ("Text messages: I agree to receive SMS text messages from Chakusa on behalf of {business} ...") and the sender naming change, plus the zod 4 backend contract (no mobile API change).

## iOS
- Built on EAS (production profile) with `--auto-submit`, so it went straight to TestFlight. buildNumber 11.
- First attempt failed before any EAS build was created: the project upload hit `EBUSY` on a locked Gradle file because the local Android build was running at the same moment. Fix: run the two builds one after the other (iOS upload first, then Android). buildNumber 11 was not consumed.

## Android
- Local Windows build, `npm run android:bundle-release`, signed with the upload keystore from `C:\Users\Dev Prince\.chakusa\android\` (stored outside git; no secrets in the repo).
- First attempt failed on a corrupted Gradle cache entry ("immutable workspace modified"). Fix: stopped the Gradle daemons, deleted that one transform-cache directory, rebuilt.
- Result: `chakusa-v1.0.0-vc10-2026-10-29.aab`, 60,031,549 bytes, jar-verified, signed by the same certificate as vc9 (SHA-256 03:A5:1A:46:...:F8:F3). Stored in `builds\android\` (gitignored) and `C:\Users\Dev Prince\.chakusa\android\`.
- versionCode 10 is set in `mobile/app.json` (committed) and the generated, git-ignored `android/app/build.gradle`.

## Next
Upload the AAB in Play Console and promote the TestFlight build when ready.
