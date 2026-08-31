# Chakusa production go-live checklist

This checklist contains only deployment and operational actions. Secrets must be entered in the hosting provider's secret manager, never committed here.

## Provider configuration

- Render API: set `DATABASE_URL` (pooled), `DIRECT_URL` (migration connection), `JWT_SECRET`, and `WORKER_TRIGGER_SECRET`.
- Twilio: set `TWILIO_ENABLED`, account credentials, an SMS sender or messaging service, and `TWILIO_WHATSAPP_FROM` only after WhatsApp sender approval.
- Resend: verify the sending domain, then set `EMAIL_ENABLED`, `RESEND_API_KEY`, and `EMAIL_FROM`.
- Stripe Connect: set live keys, webhook signing secret, success/cancel URLs, and register `/webhooks/stripe`.
- App stores: set Apple/Google billing credentials, approved product IDs, environment, and webhook endpoints.
- Sentry/Expo: set backend and mobile monitoring DSNs in deployment secrets/build profiles.
- AI Platform (optional — the platform ships dark): set `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY`; add matching `AIModelRegistry` rows (`/admin/ai/models`, `ai.manage`) with real `pricing`; seed the platform prompt package + a baseline `AIPolicy` (start in **DRAFT** mode); leave `ai.customer_agent` flag **off** until per-business rollout.

## Acceptance checks

- `GET /health`, `/health/ready`, `/health/worker`, `/health/automation`, and `/health/ai` return healthy results.
- Create, reschedule, cancel, confirm, complete, and import an appointment.
- Confirm SMS delivery status and WhatsApp opt-out behavior.
- Create/revoke an external calendar subscription; verify the feed contains no customer PII.
- Create a Stripe deposit link, receive a signed webhook, retry the webhook, and refund partially and fully.
- Generate a weekly report and verify in-app, push, and email delivery when configured.
- Verify Apple/Google purchase, restore, renewal, grace period, expiry, and cancellation states.
- Test login, logout-all, password reset, device registration, and account deletion on physical iOS and Android devices.
- Exercise support ticket creation and read-only admin support context.
- AI (only if enabling at launch): with `ai.customer_agent` on for one pilot business and an ACTIVE DRAFT-mode policy, send an inbound SMS and confirm a draft is held (`/ai/ops/runs`), approve it (`/ai/agent/runs/:id/approve`), and confirm delivery. Toggle `PlatformSetting.ai_enabled=false` and confirm `routeAI` stops and `/health/ai` reports the kill switch.

## Beta gate

Run the complete journey with 15–20 real businesses: setup → public booking → confirmation → reminder → completion → payment → review request → weekly report. Record conversion, delivery failures, payment failures, support issues, and retention before enabling paid acquisition.
