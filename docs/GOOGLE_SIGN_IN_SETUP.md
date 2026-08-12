# Chakusa Google Sign-In Setup

Google Sign-In uses the native Google SDK. The mobile app sends a Google ID token to Fastify, Fastify verifies it with Google's Node library, and Chakusa issues its own access and refresh tokens.

## 1. Google Cloud project and consent screen

1. Create or select a Google Cloud project.
2. Configure **Google Auth Platform > Branding, Audience, and Data Access**.
3. Use the Chakusa app name, support email, privacy-policy URL, and authorized domain.
4. Request only the default `openid`, `email`, and `profile` scopes.
5. While the app is in Testing, add each tester under **Audience > Test users**.

## 2. Server/web OAuth client

Create an OAuth client of type **Web application**. This is the server audience used to request and verify mobile ID tokens. No browser redirect URI is used by the native mobile flow.

Set the same client ID in:

```dotenv
# Backend .env
GOOGLE_OAUTH_CLIENT_IDS=123456789-example.apps.googleusercontent.com

# mobile/.env
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=123456789-example.apps.googleusercontent.com
```

Multiple trusted backend audiences may be comma-separated in `GOOGLE_OAUTH_CLIENT_IDS`. Do not add client IDs belonging to unrelated apps.

## 3. iOS OAuth client

1. Create an OAuth client of type **iOS**.
2. Set bundle ID to `com.chakusa.mobile`.
3. Copy the iOS client ID into `mobile/.env`:

```dotenv
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=123456789-ioshash.apps.googleusercontent.com
```

4. Reverse that client ID and replace `com.googleusercontent.apps.CONFIGURE_ME` in `mobile/app.json`:

```text
com.googleusercontent.apps.123456789-ioshash
```

The reversed client ID is the iOS callback URL scheme. Keep the existing `chakusa` scheme; it is used for Chakusa deep links such as password reset.

## 4. Android OAuth clients

Create an OAuth client of type **Android** for every signing certificate used with the package `com.chakusa.mobile`:

- Local debug/development certificate SHA-1.
- EAS development or preview build certificate SHA-1.
- Production upload certificate SHA-1 when applicable.
- Google Play App Signing certificate SHA-1 for Play-distributed builds.

Retrieve local fingerprints with Gradle `signingReport`, EAS credentials with `eas credentials`, and Play App Signing fingerprints from Play Console. Android identifies the native client using package name plus certificate; no Android client ID is placed in mobile JavaScript.

## 5. Build requirements

Google Sign-In contains native code and does not work in Expo Go. After changing credentials, the config plugin, or native dependencies, create a new development build:

```powershell
cd mobile
npx expo prebuild --clean
npx expo run:android
# On macOS only:
npx expo run:ios
```

For iOS development from Windows, use an EAS development build:

```powershell
npx eas build --profile development --platform ios
```

Do not run `prebuild --clean` when uncommitted native-directory customizations exist without reviewing them first.

## 6. Manual test

1. Add your Google account as an OAuth consent test user.
2. Configure backend `.env`, mobile `.env`, and the iOS URL scheme above.
3. Start PostgreSQL and apply migrations with `npx prisma migrate deploy`.
4. Start Fastify with `npm run dev`.
5. Set `EXPO_PUBLIC_API_URL` to the computer's LAN HTTPS/HTTP development address reachable from the device.
6. Install a new iOS or Android development build; Expo Go cannot test this feature.
7. Open the approved onboarding flow and advance to **Your CHAKUSA account**.
8. Tap **Continue with Google** and select a test account.
9. For a new email, verify Chakusa continues at Business details and does not skip setup.
10. For an existing linked account, verify Chakusa opens its existing business.
11. For an existing password account with the same email, verify `ACCOUNT_LINK_REQUIRED`, sign in with the password, then use **Settings > Link Google account**.
12. Log out and sign in again with Google to verify Chakusa SecureStore restoration and refresh rotation.
13. Test **Sign out all devices** and Google-confirmed account deletion.

The backend and mobile app deliberately fail with `GOOGLE_AUTH_NOT_CONFIGURED` or a visible mobile configuration message when required client IDs are absent. There is no mock or browser fallback.

The Original native Google Sign-In SDK used here does not expose a caller-supplied OIDC nonce. Linking instead forces interactive Google selection and the backend requires the verified ID token to have been issued within five minutes. If a future web/One Tap authorization flow is added, it must use a server-issued, single-use nonce.
