# Android local AAB handoff

Last checked: 2026-09-18 (Asia/Dubai)

This is the single handoff file for the next local Android production build. The AAB must be built on this PC with Gradle, not EAS Build.

## What was found on this PC

### Release signing

No production/upload keystore was found.

The search covered:

- `C:\Projects\Chakusa`, including ignored generated Android files
- the complete Git history and object list
- `C:\Users\Surface\.android`
- `C:\Users\Surface\.gradle`
- `C:\Users\Surface\.expo`
- `C:\Users\Surface\.eas`
- `C:\Users\Surface\Desktop`
- `C:\Users\Surface\Documents`
- `C:\Users\Surface\Downloads`
- the EAS CLI user configuration directory

Only these debug keystores exist:

| Path | Alias | Purpose |
| --- | --- | --- |
| `C:\Users\Surface\.android\debug.keystore` | `androiddebugkey` | Local development only |
| `C:\Projects\Chakusa\mobile\android\app\debug.keystore` | `androiddebugkey` | Generated Android development key only |

Neither debug key is valid for a Play production release. Do not upload an AAB signed by either one.

### Local build tools

All required local tools are installed:

- Java/keytool/jarsigner: Temurin JDK 17 at `C:\Program Files\Eclipse Adoptium\jdk-17.0.20.8-hotspot`
- Android SDK: `C:\Android\Sdk`
- Android platforms: 35 and 36
- Android build tools: 35.0.0 and 36.0.0
- Android NDK: 27.1.12297006
- `adb`, `sdkmanager`, `aapt2`, `apksigner`, and `zipalign` are installed
- Gradle wrapper 9.3.1 downloaded and validated

The shell does not currently define a valid `JAVA_HOME`, `ANDROID_HOME`, or `ANDROID_SDK_ROOT`. Use:

```powershell
$env:JAVA_HOME = 'C:\Program Files\Eclipse Adoptium\jdk-17.0.20.8-hotspot'
$env:ANDROID_HOME = 'C:\Android\Sdk'
$env:ANDROID_SDK_ROOT = 'C:\Android\Sdk'
```

## App identity to preserve

- App name: `CHAKUSA`
- Android package/application ID: `com.chakusa.mobile`
- Current version name: `1.0.0`
- Current version code: `1` (must be confirmed unused in Play Console)
- Expo project ID: `3a425309-15fb-4407-8db4-9c380feae21b`
- Production API: `https://chakusa-api.onrender.com`

## Keystore decision

Before generating anything, check Play Console:

1. If `com.chakusa.mobile` has never had a release, generate a new upload key.
2. If an app already exists, use its original upload key or follow the Play App Signing upload-key reset process. A newly generated key cannot silently replace an existing upload key.
3. Confirm whether Play App Signing is enabled and record both the upload certificate and Play app-signing certificate fingerprints.

Recommended location for a new key:

`C:\Users\Surface\.chakusa\android\chakusa-upload.p12`

This location is outside Git. Back up the keystore and its passwords in a password manager plus a separate encrypted backup. Loss of the upload key requires a Play Console reset; loss of a self-managed app-signing key can make updates impossible.

Recommended alias: `chakusa-upload`

Use PKCS12 and a long randomly generated store/key password. Do not paste either password into source files, chat, Git, or the audit report.

## Secure Gradle configuration planned

When the key exists, configure the generated local Android release variant to require these values from the process environment or user-level Gradle properties:

- `CHAKUSA_UPLOAD_STORE_FILE`
- `CHAKUSA_UPLOAD_STORE_PASSWORD`
- `CHAKUSA_UPLOAD_KEY_ALIAS`
- `CHAKUSA_UPLOAD_KEY_PASSWORD`

The release build must fail closed when any value is absent. It must never fall back to `debug.keystore`.

The current generated `mobile/android/app/build.gradle` does fall back to debug signing and therefore must be changed before `bundleRelease` is run.

## Configuration still required

### Google Sign-In

After creating/locating the upload key:

1. Export its SHA-1 and SHA-256 fingerprints with `keytool`.
2. Register `com.chakusa.mobile` plus those fingerprints as the Android OAuth client.
3. Also register the Play app-signing certificate fingerprints once available.
4. Web OAuth client ID — resolved 2026-09-21. `mobile/eas.json` previously pointed
   `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` at `1004047431327-s5baiopm6k2msj3phgl2bkjj4q8d1ehv.apps.googleusercontent.com`,
   a client ID from an unrelated Google Cloud project number that appeared nowhere
   else in the repository. `mobile/eas.json` now matches `mobile/PRODUCTION_ENVIRONMENT.md`,
   `docs/GOOGLE_SIGN_IN_SETUP.md`, and the live `website/` Google Sign-In pages:
   `618618639466-1sosi4hua8q64h0til1rjkam36cbpdvd.apps.googleusercontent.com` (same
   Google Cloud project, `618618639466`, as the iOS client ID used throughout).
   Still outstanding: directly confirm this exact value is what production
   `GOOGLE_OAUTH_CLIENT_IDS` on Render actually contains — that variable is a
   secret and is not present anywhere in the repository.

