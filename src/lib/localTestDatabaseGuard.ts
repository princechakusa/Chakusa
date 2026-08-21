const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const TEST_DATABASE_NAME = "chakusa_test";

export class LocalTestDatabaseSafetyError extends Error {
  constructor(reason: string) {
    super(`Local test server refused to start: ${reason}`);
    this.name = "LocalTestDatabaseSafetyError";
  }
}

export interface LocalTestDatabaseTarget {
  host: string;
  database: string;
}

export function assertLocalTestDatabaseTarget(
  environment: { NODE_ENV?: string; DATABASE_URL?: string },
): LocalTestDatabaseTarget {
  if (environment.NODE_ENV !== "test") {
    throw new LocalTestDatabaseSafetyError('NODE_ENV must be "test"');
  }

  if (!environment.DATABASE_URL) {
    throw new LocalTestDatabaseSafetyError("DATABASE_URL is required");
  }

  let url: URL;
  try {
    url = new URL(environment.DATABASE_URL);
  } catch {
    throw new LocalTestDatabaseSafetyError("DATABASE_URL is invalid");
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!LOCAL_DATABASE_HOSTS.has(host)) {
    throw new LocalTestDatabaseSafetyError("database host is not local");
  }

  const database = url.pathname.replace(/^\//, "").toLowerCase();
  if (database !== TEST_DATABASE_NAME) {
    throw new LocalTestDatabaseSafetyError(`database name must be "${TEST_DATABASE_NAME}"`);
  }

  return { host, database };
}
