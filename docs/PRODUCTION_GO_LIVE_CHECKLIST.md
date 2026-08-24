# Chakusa production go-live checklist

This checklist contains only deployment and operational actions. Secrets must be entered in the hosting provider's secret manager, never committed here.

## Provider configuration

- Render API: set `DATABASE_URL` (pooled), `DIRECT_URL` (migration connection), `JWT_SECRET`, and `WORKER_TRIGGER_SECRET`.
- Twilio: set `TWILIO_ENABLED`, account credentials, an SMS sender or messaging service, and `TWILIO_WHATSAPP_FROM` only after WhatsApp sender approval.
- Resend: verify the sending domain, then set `EMAIL_ENABLED`, `RESEND_API_KEY`, and `EMAIL_FROM`.
- Stripe Connect: set live keys, webhook signing secret, success/cancel URLs, and register `/webhooks/stripe`.
- App stores: set Apple/Google billing credentials, approved product IDs, environment, and webhook endpoints.
- Sentry/Expo: set backend and mobile monitoring DSNs in deployment secrets/build profiles.

## Acceptance checks

- `GET /health`, `/health/ready`, and `/health/worker` return healthy results.
- Create, reschedule, cancel, confirm, complete, and import an appointment.
- Confirm SMS delivery status and WhatsApp opt-out behavior.
- Create/revoke an external calendar subscription; verify the feed contains no customer PII.
- Create a Stripe deposit link, receive a signed webhook, retry the webhook, and refund partially and fully.
- Generate a weekly report and verify in-app, push, and email delivery when configured.
- Verify Apple/Google purchase, restore, renewal, grace period, expiry, and cancellation states.
- Test login, logout-all, password reset, device registration, and account deletion on physical iOS and Android devices.
- Exercise support ticket creation and read-only admin support context.

## Beta gate

Run the complete journey with 15–20 real businesses: setup → public booking → confirmation → reminder → completion → payment → review request → weekly report. Record conversion, delivery failures, payment failures, support issues, and retention before enabling paid acquisition.
