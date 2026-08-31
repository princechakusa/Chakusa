# Environment configuration

Chakusa does not store `.env` files or environment templates in Git. Configuration must be injected into the process by the deployment platform, CI system, EAS, Cloudflare, or an approved local secret manager.

The tracked `.gitignore` blocks `.env` files and common private-key formats. CI runs `npm run security:repository` and rejects a change if one of those files is tracked.

## Local test API

Supply `DATABASE_URL` and optionally `DIRECT_URL` in the current shell, pointing to a local PostgreSQL database named exactly `chakusa_test`, then run `npm run dev:test`. The safety guard rejects remote hosts, other database names, and non-test environments. The script generates an ephemeral JWT secret and explicitly disables remote integrations.

For Prisma maintenance, supply the same URL under `CHAKUSA_LOCAL_TEST_DATABASE_URL` and run `node scripts/prisma-local.mjs <command>`. The wrapper passes credentials directly to the child process and never reads or writes a configuration file.

## Deployment

Configure required values in the hosting platform's encrypted environment or secret store. Relevant groups include database connectivity, authentication secrets, provider credentials, billing verification, monitoring, messaging, email, and the exact administration-console origin.

Public mobile and admin build variables must be configured in EAS, CI, or Cloudflare build settings. Backend secrets must never use public-variable prefixes or be embedded in a client build.

Do not commit configuration exports, copied dashboards, command transcripts containing credentials, or `.env*` files under any name.

## Variable groups

The authoritative list and validation rules are in `src/lib/config.ts` (`envSchema`). Groups:

| Group | Keys | Notes |
|---|---|---|
| Core | `DATABASE_URL` (pooled), `DIRECT_URL` (migrations), `JWT_SECRET` (≥16), `PORT`, `NODE_ENV` | `NODE_ENV=production` triggers strict `superRefine` checks. |
| Worker trigger | `WORKER_TRIGGER_SECRET` (≥32) | Enables `POST /internal/worker/tick`. Absent ⇒ endpoint 404s. |
| Auth | `ACCESS_TOKEN_TTL_SECONDS`, `REFRESH_TOKEN_TTL_DAYS`, `PASSWORD_RESET_*`, `GOOGLE_AUTH_ENABLED` + verifier keys, `APPLE_AUTH_ENABLED` + key material | |
| Messaging | `TWILIO_ENABLED`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` \| `TWILIO_MESSAGING_SERVICE_SID`, `TWILIO_WHATSAPP_FROM`, `TWILIO_STATUS_CALLBACK_URL`, `TWILIO_MONTHLY_MESSAGE_LIMIT` | `TWILIO_ENABLED` is a separate switch from "credentials present". |
| Email | `EMAIL_ENABLED`, `RESEND_API_KEY`, `EMAIL_FROM` | Feature-gated; absent ⇒ email sends are safe no-ops. |
| Billing | `STRIPE_PAYMENTS_ENABLED` + keys + `STRIPE_WEBHOOK_SECRET` + URLs; `APPLE_BILLING_ENABLED` + App Store Server API material; `GOOGLE_BILLING_ENABLED` + service-account material | |
| Admin console | `ADMIN_CONSOLE_ENABLED`, `ADMIN_CONSOLE_ORIGIN` (exact HTTPS origin), `CORS_ALLOWED_ORIGINS` | |
| Monitoring | `SENTRY_ENABLED`, `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`, `TRUST_PROXY` | Sentry only initializes when `SENTRY_ENABLED=true` **and** `NODE_ENV=production`. |
| **AI Platform (LOOP 3–4)** | `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_DEFAULT_MODEL`; `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_DEFAULT_MODEL`; `AI_PROVIDER_TIMEOUT_MS` (default 30000), `AI_PROVIDER_MAX_RETRIES` (default 2) | All optional. A provider adapter registers **only** when its key is present. With no key set the AI runtime has no model to route to and `routeAI` returns 503 — a valid pre-rollout state. No `.env` change is needed to keep AI dark. |

### AI Platform notes

- The deterministic **fake** provider registers only outside `NODE_ENV=production`; production requires a real key.
- Populate `AIModelRegistry` rows (via `/admin/ai/models` with `ai.manage`, or a seed) that name the same `provider` id (`openai` / `anthropic`) and carry real `pricing` so cost/ROI analytics are non-zero.
- Runtime kill switches are **data**, not env: `PlatformSetting.ai_enabled=false` or a `FeatureFlag` `kill_switch.ai` (PLATFORM or per-BUSINESS) disables all AI invocation immediately, no redeploy.
- The AI Customer Agent runs only for businesses with a `FeatureFlag` `ai.customer_agent` (BUSINESS or PLATFORM). Default off.
