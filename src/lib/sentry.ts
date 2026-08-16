import * as Sentry from "@sentry/node";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "./config.js";
import { ApiError } from "./errors.js";

/**
 * Production Infrastructure Phase 4 — the smallest correct Sentry
 * integration for the backend API only (not the worker, not mobile — see
 * the phase report).
 *
 * Two independent gates control whether Sentry ever does real work:
 *   1. config.SENTRY_ENABLED (off by default; required alongside
 *      SENTRY_DSN in production — see config.ts's superRefine).
 *   2. NODE_ENV !== "test", checked here directly rather than trusted from
 *      the flag alone — defense in depth so a stray SENTRY_ENABLED=true
 *      environment variable in a test run can never cause a real test
 *      process to start reporting events to a real Sentry project.
 * Both must hold for initSentry()/attachFastifySentry() to do anything;
 * otherwise they're a no-op, and every Sentry.* call elsewhere in the SDK
 * safely does nothing when no client has been initialized.
 */
function sentryActuallyEnabled(): boolean {
  return config.SENTRY_ENABLED && config.NODE_ENV !== "test";
}

const SENSITIVE_KEY_PATTERN =
  /^(authorization|cookie|password|token|refreshtoken|accesstoken|apikey|secret|dsn|databaseurl|directurl|jwtsecret|purchasetoken|transactionid|providertokenencryptionkey|resendapikey|twilioauthtoken|twilioaccountsid)$/i;

/**
 * Recursively redacts any object key matching SENSITIVE_KEY_PATTERN,
 * in-place-safe (returns a new structure, never mutates the input) — used
 * as defense in depth on top of Sentry's own sendDefaultPii:false default
 * (which already excludes full request bodies/headers/cookies by default).
 * This exists so that even if a future call site attaches extra context
 * containing one of these field names, it never reaches Sentry's servers
 * verbatim.
 */
function scrub(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => scrub(item, depth + 1));
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    result[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[Redacted]" : scrub(val, depth + 1);
  }
  return result;
}

/**
 * Extracted as its own exported function (rather than inlined into
 * Sentry.init() below) so tests can call it directly against a fake event
 * object — see tests/sentry.test.ts — without needing a real Sentry client
 * initialized at all.
 */
export function sentryBeforeSend(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (event.request) {
    if (event.request.headers) {
      const headers = { ...event.request.headers };
      delete headers.authorization;
      delete headers.Authorization;
      delete headers.cookie;
      delete headers.Cookie;
      event.request.headers = headers as typeof event.request.headers;
    }
    if (event.request.data !== undefined) {
      event.request.data = scrub(event.request.data) as typeof event.request.data;
    }
    // Never send the URL's query string or cookies-in-url verbatim —
    // opaque tokens (public review tokens, team invitation tokens,
    // password reset tokens) travel in some of this API's URLs.
    delete event.request.cookies;
    delete event.request.query_string;
  }
  if (event.extra) {
    event.extra = scrub(event.extra) as typeof event.extra;
  }
  return event;
}

export function initSentry(): void {
  if (!sentryActuallyEnabled()) return;
  Sentry.init({
    dsn: config.SENTRY_DSN,
    environment: config.SENTRY_ENVIRONMENT ?? config.NODE_ENV,
    release: config.SENTRY_RELEASE,
    // Never send cookies/IP/headers by default — everything sent is
    // explicit, via the scrubbing below, not Sentry's own PII collection.
    sendDefaultPii: false,
    beforeSend: sentryBeforeSend,
  });
}

/**
 * Mirrors errorHandler.ts's own error classification (ApiError/ZodError/
 * known Prisma error codes → their real HTTP status), but for a different
 * purpose: deciding whether an error is an EXPECTED business-logic outcome
 * (never worth a Sentry incident) or a genuine unexpected failure (always
 * worth one). Deliberately status-code-based rather than a hardcoded list
 * of "safe" error classes — a >=500 ApiError (e.g. providerSendFailed, a
 * real downstream provider failure) still represents a real operational
 * problem and should still be captured, while every <500 ApiError (
 * validation, unauthorized, forbidden, limit reached, feature not
 * available, conflict, not found, rate limited) never is. An error with no
 * recognizable status at all (a raw bug — TypeError, ReferenceError, an
 * unhandled Prisma error, etc.) is always captured, since that's exactly
 * the "unexpected" case Sentry exists for.
 */
export function shouldCaptureError(error: unknown): boolean {
  if (error instanceof ZodError) return false;
  if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2025")) return false;
  if (error instanceof ApiError) return error.statusCode >= 500;
  if (typeof error === "object" && error !== null && "statusCode" in error) {
    const statusCode = (error as { statusCode: unknown }).statusCode;
    if (typeof statusCode === "number") return statusCode >= 500;
  }
  return true;
}

/**
 * The body of a plain Fastify `onError` hook (Fastify's own lifecycle
 * mechanism, not a Sentry-specific wrapper) — runs alongside (never
 * replaces) errorHandlerPlugin's own `setErrorHandler`, so the public
 * API's response shape/status codes are completely unchanged by this.
 * Extracted from attachFastifySentry below so tests can invoke it directly
 * (with @sentry/node mocked — see tests/sentry.test.ts) without needing a
 * real Fastify app or a real Sentry client; it always runs its full logic
 * when called, regardless of whether Sentry is actually enabled —
 * attachFastifySentry is what decides WHETHER it's ever wired up to real
 * traffic.
 *
 * Deliberately NOT using @sentry/node's setupFastifyErrorHandler helper:
 * its default `shouldHandleError` reads `reply.statusCode`, which is not
 * yet reliably set when Fastify's onError hook fires (it runs before our
 * custom error handler assigns the final status) — that default would
 * incorrectly capture ordinary 4xx ApiErrors. shouldCaptureError above
 * inspects the error object itself instead, which is accurate regardless
 * of hook timing, and a plain onError hook gives correctly-timed access to
 * `request.user`/`request.businessId`/`request.role` for free: by the time
 * an error reaches this hook, any preHandler that ran successfully before
 * it (fastify.authenticate, fastify.requireBusiness) has already resolved
 * those fields on `request` — never email, phone, or other PII, only the
 * internal identifiers useful for tracing which business an incident
 * affected.
 */
export function reportFastifyError(request: Pick<FastifyRequest, "user" | "businessId" | "role">, error: unknown): void {
  if (!shouldCaptureError(error)) return;
  Sentry.withScope((scope) => {
    scope.setUser(request.user?.userId ? { id: request.user.userId } : null);
    if (request.businessId) scope.setTag("businessId", request.businessId);
    if (request.role) scope.setTag("role", request.role);
    Sentry.captureException(error);
  });
}

export function attachFastifySentry(app: FastifyInstance): void {
  if (!sentryActuallyEnabled()) return;
  app.addHook("onError", async (request, _reply, error) => reportFastifyError(request, error));
}

/** For process-level capture (uncaughtException/unhandledRejection, startup failures) — see src/server.ts. No-ops when Sentry isn't enabled. */
export function captureUnexpectedError(error: unknown): void {
  if (!sentryActuallyEnabled()) return;
  Sentry.captureException(error);
}

/** Best-effort flush before process exit, so a captured event isn't lost when the process is about to die. No-ops when Sentry isn't enabled. */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!sentryActuallyEnabled()) return;
  await Sentry.flush(timeoutMs);
}
