/**
 * Chakusa test database safety guard — Production Safety Phase 2.1.
 *
 * The single, centralized gate every destructive test code path must pass
 * through before it's allowed to run. Deliberately lives under tests/ (not
 * src/) so it is never part of the compiled production build (tsconfig.json
 * only includes src/**) — this file cannot ship, cannot be imported by
 * application code, and cannot accidentally run outside a test process.
 *
 * Design: fail CLOSED, multiple independent conditions, defense in depth.
 * A single check (just NODE_ENV, or just a "localhost" substring test) is
 * exactly the kind of thing that's trivially defeated by one wrong
 * assumption — see the four independent conditions below, ALL of which
 * must hold. No condition is trusted alone.
 */

const ALLOWED_TEST_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

const EXPECTED_TEST_DATABASE_NAME = "chakusa_test";

// Substring checks over the full, lowercased URL — deliberately in ADDITION
// to (not instead of) the structured host/database-name checks above, so a
// technically-"localhost" URL that's actually a tunnel/proxy into a remote
// database (e.g. an SSH port-forward) still gets caught by whatever
// provider-looking string appears elsewhere in it.
const BLOCKED_REMOTE_INDICATORS = [
  "supabase.co",
  "pooler.supabase.com",
  "supabase",
  "render.com",
  "railway.app",
  "neon.tech",
  "aws-0-",
  "production",
  "prod",
];

export class TestDatabaseSafetyError extends Error {
  constructor(reason: string) {
    // Never interpolate the raw connection string or any credential into
    // this message — only short, structural reasons (a hostname, a db
    // name, a matched keyword). See the callers below for what's actually
    // passed in.
    super(`Chakusa test safety guard blocked destructive test database access: ${reason}`);
    this.name = "TestDatabaseSafetyError";
  }
}

/**
 * Throws TestDatabaseSafetyError unless ALL of the following hold:
 *   1. NODE_ENV is exactly "test"
 *   2. DATABASE_URL is set and is a parseable URL
 *   3. the URL's hostname is an explicitly allowed local host
 *   4. the URL's database name is exactly the approved test database
 *   5. the full URL contains no known remote/production indicator
 *
 * Call this at the top of every destructive test operation (resetDatabase,
 * any future bulk-delete/truncate helper) AND once at test-suite startup
 * (see vitest.config.ts's setupFiles) — startup protection catches a
 * misconfigured environment before any test body runs; the per-call guard
 * is the second, independent layer in case startup protection is ever
 * bypassed (a different test runner invocation, a helper called outside
 * the normal suite, etc.).
 */
export function assertDestructiveTestDatabaseAccessAllowed(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new TestDatabaseSafetyError(`NODE_ENV is "${process.env.NODE_ENV ?? "unset"}", not "test"`);
  }

  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new TestDatabaseSafetyError("DATABASE_URL is not set");
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TestDatabaseSafetyError("DATABASE_URL is not a parseable URL");
  }

  const host = url.hostname.toLowerCase();
  if (!ALLOWED_TEST_HOSTS.has(host)) {
    throw new TestDatabaseSafetyError(`database host "${host}" is not an approved local test host`);
  }

  const databaseName = url.pathname.replace(/^\//, "").toLowerCase();
  if (databaseName !== EXPECTED_TEST_DATABASE_NAME) {
    throw new TestDatabaseSafetyError(`database name "${databaseName}" is not the approved test database ("${EXPECTED_TEST_DATABASE_NAME}")`);
  }

  const lowerFullUrl = raw.toLowerCase();
  for (const indicator of BLOCKED_REMOTE_INDICATORS) {
    if (lowerFullUrl.includes(indicator)) {
      throw new TestDatabaseSafetyError(`DATABASE_URL contains a blocked remote/production indicator ("${indicator}")`);
    }
  }
}

/** Safe-to-log summary — host/db name only, never the raw URL or any credential. */
export function describeTestDatabaseTarget(): { environment: string | undefined; host: string | null; database: string | null; remote: boolean } {
  const raw = process.env.DATABASE_URL;
  if (!raw) return { environment: process.env.NODE_ENV, host: null, database: null, remote: true };
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    return {
      environment: process.env.NODE_ENV,
      host,
      database: url.pathname.replace(/^\//, ""),
      remote: !ALLOWED_TEST_HOSTS.has(host),
    };
  } catch {
    return { environment: process.env.NODE_ENV, host: null, database: null, remote: true };
  }
}
