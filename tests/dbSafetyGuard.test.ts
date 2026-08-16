import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertDestructiveTestDatabaseAccessAllowed, TestDatabaseSafetyError } from "./dbSafetyGuard.js";

/**
 * Pure logic tests for the safety guard itself — Production Safety Phase
 * 2.1. None of these connect to any database, real or fake; they only
 * exercise assertDestructiveTestDatabaseAccessAllowed()'s decision logic
 * against crafted process.env values, restored after every test so this
 * file can never leak a bad NODE_ENV/DATABASE_URL into any other test file
 * (fileParallelism is false in vitest.config.ts, so test files share a
 * process — restoring here is not optional).
 */
describe("Chakusa test database safety guard", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/chakusa_test?schema=public";
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it("rejects a Supabase transaction-mode pooler URL", () => {
    process.env.DATABASE_URL = "postgresql://postgres.abcdefghijk:password@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true";
    expect(() => assertDestructiveTestDatabaseAccessAllowed()).toThrow(TestDatabaseSafetyError);
  });

  it("rejects a Supabase session-mode pooler URL", () => {
    process.env.DATABASE_URL = "postgresql://postgres.abcdefghijk:password@aws-0-eu-central-1.pooler.supabase.com:5432/postgres";
    expect(() => assertDestructiveTestDatabaseAccessAllowed()).toThrow(TestDatabaseSafetyError);
  });

  it("rejects a Supabase direct database URL", () => {
    process.env.DATABASE_URL = "postgresql://postgres:password@db.abcdefghijklmnop.supabase.co:5432/postgres";
    expect(() => assertDestructiveTestDatabaseAccessAllowed()).toThrow(TestDatabaseSafetyError);
  });

  it("rejects a generic remote PostgreSQL host", () => {
    process.env.DATABASE_URL = "postgresql://someuser:somepassword@db.example-hosting.com:5432/chakusa_test";
    expect(() => assertDestructiveTestDatabaseAccessAllowed()).toThrow(TestDatabaseSafetyError);
  });

  it("rejects a production-looking database name even on an allowed local host", () => {
    process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/chakusa_production?schema=public";
    expect(() => assertDestructiveTestDatabaseAccessAllowed()).toThrow(TestDatabaseSafetyError);
  });

  it("rejects when NODE_ENV is not \"test\"", () => {
    process.env.NODE_ENV = "production";
    expect(() => assertDestructiveTestDatabaseAccessAllowed()).toThrow(TestDatabaseSafetyError);
  });

  it("rejects when NODE_ENV is \"development\" even with an otherwise-valid local test URL", () => {
    process.env.NODE_ENV = "development";
    expect(() => assertDestructiveTestDatabaseAccessAllowed()).toThrow(TestDatabaseSafetyError);
  });

  it("rejects a missing DATABASE_URL", () => {
    delete process.env.DATABASE_URL;
    expect(() => assertDestructiveTestDatabaseAccessAllowed()).toThrow(TestDatabaseSafetyError);
  });

  it("rejects a malformed DATABASE_URL", () => {
    process.env.DATABASE_URL = "not-a-valid-url";
    expect(() => assertDestructiveTestDatabaseAccessAllowed()).toThrow(TestDatabaseSafetyError);
  });

  it("rejects a Render-hosted PostgreSQL URL indicator", () => {
    process.env.DATABASE_URL = "postgresql://user:password@some-db.render.com:5432/chakusa_test";
    expect(() => assertDestructiveTestDatabaseAccessAllowed()).toThrow(TestDatabaseSafetyError);
  });

  it("never includes the raw connection string or a password in its error message", () => {
    process.env.DATABASE_URL = "postgresql://produser:super-secret-password@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true";
    try {
      assertDestructiveTestDatabaseAccessAllowed();
      throw new Error("expected assertDestructiveTestDatabaseAccessAllowed to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(TestDatabaseSafetyError);
      const message = (error as Error).message;
      expect(message).not.toContain("super-secret-password");
      expect(message).not.toContain("produser");
    }
  });

  it("accepts the approved local test database configuration", () => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/chakusa_test?schema=public";
    expect(() => assertDestructiveTestDatabaseAccessAllowed()).not.toThrow();
  });

  it("accepts 127.0.0.1 as an approved local host", () => {
    process.env.DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/chakusa_test?schema=public";
    expect(() => assertDestructiveTestDatabaseAccessAllowed()).not.toThrow();
  });
});
