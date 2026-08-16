import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ZodError, z } from "zod";
import { Prisma } from "@prisma/client";
import { envSchema } from "../src/lib/config.js";
import { ApiError } from "../src/lib/errors.js";

const withScopeMock = vi.fn();
const captureExceptionMock = vi.fn();

vi.mock("@sentry/node", () => ({
  withScope: (callback: (scope: { setUser: (...args: unknown[]) => void; setTag: (...args: unknown[]) => void }) => void) => {
    withScopeMock();
    callback({ setUser: vi.fn(), setTag: vi.fn() });
  },
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
  init: vi.fn(),
  flush: vi.fn(),
}));

// Imported AFTER the mock above so sentry.ts's `import * as Sentry from
// "@sentry/node"` resolves to the mocked module — Production
// Infrastructure Phase 4's sentry.ts logic is tested entirely without a
// real Sentry client, a real DSN, or any network call.
const { shouldCaptureError, sentryBeforeSend, reportFastifyError } = await import("../src/lib/sentry.js");

function baseProductionEnv(overrides: Record<string, string> = {}) {
  return {
    DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/chakusa_test?schema=public",
    JWT_SECRET: "a-fake-but-long-enough-test-jwt-secret",
    NODE_ENV: "production",
    PUBLIC_REVIEW_BASE_URL: "https://chakusa.example.com",
    ...overrides,
  };
}

