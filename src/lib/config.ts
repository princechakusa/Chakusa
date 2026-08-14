import "dotenv/config";
import { z } from "zod";

const optionalSecret = z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).optional());

const booleanFlag = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toLowerCase() === "true" : value),
  z.boolean().default(false),
);

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
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
}).superRefine((env, context) => {
  if (env.NODE_ENV !== "production") return;
  if (!env.RESEND_API_KEY) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["RESEND_API_KEY"], message: "RESEND_API_KEY is required in production" });
  }
  if (!env.EMAIL_FROM) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["EMAIL_FROM"], message: "EMAIL_FROM is required in production" });
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

export const corsAllowedOrigins = config.CORS_ALLOWED_ORIGINS
  ?.split(",")
  .map((value) => value.trim())
  .filter(Boolean) ?? null;