### Push notifications

If Android push is part of this release, create/confirm the Firebase Android app for `com.chakusa.mobile`, configure FCM v1 credentials, and provide the Android Firebase configuration required by the chosen Expo Notifications setup. No production FCM configuration was found locally.

If push is intentionally excluded, document that decision and disable/hide registration paths for the release rather than shipping a control that cannot register.

### Google Play subscriptions

If billing is enabled, provide:

- Google Play Pro monthly product ID
- Google Play Business monthly product ID, if Business is sold on Android
- backend Google Play service-account email/private key
- RTDN service-account email and audience/topic configuration
- Play Console license-test accounts for QA

The current production profile enables billing but provides only Apple product IDs. `PRODUCTION_ENVIRONMENT.md` says billing is disabled. Resolve this contradiction before building.

### Sentry

Choose whether production mobile crash reporting is enabled. If enabled, provide the public DSN and build-time Sentry organization/project/auth token through the local environment. Source-map upload is currently disabled.

### Backend tests

Start a local PostgreSQL instance and provide a URL whose host is loopback and database name is exactly `chakusa_test`. The safety guard rejects every other target. Never point tests at production.

## Local AAB sequence after the missing inputs are supplied

1. Confirm Play application status, version code, and signing ownership.
2. Configure the release keystore and fail-closed Gradle signing.
3. Reconcile the Google OAuth, billing, push, and Sentry release environment.
4. Run backend and mobile checks, including the guarded backend integration suite.
5. Regenerate/validate the native project and inspect the merged release manifest.
6. Run local `gradlew.bat bundleRelease` with the production environment.
7. Inspect the AAB package/version and certificate using Android build tools/keytool.
8. Copy the final AAB to a clearly named release-artifact directory and record its SHA-256 checksum.

Expected Gradle output location:

`C:\Projects\Chakusa\mobile\android\app\build\outputs\bundle\release\app-release.aab`

The exact output is not approved until its application ID, version, signing certificate, manifest permissions, and production API configuration are verified.

## Where to obtain every missing item

Follow these steps in order. Keep downloaded private-key JSON files and passwords outside the repository.

### 1. Google Play developer account and app record

