import { describe, expect, it } from "vitest";
import { assertLocalTestDatabaseTarget } from "../src/lib/localTestDatabaseGuard.js";

const environment = (databaseUrl?: string, nodeEnv = "test") => ({
  NODE_ENV: nodeEnv,
  DATABASE_URL: databaseUrl,
});

describe("local test database guard", () => {
  it.each([
    "postgresql://postgres:secret@localhost:5432/chakusa_test",
    "postgresql://postgres:secret@127.0.0.1:5432/chakusa_test",
    "postgresql://postgres:secret@[::1]:5432/chakusa_test",
  ])("accepts approved local target %s", (url) => {
    expect(assertLocalTestDatabaseTarget(environment(url))).toMatchObject({ database: "chakusa_test" });
  });

  it.each([
    "postgresql://user:secret@project.supabase.co:5432/chakusa_test",
    "postgresql://user:secret@database.render.com:5432/chakusa_test",
    "postgresql://user:secret@db.example.com:5432/chakusa_test",
  ])("rejects remote target %s", (url) => {
    expect(() => assertLocalTestDatabaseTarget(environment(url))).toThrow("database host is not local");
  });

  it("rejects a non-test database", () => {
    expect(() => assertLocalTestDatabaseTarget(environment("postgresql://postgres:secret@localhost:5432/chakusa"))).toThrow(
      'database name must be "chakusa_test"',
    );
  });

  it("rejects a missing DATABASE_URL", () => {
    expect(() => assertLocalTestDatabaseTarget(environment())).toThrow("DATABASE_URL is required");
  });

  it("rejects a non-test environment", () => {
    expect(() => assertLocalTestDatabaseTarget(environment("postgresql://postgres:secret@localhost:5432/chakusa_test", "development"))).toThrow(
      'NODE_ENV must be "test"',
    );
  });

  it("does not expose credentials in an error", () => {
    const password = "never-print-this-password";
    let message = "";
    try {
      assertLocalTestDatabaseTarget(environment(`postgresql://demo:${password}@remote.example.com/chakusa_test`));
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toContain(password);
    expect(message).not.toContain("demo:");
  });
});
