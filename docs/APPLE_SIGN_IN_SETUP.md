# Chakusa Sign in with Apple Setup

Chakusa uses Apple's native iOS authorization UI. The mobile app obtains a server-issued nonce and state, then sends Apple's identity token and authorization code to Fastify. Fastify validates both with Apple and issues the existing Chakusa access and rotating refresh tokens.

## Apple Developer configuration

1. Enroll the organization in the Apple Developer Program. Use an organization-owned account rather than a personal credential.
2. Register the explicit App ID `com.chakusa.mobile` under **Certificates, Identifiers & Profiles > Identifiers**.
3. Enable the **Sign in with Apple** capability for that App ID and choose it as the primary App ID unless an existing grouped primary App ID is intentional.
4. Create a **Sign in with Apple** key under **Keys**, associate it with the App ID, and securely download the `.p8` file. Record the Apple Team ID and Key ID.
5. Regenerate iOS provisioning profiles after enabling the capability. EAS-managed credentials can do this during a new build.

The current native iOS flow uses the App ID/bundle ID as `APPLE_CLIENT_ID`. A Services ID and return URL are not required for this native flow. Create a Services ID and HTTPS return URL before adding web or Android browser-based Apple authentication.

## Backend environment

Set these only in the backend secret manager. Never put the `.p8` key or encryption key in Expo public variables or commit them:

```env
APPLE_AUTH_ENABLED=true
APPLE_CLIENT_ID="com.chakusa.mobile"
APPLE_TEAM_ID="N5DSK22C62"
APPLE_KEY_ID="2G96HS3R93"
APPLE_PRIVATE_KEY_BASE64="BASE64_OF_THE_COMPLETE_P8_PEM_FILE"
PROVIDER_TOKEN_ENCRYPTION_KEY="BASE64_OF_32_RANDOM_BYTES"
APPLE_CHALLENGE_TTL_MINUTES=5
```

Team ID and Key ID are public developer-account identifiers, safe to record here. `APPLE_PRIVATE_KEY_BASE64` and `PROVIDER_TOKEN_ENCRYPTION_KEY` are secrets — set them only as Render environment variables, never here, never in Git.

Generate `PROVIDER_TOKEN_ENCRYPTION_KEY` with a cryptographically secure random generator. Keep old key material available during any future key rotation until stored provider credentials have been re-encrypted.

## Mobile configuration

`mobile/app.json` declares `ios.usesAppleSignIn: true` and the `expo-apple-authentication` config plugin. Apple authentication contains native code and requires a new iOS development or distribution build; it does not run in Expo Go.

The official Apple button is shown only on iOS auth forms. Linking is under **Settings > Security**, and Apple-backed deletion performs a fresh native authorization before the backend revokes Apple credentials and deletes Chakusa data.

## Private relay email

When a user selects **Hide My Email**, Chakusa preserves the verified `@privaterelay.appleid.com` address returned by Apple. Register the production outbound email domains and addresses with Apple Private Email Relay. Configure SPF and DKIM for those domains; otherwise reset and operational email can be rejected by the relay.

## App Store and operations

- Because Chakusa offers Google sign-in, the iOS app must also offer Sign in with Apple in accordance with App Review rules. Use Apple's official button without visual modification.
- The in-app account deletion path revokes Apple's refresh credential before deleting the Chakusa user, sessions, identity, business, and cascaded tenant data. A failed Apple revocation leaves the Chakusa account intact so deletion can be retried.
- Do not log Apple identity tokens, authorization codes, client-secret JWTs, `.p8` material, or refresh credentials.
- Configure and verify Apple's server-to-server notification endpoint before relying on provider-initiated account or email status changes. The current implementation handles interactive sign-in, linking, and deletion; notification ingestion is a separate operational integration.
- Rotate the Sign in with Apple key and provider-encryption key under a documented production secret-rotation procedure.

## Device verification

1. Build the iOS app with the production bundle ID and a profile containing the Sign in with Apple entitlement.
2. Test a new Apple user with **Share My Email** and another with **Hide My Email**.
3. Confirm first authorization captures the name, then revoke Chakusa access in the Apple ID settings and repeat authorization behavior.
4. Confirm an existing password or Google account with the same verified email receives `ACCOUNT_LINK_REQUIRED` and is linked only after signing in to Chakusa and choosing **Link Apple account**.
5. Confirm app restart restores the Chakusa SecureStore session and refresh-token rotation still works.
6. Confirm logout, logout-all, and deletion. For deletion, verify Apple revocation succeeds and the Chakusa account can no longer refresh or access tenant data.
