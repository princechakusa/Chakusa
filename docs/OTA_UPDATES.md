# Over-the-air (OTA) updates

The apps use `expo-updates` with EAS Update. JavaScript and in-app assets can ship without a store build.

## What an OTA update can change
- Screens, text, layout, colours, navigation, business logic and bug fixes.
- Images, icons and fonts used inside the app (including the logo shown in the app).

## What still needs a new store build
- The home-screen app icon, splash screen, app name and permissions.
- Any new or upgraded native library (anything that changes `package.json` native modules), Expo SDK upgrades, or `app.json` native config.
- When native code changes, bump `expo.version` in `mobile/app.json` (e.g. 1.0.0 → 1.0.1) before building. `runtimeVersion` follows the app version, so updates only reach builds with matching native code.

## Publish an update (production)
```powershell
cd mobile
npm run ota:production
```
This applies the `production` env from `eas.json` (live API URL etc.) and runs `eas update --channel production --auto`,
using the latest commit message. Users get it the next time they open the app (downloaded in the background,
applied on the following launch).

## Channels
- iOS EAS builds: `production` (from `eas.json` → `build.production.channel`).
- Android local builds: `production` via `updates.requestHeaders` in `app.json`.
- The first build that includes `expo-updates` is iOS build 13 / Android versionCode 12; earlier builds cannot receive updates.

## Store rules
Apple (guideline 3.3.1 / 4.7) and Google Play allow updates to interpreted code as long as they do not change
the app's primary purpose or bypass review for new features of a different kind. Keep OTA for fixes and
improvements; ship major new features through review.

## Rollback
`npx eas update:republish --branch production` with the previous update group, or publish a fix forward.
