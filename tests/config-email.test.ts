import { describe, expect, it } from "vitest";
import { envSchema } from "../src/lib/config.js";

/**
 * Production Infrastructure Phase 2.2 — pure schema-validation tests for
 * EMAIL_ENABLED's effect on config.ts's production superRefine, via
 * envSchema.safeParse() directly. No process spawning, no app boot: these
 * exercise exactly the same validation logic the real process runs at
 * startup, without needing a second process to prove it.
 */
function baseProductionEnv(overrides: Record<string, string> = {}) {
  return {
    DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/chakusa_test?schema=public",
    JWT_SECRET: "a-fake-but-long-enough-test-jwt-secret",
    NODE_ENV: "production",
    PUBLIC_REVIEW_BASE_URL: "https://chakusa.example.com",
    ...overrides,
  };
}

describe("config.ts: EMAIL_ENABLED gates Resend requirements in production", () => {
  it("1. production boots with EMAIL_ENABLED=false and no Resend credentials", () => {
    const result = envSchema.safeParse(baseProductionEnv({ EMAIL_ENABLED: "false" }));
    expect(result.success).toBe(true);
  });

  it("2. EMAIL_ENABLED=true requires RESEND_API_KEY", () => {
    const result = envSchema.safeParse(baseProductionEnv({ EMAIL_ENABLED: "true", EMAIL_FROM: "Chakusa <notifications@chakusa.example.com>" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.RESEND_API_KEY).toBeDefined();
    }
  });

  it("3. EMAIL_ENABLED=true requires EMAIL_FROM", () => {
    const result = envSchema.safeParse(baseProductionEnv({ EMAIL_ENABLED: "true", RESEND_API_KEY: "re_fake_test_key" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.EMAIL_FROM).toBeDefined();
    }
  });

  it("10. existing email-enabled behavior is unchanged: EMAIL_ENABLED=true with both credentials present still boots", () => {
    const result = envSchema.safeParse(
      baseProductionEnv({ EMAIL_ENABLED: "true", RESEND_API_KEY: "re_fake_test_key", EMAIL_FROM: "Chakusa <notifications@chakusa.example.com>" }),
    );
    expect(result.success).toBe(true);
  });

  it("EMAIL_ENABLED defaults to false when unset — production still boots without Resend credentials", () => {
    const result = envSchema.safeParse(baseProductionEnv());
    expect(result.success).toBe(true);
  });

  it("EMAIL_ENABLED has no effect outside production — development/test never require Resend credentials", () => {
    const result = envSchema.safeParse({
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/chakusa_test?schema=public",
      JWT_SECRET: "a-fake-but-long-enough-test-jwt-secret",
      NODE_ENV: "development",
      EMAIL_ENABLED: "true",
    });
    expect(result.success).toBe(true);
  });
});
