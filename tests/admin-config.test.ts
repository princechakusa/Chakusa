import { describe, expect, it } from "vitest";
import { envSchema } from "../src/lib/config.js";

const productionBase = {
  NODE_ENV: "production" as const,
  DATABASE_URL: "postgresql://example.invalid/chakusa",
  JWT_SECRET: "production-shaped-test-secret",
  PUBLIC_REVIEW_BASE_URL: "https://reviews.example.com",
};

describe("admin console production configuration", () => {
  it("allows the console to remain disabled without an origin", () => {
    expect(envSchema.safeParse({ ...productionBase, ADMIN_CONSOLE_ENABLED: "false" }).success).toBe(true);
  });

  it("fails closed when enabled without its exact origin", () => {
    const result = envSchema.safeParse({ ...productionBase, ADMIN_CONSOLE_ENABLED: "true" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors.ADMIN_CONSOLE_ORIGIN).toBeDefined();
  });

  it("requires HTTPS for the eventual Cloudflare-hosted origin", () => {
    expect(envSchema.safeParse({ ...productionBase, ADMIN_CONSOLE_ENABLED: "true", ADMIN_CONSOLE_ORIGIN: "http://admin.example.com" }).success).toBe(false);
    expect(envSchema.safeParse({ ...productionBase, ADMIN_CONSOLE_ENABLED: "true", ADMIN_CONSOLE_ORIGIN: "https://admin.example.com" }).success).toBe(true);
  });

  it("rejects a URL path or trailing slash where an exact origin is required", () => {
    expect(envSchema.safeParse({ ...productionBase, ADMIN_CONSOLE_ENABLED: "true", ADMIN_CONSOLE_ORIGIN: "https://admin.example.com/path" }).success).toBe(false);
    expect(envSchema.safeParse({ ...productionBase, ADMIN_CONSOLE_ENABLED: "true", ADMIN_CONSOLE_ORIGIN: "https://admin.example.com/" }).success).toBe(false);
  });
});
