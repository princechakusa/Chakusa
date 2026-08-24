import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { assertLocalTestDatabaseTarget } from "../src/lib/localTestDatabaseGuard.js";

if (!process.env.DATABASE_URL) {
  console.error("Local test server refused to start: DATABASE_URL must be supplied by the process environment");
  process.exit(1);
}

const target = assertLocalTestDatabaseTarget(process.env);

// Set every integration flag explicitly so a developer's process environment
// cannot accidentally enable remote integrations against the local database.
const childEnvironment: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: "test",
  DATABASE_URL: process.env.DATABASE_URL,
  DIRECT_URL: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  JWT_SECRET: randomBytes(32).toString("hex"),
  EMAIL_ENABLED: "false",
  GOOGLE_AUTH_ENABLED: "false",
  APPLE_AUTH_ENABLED: "false",
  TWILIO_ENABLED: "false",
  APPLE_BILLING_ENABLED: "false",
  GOOGLE_BILLING_ENABLED: "false",
  SENTRY_ENABLED: "false",
  ADMIN_CONSOLE_ENABLED: "true",
  ADMIN_CONSOLE_ORIGIN: "http://localhost:5173",
};

console.log("NODE_ENV=test");
console.log(`DATABASE_TARGET=${target.host}/${target.database}`);

const server = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
  cwd: process.cwd(),
  env: childEnvironment,
  stdio: "inherit",
});

server.on("error", () => {
  console.error("Local test server failed to start");
  process.exitCode = 1;
});

server.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.kill(signal));
}
