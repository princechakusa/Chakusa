import "dotenv/config";
import { z } from "zod";

const optionalSecret = z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).optional());

const booleanFlag = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toLowerCase() === "true" : value),
  z.boolean().default(false),
);

// Exported so tests can exercise the production superRefine validation
// (e.g. EMAIL_ENABLED's RESEND_API_KEY/EMAIL_FROM requirement) directly
// via envSchema.safeParse({...}) — see tests/config-email.test.ts — without
// spawning a real process just to prove the schema's own logic.
export const envSchema = z.object({
  // The only database env var the application (API and worker — both read
  // this exact same value via src/lib/prisma.ts's PrismaClient, no other
  // datasource override) ever connects with. In production this is
  // Supabase's pooled connection. A second variable, DIRECT_URL, exists in
  // prisma/schema.prisma's datasource block for the Prisma CLI's migration
  // commands only — PrismaClient's generated runtime never reads directUrl,
  // so it is deliberately absent from this schema: adding it here would
  // validate a variable this process never uses, and (worse) invite some
  // future call site to mistakenly wire application code to the
  // migration-only connection.
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  // Optional shared secret for the temporary HTTP-triggered scheduled-work
  // fallback. When absent, POST /internal/worker/tick is disabled. Use a
  // random value of at least 32 characters and send it only as a Bearer
  // token from the external scheduler.
  WORKER_TRIGGER_SECRET: z.preprocess((value) => value === "" ? undefined : value, z.string().min(32).optional()),
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(60),
  PASSWORD_RESET_URL: z.string().url().default("chakusa://reset-password"),
  // How long a public review/private-feedback link (see
  // src/modules/reviews/reviews.service.ts's generatePublicReviewLink)
  // stays usable after generation. 30 days by default — long enough that a
  // customer who doesn't open a review request the day it's sent still has
  // a working link weeks later, matching how review requests are actually
  // sent today (a manual, sometimes-delayed action by the business owner),
  // not an arbitrarily short security-token window.
  PUBLIC_REVIEW_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  // Placeholder pending a real commercial decision (see
  // entitlements.ts's PLAN_LIMITS) — how many ACTIVE BusinessMember rows
  // (owner included) a BUSINESS-tier business may have at once.
  BUSINESS_SEAT_LIMIT: z.coerce.number().int().positive().default(10),
  // How long a team invitation (src/modules/team/teamInvitations.service.ts)
  // stays acceptable after creation. 7 days is generous enough that an
  // invited person checking email a few days late still finds a working
  // link, while still being a bounded, non-indefinite credential.
  TEAM_INVITATION_TTL_DAYS: z.coerce.number().int().positive().default(7),
  // Base URL of the public, unauthenticated web page that consumes
  // GET/POST /public/reviews/:token (see src/lib/publicReviewLinks.ts).
  // Deliberately optional with no baked-in production-looking default —
  // nothing here should let a fake domain slip into a customer-facing
  // message. Local/dev falls back to a clearly-local placeholder in
  // publicReviewLinks.ts instead of living here, so "required in
  // production, easy in dev" doesn't fight itself. Required (and must be
  // https://) in production because generating a review-request message —
  // the flow this feeds — is a core, always-available feature, not gated
  // behind an optional integration the way Twilio/Apple/Google are.
  PUBLIC_REVIEW_BASE_URL: z.preprocess((value) => (value === "" ? undefined : value), z.string().url().optional()),
  // Production Infrastructure Phase 2.2: email delivery (password reset,
  // team invitations) is a real product feature but — unlike
  // PUBLIC_REVIEW_BASE_URL above — is deliberately NOT unconditionally
  // required in production. Reasoning: getting Resend's sending domain
  // verified requires owning and DNS-configuring a real domain, which is a
  // separate, later step from "the API can boot and serve traffic" — see
  // sendPasswordResetEmail.ts/teamInvitationEmail.ts, both of which already
  // return false (never throw) when RESEND_API_KEY/EMAIL_FROM are absent,
  // and both call sites already treat that as a normal, safe outcome (a
  // 202 with no differing response for password reset; `emailSent: false`
  // plus the still-valid manual share link for team invitations). This
  // flag exists purely to control config.ts's OWN startup validation
  // below — it changes nothing about how the two send functions already
  // behave, since they already fail closed on missing credentials
  // regardless of this flag.
  EMAIL_ENABLED: booleanFlag,
  RESEND_API_KEY: optionalSecret,
  EMAIL_FROM: optionalSecret,
  GOOGLE_AUTH_ENABLED: booleanFlag,
  GOOGLE_OAUTH_CLIENT_IDS: optionalSecret,
  APPLE_AUTH_ENABLED: booleanFlag,
  APPLE_CLIENT_ID: optionalSecret,
  APPLE_TEAM_ID: optionalSecret,
  APPLE_KEY_ID: optionalSecret,
  APPLE_PRIVATE_KEY_BASE64: optionalSecret,
  PROVIDER_TOKEN_ENCRYPTION_KEY: optionalSecret,
  APPLE_CHALLENGE_TTL_MINUTES: z.coerce.number().int().positive().default(5),
  EXPO_ACCESS_TOKEN: optionalSecret,
  // Twilio is Phase 2's only messaging provider (see
  // src/lib/messaging/twilioProvider.ts). TWILIO_ENABLED is a deliberate
  // separate flag from "are credentials present" — it's what production
  // validation below keys off, so a business can have PRO/OUTBOUND_MESSAGING
  // entitlement without Twilio necessarily being wired up in every
  // environment (e.g. staging). Either a single sender number or a
  // Messaging Service SID is required to actually send; both are accepted
  // since Twilio itself supports either.
  TWILIO_ENABLED: booleanFlag,
  TWILIO_ACCOUNT_SID: optionalSecret,
  TWILIO_AUTH_TOKEN: optionalSecret,
  TWILIO_FROM_NUMBER: optionalSecret,
  TWILIO_MESSAGING_SERVICE_SID: optionalSecret,
  TWILIO_STATUS_CALLBACK_URL: z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional()),
  TWILIO_MONTHLY_MESSAGE_LIMIT: z.coerce.number().int().positive().default(1000),
  STRIPE_PAYMENTS_ENABLED: booleanFlag,
  STRIPE_SECRET_KEY: optionalSecret,
  STRIPE_WEBHOOK_SECRET: optionalSecret,
  STRIPE_CONNECT_RETURN_URL: z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional()),
  STRIPE_CONNECT_REFRESH_URL: z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional()),
  STRIPE_CHECKOUT_SUCCESS_URL: z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional()),
  STRIPE_CHECKOUT_CANCEL_URL: z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional()),
  // --- Apple billing: App Store Server API + Server Notifications V2 ---
  // Deliberately separate from APPLE_CLIENT_ID/APPLE_TEAM_ID/APPLE_KEY_ID/
  // APPLE_PRIVATE_KEY_BASE64 above (Sign in with Apple) even though both are
  // "Apple" and share the same Apple Developer team: App Store Connect
  // issues a *distinct* API key (its own Key ID + .p8 private key, under
  // Users and Access > Integrations > In-App Purchase) with a different
  // issuer ID, scoped to server-to-server App Store Server API calls, not
  // Sign in with Apple. Reusing the auth keys here would be wrong, not just
  // confusing. These are application-level Chakusa store-account secrets —
  // per the Phase report's "credential storage" section, they belong in
  // deployment environment/secrets, never in the database (the existing
  // encrypted providerCredentials table is for per-user linked-account
  // tokens, not this).
  APPLE_BILLING_ENABLED: booleanFlag,
  APPLE_BUNDLE_ID: optionalSecret,
  APPLE_BILLING_ISSUER_ID: optionalSecret,
  APPLE_BILLING_KEY_ID: optionalSecret,
  APPLE_BILLING_PRIVATE_KEY_BASE64: optionalSecret,
  // The one Pro monthly auto-renewable subscription product configured in
  // App Store Connect — the backend's approved-catalog identity check
  // (never trust a client-supplied product ID) resolves against this, not
  // a hardcoded literal. See src/lib/billing/productCatalog.ts.
  APPLE_PRO_MONTHLY_PRODUCT_ID: optionalSecret,
  // Business tier's Apple product — deliberately optional even when
  // APPLE_BILLING_ENABLED=true (never required in production validation
  // below): there is no mobile purchase UI for Business yet, so this is
  // readiness-only. Unset means productCatalog.ts simply never resolves
  // BUSINESS for Apple — the same fail-closed behavior as any unrecognized
  // product ID, not a startup error. See the Business Phase 1 report's
  // "Apple Business product mapping" section.
  APPLE_BUSINESS_MONTHLY_PRODUCT_ID: optionalSecret,
  // Despite the name, this governs BOTH Apple and Google billing (kept as
  // one shared setting deliberately — a single Chakusa deployment targets
  // one store environment at a time for both providers, not one each).
  // Selects which App Store Server API base URL to call (sandbox vs
  // production) and which environment a verified Apple transaction OR
  // Google purchase (via its `testPurchase` field) must report to ever
  // grant real Pro entitlement — see subscriptionReconciliation.ts's
  // assertExpectedEnvironment and the Phase report's "sandbox/production
  // separation" section. Defaults to SANDBOX so a freshly configured/
  // staging deployment can never accidentally treat as-yet-untested config
  // as production-authoritative.
  APPLE_STORE_ENVIRONMENT: z.enum(["SANDBOX", "PRODUCTION"]).default("SANDBOX"),
  // Comma-separated base64-DER Apple root CA certificate(s) this deployment
  // trusts to anchor signed-transaction/notification verification — see
  // src/lib/billing/jws.ts's doc comment for why this is a required
  // deployment input rather than a hardcoded certificate.
  APPLE_ROOT_CERTIFICATES_BASE64: optionalSecret,
  // --- Google billing: Play Developer API + Real-time Developer Notifications ---
  GOOGLE_BILLING_ENABLED: booleanFlag,
  GOOGLE_PLAY_PACKAGE_NAME: optionalSecret,
  // A Google Cloud service account with the Play Developer API's "View
  // financial data" / subscription-read role, granted access to this app in
  // Play Console (Users and permissions > API access) — server-to-server
  // credentials, kept in deployment environment/secrets like Apple's above,
  // never the database.
  GOOGLE_BILLING_SERVICE_ACCOUNT_EMAIL: optionalSecret,
  GOOGLE_BILLING_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64: optionalSecret,
  // The one Pro monthly subscription product/base-plan ID configured in
  // Play Console — same "approved catalog, never a client-trusted ID"
  // purpose as APPLE_PRO_MONTHLY_PRODUCT_ID.
  GOOGLE_PRO_MONTHLY_PRODUCT_ID: optionalSecret,
  // Business tier's Google product — same readiness-only, optional-even-
  // when-enabled reasoning as APPLE_BUSINESS_MONTHLY_PRODUCT_ID above.
  GOOGLE_BUSINESS_MONTHLY_PRODUCT_ID: optionalSecret,
  // Real-time Developer Notifications arrive as an authenticated Cloud
  // Pub/Sub push request — Pub/Sub signs each request with a Google-issued
  // OIDC token (Authorization: Bearer <token>) when the push subscription
  // is configured with an authenticating service account. These two values
  // are what src/modules/webhooks/googleWebhook.routes.ts verifies that
  // token's `email` and `aud` claims against — the same
  // verify-a-Google-issued-token shape googleVerifier.ts already uses for
  // Sign-In, applied to a different token source.
  GOOGLE_RTDN_SERVICE_ACCOUNT_EMAIL: optionalSecret,
  GOOGLE_RTDN_AUDIENCE: optionalSecret,
  // Behind a reverse proxy (Render/Railway/etc.), the socket's remote
  // address is the proxy's, not the real client's — Fastify's IP-based
  // rate limiting (@fastify/rate-limit's default keyGenerator uses
  // request.ip) silently degrades to "every request looks like it comes
  // from the same IP" unless the app is told to trust X-Forwarded-For.
  // Off by default (safe for local/dev, where there's no proxy and
  // trusting an arbitrary X-Forwarded-For would let a client spoof its
  // own rate-limit identity); set to "true" in production once the
  // deployment target's proxy is confirmed to set X-Forwarded-For
  // correctly and isn't reachable directly (bypassing the proxy).
  TRUST_PROXY: booleanFlag,
  // Optional comma-separated origin allowlist for browser-based clients.
  // Unset (the default) preserves today's `origin: true` behavior — safe
  // for a mobile-only client, since native apps don't send a
  // browser-enforced Origin header and this API uses bearer tokens, not
  // cookies, so there's no CSRF surface from reflecting an arbitrary
  // origin. Set this once a real web frontend domain exists; no domain is
  // invented here since none is configured yet.
  CORS_ALLOWED_ORIGINS: optionalSecret,
  // Disabled by default. In production, enabling the internal console also
  // requires its exact HTTPS origin (the eventual Cloudflare URL).
  ADMIN_CONSOLE_ENABLED: booleanFlag,
  ADMIN_CONSOLE_ORIGIN: z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional()),
  // Production Infrastructure Phase 4: same "off by default, feature-flag
  // gated" shape as EMAIL_ENABLED above — Sentry is an operational nicety,
  // not something local dev/test or an unconfigured deployment should ever
  // be blocked by. See src/lib/sentry.ts, which additionally refuses to
  // actually initialize the SDK outside NODE_ENV=production regardless of
  // this flag (defense in depth — a stray SENTRY_ENABLED=true in a test
  // run must never start reporting real events).
  SENTRY_ENABLED: booleanFlag,
  SENTRY_DSN: optionalSecret,
  // Free-text, not an enum — Sentry itself just groups events by whatever
  // string you send. Defaults to NODE_ENV at use-site (src/lib/sentry.ts),
  // not baked in here, so this only needs setting to override that default
  // (e.g. distinguishing "production" from a future "staging").
  SENTRY_ENVIRONMENT: optionalSecret,
  // Recommended production value: your platform's own deploy/commit
  // identifier (e.g. Render sets RENDER_GIT_COMMIT automatically) — lets
  // Sentry associate an issue with the exact deployed commit. Optional;
  // Sentry functions fine without it, just with less precise grouping.
  SENTRY_RELEASE: optionalSecret,
}).superRefine((env, context) => {
  if (env.NODE_ENV !== "production") return;
  if (env.EMAIL_ENABLED && !env.RESEND_API_KEY) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["RESEND_API_KEY"], message: "RESEND_API_KEY is required in production when EMAIL_ENABLED=true" });
  }
  if (env.EMAIL_ENABLED && !env.EMAIL_FROM) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["EMAIL_FROM"], message: "EMAIL_FROM is required in production when EMAIL_ENABLED=true" });
  }
  if (env.SENTRY_ENABLED && !env.SENTRY_DSN) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["SENTRY_DSN"], message: "SENTRY_DSN is required in production when SENTRY_ENABLED=true" });
  }
  if (env.ADMIN_CONSOLE_ENABLED) {
    if (!env.ADMIN_CONSOLE_ORIGIN) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["ADMIN_CONSOLE_ORIGIN"], message: "ADMIN_CONSOLE_ORIGIN is required in production when ADMIN_CONSOLE_ENABLED=true" });
    } else if (!env.ADMIN_CONSOLE_ORIGIN.startsWith("https://")) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["ADMIN_CONSOLE_ORIGIN"], message: "ADMIN_CONSOLE_ORIGIN must use https:// in production" });
    } else if (new URL(env.ADMIN_CONSOLE_ORIGIN).origin !== env.ADMIN_CONSOLE_ORIGIN) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["ADMIN_CONSOLE_ORIGIN"], message: "ADMIN_CONSOLE_ORIGIN must be an origin only, with no path or trailing slash" });
    }
  }
  if (!env.PUBLIC_REVIEW_BASE_URL) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["PUBLIC_REVIEW_BASE_URL"], message: "PUBLIC_REVIEW_BASE_URL is required in production to generate customer-facing review links" });
  } else if (!env.PUBLIC_REVIEW_BASE_URL.startsWith("https://")) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["PUBLIC_REVIEW_BASE_URL"], message: "PUBLIC_REVIEW_BASE_URL must use https:// in production" });
  }
  if (env.GOOGLE_AUTH_ENABLED && !env.GOOGLE_OAUTH_CLIENT_IDS) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["GOOGLE_OAUTH_CLIENT_IDS"], message: "GOOGLE_OAUTH_CLIENT_IDS is required in production when GOOGLE_AUTH_ENABLED=true" });
  }
  if (env.APPLE_AUTH_ENABLED) {
    const appleValues = [env.APPLE_CLIENT_ID, env.APPLE_TEAM_ID, env.APPLE_KEY_ID, env.APPLE_PRIVATE_KEY_BASE64, env.PROVIDER_TOKEN_ENCRYPTION_KEY];
    if (!appleValues.every(Boolean)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["APPLE_CLIENT_ID"], message: "APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY_BASE64, and PROVIDER_TOKEN_ENCRYPTION_KEY are all required in production when APPLE_AUTH_ENABLED=true" });
    }
  }
  if (env.TWILIO_ENABLED) {
    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["TWILIO_ACCOUNT_SID"], message: "TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required in production when TWILIO_ENABLED=true" });
    }
    if (!env.TWILIO_FROM_NUMBER && !env.TWILIO_MESSAGING_SERVICE_SID) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["TWILIO_FROM_NUMBER"], message: "Either TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID is required in production when TWILIO_ENABLED=true" });
    }
  }
  if (env.STRIPE_PAYMENTS_ENABLED) {
    const stripeValues = [env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET, env.STRIPE_CONNECT_RETURN_URL, env.STRIPE_CONNECT_REFRESH_URL, env.STRIPE_CHECKOUT_SUCCESS_URL, env.STRIPE_CHECKOUT_CANCEL_URL];
    if (!stripeValues.every(Boolean)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["STRIPE_SECRET_KEY"], message: "All Stripe payment secrets and redirect URLs are required in production when STRIPE_PAYMENTS_ENABLED=true" });
  }
  if (env.APPLE_BILLING_ENABLED) {
    const appleBillingValues = [env.APPLE_BUNDLE_ID, env.APPLE_BILLING_ISSUER_ID, env.APPLE_BILLING_KEY_ID, env.APPLE_BILLING_PRIVATE_KEY_BASE64, env.APPLE_PRO_MONTHLY_PRODUCT_ID, env.APPLE_ROOT_CERTIFICATES_BASE64];
    if (!appleBillingValues.every(Boolean)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["APPLE_BUNDLE_ID"], message: "APPLE_BUNDLE_ID, APPLE_BILLING_ISSUER_ID, APPLE_BILLING_KEY_ID, APPLE_BILLING_PRIVATE_KEY_BASE64, APPLE_PRO_MONTHLY_PRODUCT_ID, and APPLE_ROOT_CERTIFICATES_BASE64 are all required in production when APPLE_BILLING_ENABLED=true" });
    }
  }
  if (env.GOOGLE_BILLING_ENABLED) {
    const googleBillingValues = [env.GOOGLE_PLAY_PACKAGE_NAME, env.GOOGLE_BILLING_SERVICE_ACCOUNT_EMAIL, env.GOOGLE_BILLING_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64, env.GOOGLE_PRO_MONTHLY_PRODUCT_ID];
    if (!googleBillingValues.every(Boolean)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["GOOGLE_PLAY_PACKAGE_NAME"], message: "GOOGLE_PLAY_PACKAGE_NAME, GOOGLE_BILLING_SERVICE_ACCOUNT_EMAIL, GOOGLE_BILLING_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64, and GOOGLE_PRO_MONTHLY_PRODUCT_ID are all required in production when GOOGLE_BILLING_ENABLED=true" });
    }
    if (!env.GOOGLE_RTDN_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_RTDN_AUDIENCE) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["GOOGLE_RTDN_SERVICE_ACCOUNT_EMAIL"], message: "GOOGLE_RTDN_SERVICE_ACCOUNT_EMAIL and GOOGLE_RTDN_AUDIENCE are required in production when GOOGLE_BILLING_ENABLED=true, to authenticate Real-time Developer Notifications" });
    }
  }
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration");
}

export const config = parsed.data;

export const googleOAuthClientIds = config.GOOGLE_OAUTH_CLIENT_IDS
  ?.split(",")
  .map((value) => value.trim())
  .filter(Boolean) ?? [];

const configuredCorsOrigins = config.CORS_ALLOWED_ORIGINS
  ?.split(",")
  .map((value) => value.trim())
  .filter(Boolean) ?? null;

export const corsAllowedOrigins = configuredCorsOrigins || config.ADMIN_CONSOLE_ORIGIN
  ? [...new Set([...(configuredCorsOrigins ?? []), ...(config.ADMIN_CONSOLE_ORIGIN ? [config.ADMIN_CONSOLE_ORIGIN] : [])])]
  : null;
