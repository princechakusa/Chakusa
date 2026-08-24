import { spawn } from "node:child_process";
import { config as loadEnvironment } from "dotenv";
import { assertLocalTestDatabaseTarget } from "../src/lib/localTestDatabaseGuard.js";

const loaded = loadEnvironment({ path: ".env.test", override: true });
if (loaded.error) {
  console.error("Local test server refused to start: .env.test could not be loaded");
  process.exit(1);
}

const target = assertLocalTestDatabaseTarget(process.env);

// Set every integration flag explicitly so dotenv/config in the real server
// cannot inherit an enabled remote integration from the normal .env file.
const childEnvironment: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: "test",
  DATABASE_URL: process.env.DATABASE_URL,
  DIRECT_URL: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  JWT_SECRET: "chakusa-local-test-server-only-secret",
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
