#!/usr/bin/env node
// Runs a `prisma migrate ...` CLI command scoped to the local chakusa_test
// database, no matter what — including for schema/migration operations
// like `migrate resolve` and `migrate status`.
//
// Why this exists: the Prisma CLI reads DIRECT_URL (not DATABASE_URL) for
// migration/schema commands (see schema.prisma's datasource doc comment),
// and .env's DIRECT_URL points at production Supabase. Twice this session,
// running `npx prisma migrate resolve --applied ...` directly — even with
// DATABASE_URL exported in the shell — silently marked a migration
// "applied" against PRODUCTION's tracking table before its SQL had ever
// run there, because DIRECT_URL (still pointing at Supabase) is what the
// CLI actually consults. Recovering from that meant manually running the
// migration's real SQL against production to make the tracking table's
// claim true — see the git history for the two incidents this prevents.
//
// This script is the one safe way to run those commands from now on: it
// backs up .env, overwrites ONLY the DATABASE_URL/DIRECT_URL lines with the
// local chakusa_test URL, runs the command, and restores the original .env
// byte-for-byte in a `finally` — even if the command itself fails.
//
// Usage: node scripts/prisma-local.mjs migrate resolve --applied <name>
//        node scripts/prisma-local.mjs migrate status

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const LOCAL_TEST_URL = "postgresql://postgres:postgres@localhost:5432/chakusa_test?schema=public";
const ENV_PATH = ".env";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node scripts/prisma-local.mjs <prisma subcommand and args>");
  process.exit(1);
}

const original = readFileSync(ENV_PATH, "utf8");
const swapped = original
  .replace(/^DATABASE_URL=.*$/m, `DATABASE_URL="${LOCAL_TEST_URL}"`)
  .replace(/^DIRECT_URL=.*$/m, `DIRECT_URL="${LOCAL_TEST_URL}"`);

if (swapped === original) {
  console.error("Refusing to run: DATABASE_URL/DIRECT_URL lines not found in .env in the expected format.");
  process.exit(1);
}

writeFileSync(ENV_PATH, swapped);
try {
  // shell:true is required for `npx` to resolve reliably across platforms
  // (notably Windows' npx.cmd) via spawnSync. Safe here: every arg is a
  // literal CLI subcommand this script's own caller passes on the command
  // line, never untrusted/external input reaching this process.
  const result = spawnSync("npx", ["prisma", ...args], { stdio: "inherit", shell: true });
  process.exitCode = result.status ?? 1;
} finally {
  writeFileSync(ENV_PATH, original);
}