Where: [Google Play Console](https://play.google.com/console/)

1. Sign in with the Google account that will permanently own Chakusa.
2. If there is no developer account, complete account registration and identity verification. An organization account may require a D-U-N-S number.
3. Open **All apps** and search for package `com.chakusa.mobile`.
4. If it exists, open it and record its highest uploaded version code under **Test and release > Latest releases and bundles** or **App bundle explorer**.
5. If it does not exist, choose **Create app**, name it `CHAKUSA`, choose the default language/app type/free-or-paid status, enter the support email, and accept Play App Signing.
6. Tell the build operator whether this is new or existing and the next unused version code. Do not create a second app record for the same intended product.

Official guides: [create an app](https://support.google.com/googleplay/android-developer/answer/9859152), [prepare a release](https://support.google.com/googleplay/android-developer/answer/9859348).

### 2. Upload keystore and Play signing certificates

Where: generated locally with the installed JDK; Play certificate details are in Play Console.

1. For a new app, ask the build operator to generate the permanent upload key at `C:\Users\Surface\.chakusa\android\chakusa-upload.p12` with alias `chakusa-upload`.
2. Save both passwords in your password manager. Make at least one encrypted offline backup of the `.p12` file.
3. For an existing app, go to **Play Console > Setup/Protected with Play > App integrity > Play app signing** and compare its upload certificate with any key you possess. If the original upload key is lost, use Play's upload-key reset flow.
4. From **App integrity**, copy the SHA-1 and SHA-256 fingerprints for both the **upload key certificate** and **app signing key certificate**. Google signs delivered APKs with the app-signing key, so both sets can matter to OAuth and App Links.

Official guide: [Play App Signing and upload keys](https://support.google.com/googleplay/android-developer/answer/9842756).

### 3. Google Sign-In OAuth clients

Where: [Google Cloud Console Credentials](https://console.cloud.google.com/apis/credentials)

1. Select the Google Cloud project intended for Chakusa authentication. Do not create another project until you check which project owns the existing client IDs.
2. Open **APIs & Services > Credentials** and find both existing Web client IDs currently mentioned in the repository.
3. Identify which Web client ID the production backend accepts. This becomes `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`.
4. Choose **Create credentials > OAuth client ID > Android**.
5. Enter package `com.chakusa.mobile` and the upload key SHA-1. Create additional Android clients for the Play app-signing SHA-1 fingerprints if Google presents more than one signing certificate.
6. Send the selected Web client ID to the build operator. Android client secrets are not used or copied into the mobile app.

Google's Android setup requires an Android client (package + SHA-1) and a Web client for backend ID-token verification: [Google Sign-In Android setup](https://codelabs.developers.google.com/sign-in-with-google-android).

### 4. Firebase Android app and `google-services.json`

Where: [Firebase Console](https://console.firebase.google.com/)

1. Open the Firebase project used by Chakusa, or create one if Chakusa has none.
2. Go to **Project settings > General > Your apps**.
3. Add an Android app with package `com.chakusa.mobile`. The nickname is optional.
4. Add the upload and Play app-signing SHA-1/SHA-256 fingerprints.
5. Download `google-services.json`.
6. Give that file to the build operator. It contains project identifiers rather than a server private key, but it must match `com.chakusa.mobile` exactly.
7. The build operator will place it at a stable mobile-project path and set `expo.android.googleServicesFile` in app configuration before regenerating Android.

Official guide: [add Firebase to Android](https://firebase.google.com/docs/android/setup), [how `google-services.json` is processed](https://firebase.google.com/docs/android/google-services-plugin-and-file).

### 5. FCM v1 server credential for push

Where: Firebase Console and the credential store used by the production notification sender.

1. In Firebase, open **Project settings > Service accounts**.
2. Use a dedicated least-privilege service account for messaging. Generate a JSON key only if the deployed environment cannot use keyless Google authentication.
3. Download the JSON once and store it in a password manager/secret manager. Never add it to Git or place it beside `google-services.json`.
4. If continuing to send via Expo Push Service, configure the same FCM v1 credential for Expo project `3a425309-15fb-4407-8db4-9c380feae21b`; the Android AAB itself will still be built locally.
5. Confirm the Firebase project number matches the sender ID in `google-services.json`.

Official guide: [Expo FCM v1 credential setup](https://docs.expo.dev/push-notifications/fcm-credentials/). The guide uses EAS only as a credential store for Expo Push Service; it does not require building the AAB on EAS.

### 6. Google Play subscription product IDs

Where: **Play Console > Monetize with Play > Products > Subscriptions**.

1. Decide whether Android will sell Pro only or both Pro and Business.
2. Choose stable IDs before creating them; Play product IDs cannot be renamed or reused after creation.
3. Create the subscription, then create and activate a monthly auto-renewing base plan with prices and countries.
4. Record the subscription product IDs, not the display names or base-plan IDs.
5. These become `EXPO_PUBLIC_GOOGLE_PRO_MONTHLY_PRODUCT_ID` and, if applicable, `EXPO_PUBLIC_GOOGLE_BUSINESS_MONTHLY_PRODUCT_ID` in the mobile release environment and matching backend product IDs.
6. Add license-test Google accounts in Play Console for sandbox purchase testing.

Official guide: [create and manage subscriptions](https://support.google.com/googleplay/android-developer/answer/140504).

### 7. Google Play Developer API service account

Where: Google Cloud Console plus Play Console.

1. In the Cloud project used for Play integration, enable the **Google Play Android Developer API**.
2. Go to **IAM & Admin > Service Accounts** and create a dedicated service account such as `chakusa-play-billing`.
3. In **Play Console > Users and permissions**, invite its service-account email.
4. Grant only the billing permissions required by the backend, including **View financial data, orders, and cancellation survey responses** and **Manage orders and subscriptions**.
5. If Render cannot use keyless identity, create a JSON key under the service account's **Keys** tab. It can be downloaded only when created.
6. Put the service-account email and private key into the Render/API secret environment as `GOOGLE_BILLING_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_BILLING_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64`. Never put the JSON or private key in the mobile app.

Official guides: [Google Play Developer API setup](https://developers.google.com/android-publisher/getting_started), [creating service-account keys](https://docs.cloud.google.com/iam/docs/keys-create-delete).

### 8. Real-time Developer Notifications (RTDN)

Where: Google Cloud Pub/Sub and **Play Console > Monetize with Play > Monetization setup**.

1. Create a Pub/Sub topic dedicated to Play billing notifications.
2. Grant the Google Play notifications service account permission to publish to the topic as instructed by Play Console.
3. Configure the topic in Play Console's RTDN settings and send a test notification.
4. Configure the authenticated push/subscription path that reaches Chakusa's Google subscription webhook.
5. Record the service-account email and exact audience URL as `GOOGLE_RTDN_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_RTDN_AUDIENCE` in the backend environment.
6. Verify the backend queries the Play Developer API after each notification; RTDN itself does not contain the complete purchase state.

Official guides: [RTDN reference](https://developer.android.com/google/play/billing/rtdn-reference), [secure billing backend integration](https://developer.android.com/google/play/billing/backend).

### 9. Sentry mobile project

Where: [Sentry](https://sentry.io/)

1. Open the existing Chakusa Sentry organization or create one.
2. Create/select a React Native project for the mobile app.
3. Copy its public DSN for `EXPO_PUBLIC_SENTRY_DSN` and set `EXPO_PUBLIC_SENTRY_ENABLED=true` if monitoring is approved.
4. For source-map upload, obtain the organization slug, project slug, and a narrowly scoped organization auth token. Keep the token only in the local build environment/secret manager.
5. Leave `sendDefaultPii=false`; the existing app also scrubs diagnostic events.

If monitoring is intentionally deferred, keep it explicitly disabled and record that release decision.

### 10. Production backend secrets and status

Where: the [Render Dashboard](https://dashboard.render.com/) for the Chakusa API/worker and the production database provider.

1. Confirm `https://chakusa-api.onrender.com` is the intended production API.
2. Review the API and worker environment using the required list in `src/lib/config.ts`; do not copy secret values into this file.
3. Complete `GOOGLE_OAUTH_CLIENT_IDS`, Google billing/RTDN values if enabled, Sentry values if enabled, `TRUST_PROXY`, database pool/timeouts, and every existing provider credential.
4. Check pending Prisma migrations and backups using `docs/OWNER_ACTIONS.md` OA-1/OA-7 before treating the mobile release as production-ready.
5. Keep the API and worker configuration aligned where both consume the same feature.

### 11. Local backend test database

Where: Docker Desktop or a local PostgreSQL 16 installation on this PC.

1. Start Docker Desktop.
2. Create a separate PostgreSQL database named exactly `chakusa_test`; do not reuse the development `chakusa` database.
3. Set `DATABASE_URL` and `DIRECT_URL` in the current test shell to the loopback `chakusa_test` URL.
4. The repository safety guard will reject missing, remote, production-looking, or incorrectly named databases.
5. Run migrations against that local test database, then run the backend tests.

### 12. Play Console compliance and store assets

Where: the selected app in Play Console.

1. Open **Policy and programs > App content** (menu wording may vary).
2. Complete **Data safety**, using `docs/RELEASE_READINESS_CHECKLIST.md` as the technical inventory.
3. Enter privacy policy `https://chakusarecovery.com/privacy`.
4. In the account-deletion questions, enter `https://chakusarecovery.com/delete-account`; the app already contains in-app deletion paths.
5. Complete any permission declaration Play displays after the AAB is uploaded. Provide the call-screening feature explanation, reviewer access, and a short demonstration video if requested.
6. Declare foreground precise/approximate location as appointment functionality, ephemeral/no history, not advertising or tracking.
7. Finish content rating, target audience, ads declaration, app access/reviewer credentials, financial features if applicable, and the store listing.
8. Prepare phone screenshots, high-resolution icon, feature graphic, short/full descriptions, support email, website, and release notes.

Official guides: [permission declarations](https://support.google.com/googleplay/android-developer/answer/9214102), [prominent disclosure](https://support.google.com/googleplay/android-developer/answer/11150561), [account deletion](https://support.google.com/googleplay/android-developer/answer/13327111).

## What to return to the build operator

Do not send passwords or private keys in chat. Provide access through the relevant console or place files in an agreed secure local folder, then report only:

- New or existing Play app
- Next unused version code
- Upload keystore path and alias (passwords stored separately)
- Upload and Play signing SHA-1/SHA-256 fingerprints
- Approved Google Web OAuth client ID
- Path to `google-services.json`
- Whether push is enabled and where its FCM credential is stored
- Android Pro/Business subscription product IDs, or confirmation that billing is disabled
- Google billing service-account email and secure-secret location
- RTDN audience URL and service-account email
- Whether Sentry is enabled, plus organization/project slugs (token stored separately)
- Confirmation that the local `chakusa_test` database is running
- Confirmation that required Play Console declarations and store assets are complete
