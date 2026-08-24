#!/usr/bin/env node
// Runs Prisma CLI commands only against a caller-supplied local test database.
// Credentials are never stored in this repository or rewritten into files.
//
// PowerShell example:
//   $env:CHAKUSA_LOCAL_TEST_DATABASE_URL = '<local test database URL>'
//   node scripts/prisma-local.mjs migrate status

import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const localTestUrl = process.env.CHAKUSA_LOCAL_TEST_DATABASE_URL;

if (args.length === 0) {
  console.error("Usage: node scripts/prisma-local.mjs <prisma subcommand and args>");
  process.exit(1);
}
if (!localTestUrl) {
  console.error("Refusing to run: CHAKUSA_LOCAL_TEST_DATABASE_URL must be supplied by the process environment");
  process.exit(1);
}

let target;
try {
  target = new URL(localTestUrl);
} catch {
  console.error("Refusing to run: CHAKUSA_LOCAL_TEST_DATABASE_URL is not a valid URL");
  process.exit(1);
}

const database = target.pathname.replace(/^\//, "").split("/")[0];
if (!(["postgres:", "postgresql:"].includes(target.protocol) && ["localhost", "127.0.0.1", "::1"].includes(target.hostname) && database === "chakusa_test")) {
  console.error("Refusing to run: target must be the local chakusa_test PostgreSQL database");
  process.exit(1);
}

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(command, ["prisma", ...args], {
  stdio: "inherit",
  shell: false,
  env: { ...process.env, NODE_ENV: "test", DATABASE_URL: localTestUrl, DIRECT_URL: localTestUrl },
});

if (result.error) {
  console.error("Prisma command failed to start");
  process.exit(1);
}
process.exitCode = result.status ?? 1;
