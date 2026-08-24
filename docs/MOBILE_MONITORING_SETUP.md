# Mobile crash reporting setup

Chakusa's mobile client supports opt-in Sentry crash reporting. It is disabled unless both `EXPO_PUBLIC_SENTRY_ENABLED=true` and `EXPO_PUBLIC_SENTRY_DSN` are configured.

## EAS configuration

Configure these values in the EAS production environment rather than committing them:

- `EXPO_PUBLIC_SENTRY_ENABLED=true`
- `EXPO_PUBLIC_SENTRY_DSN=<the mobile project DSN>`
- `SENTRY_ORG=<Sentry organization slug>`
- `SENTRY_PROJECT=<Sentry React Native project slug>`
- `SENTRY_AUTH_TOKEN=<secret source-map upload token>`

`SENTRY_AUTH_TOKEN` is a build secret and must never use the `EXPO_PUBLIC_` prefix. Restrict it to source-map upload permissions and rotate it if exposed.

## Privacy and validation

The client disables screenshots, view hierarchy attachments, request-failure capture, performance traces, automatic sessions, and replay. Request content and common customer-identifying fields are scrubbed before events are sent. Only opaque user and business IDs are attached.

After the next internal iOS build, trigger one deliberate non-customer test error, verify its symbolicated stack trace in Sentry, and then resolve the test issue. Do not test with real customer data.