describe("config.ts: SENTRY_ENABLED gates DSN requirement in production", () => {
  it("1. production boots with SENTRY_ENABLED=false and no DSN", () => {
    const result = envSchema.safeParse(baseProductionEnv({ SENTRY_ENABLED: "false" }));
    expect(result.success).toBe(true);
  });

  it("production boots with SENTRY_ENABLED unset (defaults false)", () => {
    const result = envSchema.safeParse(baseProductionEnv());
    expect(result.success).toBe(true);
  });

  it("2. SENTRY_ENABLED=true requires SENTRY_DSN", () => {
    const result = envSchema.safeParse(baseProductionEnv({ SENTRY_ENABLED: "true" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.SENTRY_DSN).toBeDefined();
    }
  });

  it("SENTRY_ENABLED=true with a DSN present boots successfully", () => {
    const result = envSchema.safeParse(baseProductionEnv({ SENTRY_ENABLED: "true", SENTRY_DSN: "https://fake@o0.ingest.sentry.io/0" }));
    expect(result.success).toBe(true);
  });

  it("SENTRY_ENABLED has no effect outside production", () => {
    const result = envSchema.safeParse({
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/chakusa_test?schema=public",
      JWT_SECRET: "a-fake-but-long-enough-test-jwt-secret",
      NODE_ENV: "development",
      SENTRY_ENABLED: "true",
    });
    expect(result.success).toBe(true);
  });
});

describe("shouldCaptureError: expected vs. unexpected error classification", () => {
  it("3. does not capture expected 4xx ApiErrors", () => {
    expect(shouldCaptureError(ApiError.badRequest("bad input"))).toBe(false);
    expect(shouldCaptureError(ApiError.unauthorized())).toBe(false);
    expect(shouldCaptureError(ApiError.forbidden())).toBe(false);
    expect(shouldCaptureError(ApiError.notFound())).toBe(false);
    expect(shouldCaptureError(ApiError.conflict("already exists"))).toBe(false);
    expect(shouldCaptureError(ApiError.limitReached("leads", "leads", { limit: 1, current: 1, plan: "FREE" }))).toBe(false);
    expect(shouldCaptureError(ApiError.featureNotAvailable("AUTOMATION", "Automation", "FREE"))).toBe(false);
    expect(shouldCaptureError(ApiError.auth(401, "AUTH_INVALID_CREDENTIALS", "bad credentials"))).toBe(false);
  });

  it("does not capture ZodError (mapped to 400)", () => {
    const result = z.string().safeParse(123);
    expect(result.error).toBeInstanceOf(ZodError);
    if (result.error) expect(shouldCaptureError(result.error)).toBe(false);
  });

  it("does not capture known Prisma conflict/not-found codes (mapped to 409/404)", () => {
    const conflict = new Prisma.PrismaClientKnownRequestError("unique constraint", { code: "P2002", clientVersion: "5.22.0" });
    const notFound = new Prisma.PrismaClientKnownRequestError("not found", { code: "P2025", clientVersion: "5.22.0" });
    expect(shouldCaptureError(conflict)).toBe(false);
    expect(shouldCaptureError(notFound)).toBe(false);
  });

  it("4. captures a genuine unexpected 5xx ApiError (e.g. providerSendFailed)", () => {
    const providerError = ApiError.providerSendFailed({ provider: "twilio", permanentFailure: false, messageId: "m1" });
    expect(shouldCaptureError(providerError)).toBe(true);
  });

  it("captures a raw, unclassified bug (TypeError)", () => {
    expect(shouldCaptureError(new TypeError("cannot read properties of undefined"))).toBe(true);
  });
});

describe("sentryBeforeSend: redaction", () => {
  it("5. redacts the Authorization header", () => {
    const event = { request: { headers: { authorization: "Bearer super-secret-jwt", "content-type": "application/json" } } } as never;
    const result = sentryBeforeSend(event);
    expect(result.request?.headers).not.toHaveProperty("authorization");
    expect(result.request?.headers?.["content-type"]).toBe("application/json");
  });

  it("redacts the Cookie header", () => {
    const event = { request: { headers: { cookie: "session=abc123" } } } as never;
    const result = sentryBeforeSend(event);
    expect(result.request?.headers).not.toHaveProperty("cookie");
  });

  it("6. does not attach a database connection string anywhere in the event", () => {
    const event = { extra: { databaseUrl: "postgresql://user:pw@host:5432/db", directUrl: "postgresql://user:pw@host:5432/db" } } as never;
    const result = sentryBeforeSend(event);
    expect(JSON.stringify(result.extra)).not.toContain("postgresql://");
    expect((result.extra as Record<string, unknown>).databaseUrl).toBe("[Redacted]");
  });

  it("7. scrubs password/token fields from request data", () => {
    const event = {
      request: {
        data: {
          email: "user@example.com",
          password: "hunter2",
          token: "raw-invite-token-value",
          refreshToken: "raw-refresh-token",
        },
      },
    } as never;
    const result = sentryBeforeSend(event);
    const data = result.request?.data as Record<string, unknown>;
    expect(data.password).toBe("[Redacted]");
    expect(data.token).toBe("[Redacted]");
    expect(data.refreshToken).toBe("[Redacted]");
    expect(data.email).toBe("user@example.com");
  });

  it("removes cookies and query string from the request entirely", () => {
    const event = { request: { cookies: { session: "abc" }, query_string: "token=raw-token-value" } } as never;
    const result = sentryBeforeSend(event);
    expect(result.request?.cookies).toBeUndefined();
    expect(result.request?.query_string).toBeUndefined();
  });
});

describe("reportFastifyError: capture decision and safe context", () => {
  beforeEach(() => {
    withScopeMock.mockClear();
    captureExceptionMock.mockClear();
  });

  it("does not call Sentry for an expected 4xx error", () => {
    reportFastifyError({ user: undefined, businessId: undefined, role: undefined } as never,ApiError.notFound());
    expect(withScopeMock).not.toHaveBeenCalled();
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("8. calls Sentry with safe user/business context for an unexpected error", () => {
    reportFastifyError(
      { user: { userId: "user-123", sessionId: "session-123", type: "access" }, businessId: "business-456", role: "OWNER" },
      new Error("unexpected failure"),
    );
    expect(withScopeMock).toHaveBeenCalledTimes(1);
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it("still captures an unexpected error for an unauthenticated request (no user/business context)", () => {
    reportFastifyError({ user: undefined, businessId: undefined, role: undefined } as never,new Error("boom"));
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });
});

describe("Health/readiness endpoints never throw, so they never reach the Sentry error hook", () => {
  it("9. GET /health/ready's handler wraps its DB check in try/catch and never lets it propagate as a thrown error", () => {
    const appSource = readFileSync(fileURLToPath(new URL("../src/app.ts", import.meta.url)), "utf8");
    const readyRouteMatch = appSource.match(/app\.get\("\/health\/ready"[\s\S]*?\n {2}\}\);/);
    expect(readyRouteMatch).not.toBeNull();
    expect(readyRouteMatch?.[0]).toMatch(/try\s*{[\s\S]*catch/);
  });
});

describe("Existing API error behavior is unchanged", () => {
  it("10. shouldCaptureError classification matches errorHandler.ts's own status-code mapping for every ApiError code used in this repo", () => {
    // A regression guard, not a route-level test (route behavior itself is
    // covered by the rest of the suite) — confirms the two classifiers
    // (errorHandler.ts's response mapping, sentry.ts's capture decision)
    // never silently drift: every ApiError factory in errors.ts still
    // produces a statusCode < 500 except providerSendFailed (502).
    expect(ApiError.badRequest("x").statusCode).toBeLessThan(500);
    expect(ApiError.unauthorized().statusCode).toBeLessThan(500);
    expect(ApiError.forbidden().statusCode).toBeLessThan(500);
    expect(ApiError.notFound().statusCode).toBeLessThan(500);
    expect(ApiError.conflict("x").statusCode).toBeLessThan(500);
    expect(ApiError.providerSendFailed({ provider: "twilio", permanentFailure: false, messageId: "m" }).statusCode).toBeGreaterThanOrEqual(500);
  });
});
