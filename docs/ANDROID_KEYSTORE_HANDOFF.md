# Android upload keystore — handoff

Generated 2026-09-22 on this machine (user `Dev Prince`). This is the **only**
upload key for `com.chakusa.mobile` — losing it means Play Console's key-reset
process is the only way to ship an update again.

## Location

```
C:\Users\Dev Prince\.chakusa\android\chakusa-upload.p12
```

This path is **outside the Git repository** — it is not, and must never be,
committed. Back it up to at least one other secure location (encrypted drive,
password manager's file attachment feature, etc.) in addition to this machine.

## Identity

| Field | Value |
| --- | --- |
| Store type | PKCS12 |
| Alias | `chakusa-upload` |
| Key algorithm | RSA 2048 |
| Validity | until 2054-02-07 |
| Distinguished name | `CN=Chakusa, OU=Mobile, O=Chakusa, L=Dubai, ST=Dubai, C=AE` |
| SHA-1 fingerprint | `3B:07:CF:9F:66:A7:FA:45:AF:CE:AB:13:42:85:F3:1B:98:A2:C6:4B` |
| SHA-256 fingerprint | `43:D6:A4:36:3B:B4:FA:A4:40:92:66:EC:36:A0:1C:66:BB:7B:25:0B:12:41:FE:1E:D5:73:27:B3:45:69:CF:1F` |

**Store/key password:** stored in the owner's password manager only — not
written to any file in or out of this repository. Ask the owner directly if
you need it for a build.

## What the fingerprints are for

Register both the SHA-1 and SHA-256 above wherever `com.chakusa.mobile`'s
signing certificate needs to be declared:

- Google Cloud Console → Credentials → the Android OAuth client for Google
  Sign-In (package `com.chakusa.mobile` + this SHA-1).
- Firebase Console → Project settings → the Android app, if/when push
  notifications are configured.
- Play Console → App integrity → confirms this matches the app-signing
  certificate once Play App Signing is enrolled (recommended default when
  creating the app).

## How to build a signed release AAB

From `mobile/`, with the keystore password from the password manager:

```powershell
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-17.0.20.8-hotspot"
$env:ANDROID_HOME = "C:\Users\Dev Prince\AppData\Local\Android\Sdk"
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:SENTRY_DISABLE_AUTO_UPLOAD = "true"
$env:CHAKUSA_UPLOAD_STORE_FILE = "C:\Users\Dev Prince\.chakusa\android\chakusa-upload.p12"
$env:CHAKUSA_UPLOAD_STORE_PASSWORD = "<from password manager>"
$env:CHAKUSA_UPLOAD_KEY_ALIAS = "chakusa-upload"
$env:CHAKUSA_UPLOAD_KEY_PASSWORD = "<same value as store password>"
cd mobile
npx expo prebuild --platform android
npm run android:bundle-release
```

Output: `mobile\android\app\build\outputs\bundle\release\app-release.aab`

`npm run android:bundle-release` runs `gradlew bundleRelease` with the
`production` profile's `env` block from `eas.json` applied
(`scripts/eas-env.mjs`). EAS cloud builds get that block automatically, but
a local Gradle build does not. Without it, every `EXPO_PUBLIC_*` value (the
API URL, the Google web client ID, feature flags) is missing from the JS
bundle. That is what broke Google Sign-In in the 2026-09-23 AAB: its bundle
had no API URL and no Google client ID. Don't call `gradlew bundleRelease`
directly.

The release build **fails closed** (a clear error, not a silent debug-signed
or unconfigured build) if the signing variables above are not set, or if
`EXPO_PUBLIC_API_URL` / `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` are missing. See
`mobile/plugins/withReleaseSigning.js`.

**Google Sign-In on Android also needs the signing certificates registered.**
Google only issues an ID token to an app whose package name and signing
SHA-1 match an **Android** OAuth client in the same Google Cloud project as
the web client ID. Two SHA-1s must be registered as Android OAuth clients
for `com.chakusa.mobile`:

1. The **upload key**: `keytool -list -v -keystore "<path to chakusa-upload.p12>" -storetype PKCS12 -alias chakusa-upload`
2. The **Play App Signing key**: Play Console → Test and release → App
   integrity → App signing key certificate → SHA-1. Installs from Play are
   re-signed with this key, not the upload key.

If either is missing, Google Sign-In fails with `DEVELOPER_ERROR`. See
`docs/OWNER_ACTIONS.md` (OA-9).

`react-native-webview` (added for the Leaflet map, 2026-09-26) is
Java/Kotlin only. It has no C++ and needs no linker patch.

## Native build note (2026-09-23)

React Native 0.86 on this Windows/NDK 27 toolchain has a real linking bug
(undefined C++ runtime symbols) affecting `android/app` itself plus the
`expo-modules-core` and `react-native-screens` native modules. Fixed via:

- `mobile/plugins/withCppStlLinkerFix.js` — forces `-lc++_shared` into the
  app's own CMake link via `androidComponents.finalizeDsl` (the only hook
  that actually reaches the CMake invocation for this RN plugin version).
- `mobile/patches/expo-modules-core+*.patch` and
  `mobile/patches/react-native-screens+*.patch` (via `patch-package`, runs
  automatically on `npm install` via the `postinstall` script) — same fix
  applied to those two modules' own separate native builds.

If a *new* native dependency is added later and produces the same
"undefined symbol: __cxa_..." class of linker error, it needs the same
`androidComponents.finalizeDsl { extension -> extension.defaultConfig
.externalNativeBuild.cmake.arguments.add("-DCMAKE_SHARED_LINKER_FLAGS=-Wl,--no-as-needed -lc++_shared") }`
block added to that package's own `android/build.gradle`, patched via
`patch-package`.
