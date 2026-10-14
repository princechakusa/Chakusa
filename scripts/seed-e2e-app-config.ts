import { PrismaClient } from "@prisma/client";
import { assertLocalTestDatabaseTarget } from "../src/lib/localTestDatabaseGuard.js";

/**
 * Turns on the runtime app settings the Expo web E2E suite needs, on the
 * local throwaway `chakusa_test` database only.
 *
 * The apps take `features.emailAuth` and `features.automation` from the API's
 * /app-config, and those override the web build's EXPO_PUBLIC_* values. Both
 * default to off, so on a fresh test database the sign-in screens showed no
 * email form and every E2E sign-up failed.
 *
 *   $env:CHAKUSA_LOCAL_TEST_DATABASE_URL = 'postgresql://...@localhost:5434/chakusa_test'
 *   npx tsx scripts/seed-e2e-app-config.ts --confirm-seed-local
 */

const CONFIRM_TOKEN = "--confirm-seed-local";
const SETTINGS = ["app.email_auth_enabled", "app.automation_enabled"] as const;

if (process.argv[2] !== CONFIRM_TOKEN) {
  console.error(`Usage: npx tsx scripts/seed-e2e-app-config.ts ${CONFIRM_TOKEN}`);
  process.exit(1);
}
const url = process.env.CHAKUSA_LOCAL_TEST_DATABASE_URL;
let target: { host: string; database: string };
try {
  target = assertLocalTestDatabaseTarget({ NODE_ENV: "test", DATABASE_URL: url });
} catch (error) {
  console.error(error instanceof Error ? error.message.replace("Local test server", "E2E app-config seed") : "Refusing to run");
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url } } });

async function main() {
  console.log(`[seed-e2e-app-config] target: ${target.host}/${target.database}`);
  for (const key of SETTINGS) {
    await prisma.platformSetting.upsert({ where: { key }, create: { key, value: true }, update: { value: true } });
    console.log(`  on  ${key}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
