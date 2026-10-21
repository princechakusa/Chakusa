# 2026-10-21 — Android vc8, Play "not genuine" fix, build hardening

**Status:** Android vc8 AAB built and verified; iOS build 10 started on EAS.

## Issues found and fixed

| Issue | Cause | Fix |
|---|---|---|
| `npm run android:bundle-release` failed: `'gradlew' is not recognized` | cmd.exe skips the current directory when `NoDefaultCurrentDirectoryInExePath` is set (Git Bash, agent shells) | `mobile/scripts/eas-env.mjs` resolves the wrapper in `--cwd` to an absolute path (`bd21733`) |
| Release build failed: toolchain does not provide `[JAVA_COMPILER]` | `JAVA_HOME` points at a JRE | `eas-env.mjs` detects a missing `javac` and falls back to an installed JDK 17, or stops early with a clear message (`387bd9f`) |
| Play rejected vc6: "Version code 6 has already been used" | A vc6 had already been uploaded | versionCode 7, then 8 (`4b40cdf`, `ba13873`) |
| Play installs showed "This copy is not genuine" | The recorded Play app-signing "SHA-1" was the first 20 bytes of its SHA-256, so it never matched a device | Real SHA-1 and SHA-256 read with `apksigner` from a Play-installed copy; test rejects any wrong-length fingerprint (`ba13873`) |
| Google Sign-In on Play installs could not work | Same wrong SHA-1 on the "Chakusa Android (Play)" OAuth client | Owner corrected it in Google Cloud; verified on reload (`d5db24f`) |
| Assistant down | Gemini fails every request (`/health/ai`: successRate 0). Google Cloud free trial ended; upgrade deadline 2026-11-04 | Owner to add an OpenAI key and model in the admin console (see Owner actions) |
| Admin "Add model" never usable by assistants | Form defaulted capability `chat`; assistants require `conversation` | Defaults now `conversation,classification,extraction` / `customer_agent,customer_assistant,ai_receptionist`; gemini listed (`dcca7af`); admin redeployed |

## Hardening

- `npm run ios:release` (`e6ae45c`): blocks before the EAS build when EAS is logged out, `buildNumber` is not above the last EAS iOS build, or typecheck fails; always `--auto-submit` to TestFlight.
- Local release artifacts are stored in `builds/android/` (gitignored, `f726403`) and `C:\Users\Dev Prince\.chakusa\android\`.

## Artifacts

- `chakusa-v1.0.0-vc8-2026-10-21.aab`, SHA-256 `378c71dfcdc5435cf5f3d94974ef917a6939d476a54473ddf13783238f8fe5df`, signed with upload key `03:A5:…:F8:F3`, `jarsigner -verify` passes, contains the corrected fingerprints and the recent UI. vc6 and vc7 must not be uploaded.

## Tests

- `src/domain/appIntegrity.test.ts` 9/9; mobile `tsc --noEmit` and admin `tsc --noEmit` clean.

## Owner actions

- Upload vc8 to Play.
- Upgrade Google Cloud billing before 2026-11-04 to protect Google Sign-In (OAuth clients live in that project).
- Admin console: add the OpenAI key (Settings → Provider credentials), add and activate the OpenAI model, disable the Gemini model.
- Replace or remove the expired `CLOUDFLARE_API_TOKEN` environment variable.

## Next stage

Controlled production deployment/migration checkpoint before #18, per the roadmap.
