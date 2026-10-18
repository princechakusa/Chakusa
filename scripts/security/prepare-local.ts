import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { assertLocalTestDatabaseTarget } from "../../src/lib/localTestDatabaseGuard.js";

assertLocalTestDatabaseTarget(process.env);
const database = new URL(process.env.DATABASE_URL!);
if (database.searchParams.get("schema") !== "security_http") throw new Error("Use the isolated security_http schema");
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
try {
  if (process.argv.includes("--cleanup")) {
    const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`SELECT tablename FROM pg_tables WHERE schemaname = 'security_http' AND tablename <> '_prisma_migrations'`;
    if (tables.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map(({ tablename }) => `"security_http"."${tablename.replaceAll('"', '""')}"`).join(", ")} CASCADE`);
    console.log("Isolated security_http fixtures removed");
  } else {
    const output = process.env.SECURITY_OUTPUT_DIR;
    if (!output) throw new Error("SECURITY_OUTPUT_DIR must point to a private evidence directory outside Git");
    const relativeOutput = relative(fileURLToPath(new URL("../../", import.meta.url)), resolve(output));
    if (!isAbsolute(output) || (!isAbsolute(relativeOutput) && relativeOutput !== ".." && !relativeOutput.startsWith(`..${sep}`))) throw new Error("Security credentials must be written outside the repository");
    const nonce = randomBytes(8).toString("hex");
    const values: Array<{ key: string; value: string; enabled: boolean }> = [{ key: "baseUrl", value: "http://127.0.0.1:4400", enabled: true }];
    for (const role of ["a", "b", "full", "restricted", "mfa"] as const) {
      const email = `${role}-${nonce}@security.example.test`;
      const password = randomBytes(24).toString("hex");
      const response = await fetch("http://127.0.0.1:4400/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, fullName: `Security ${role}`, businessName: `Security ${role}` }) });
      if (response.status !== 201) throw new Error(`Synthetic ${role} registration failed: ${response.status}`);
      const body = await response.json() as { user: { id: string }; business: { id: string }; accessToken: string; refreshToken: string };
      if (["full", "restricted", "mfa"].includes(role)) await prisma.adminMembership.create({ data: { userId: body.user.id, role: role === "restricted" ? "READ_ONLY" : "SUPER_ADMIN", mfaRequired: role === "mfa" } });
      for (const [key, value] of Object.entries({ [`${role}Email`]: email, [`${role}Password`]: password, [`${role}Token`]: body.accessToken, [`${role}Refresh`]: body.refreshToken, [`${role}Id`]: body.user.id, [`${role}BusinessId`]: body.business.id })) values.push({ key, value, enabled: true });
    }
    await mkdir(output, { recursive: true });
    await writeFile(resolve(output, "local.postman_environment.json"), JSON.stringify({ name: "Chakusa isolated security fixtures", values, _postman_variable_scope: "environment" }, null, 2));
    console.log("Five synthetic identities prepared in security_http; environment saved privately");
  }
} finally { await prisma.$disconnect(); }
