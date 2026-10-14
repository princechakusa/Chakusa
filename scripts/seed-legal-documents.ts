import { PrismaClient } from "@prisma/client";
import { DEFAULT_LEGAL_DOCUMENTS } from "../src/modules/legal/defaultLegalDocuments.js";

/**
 * PROGRAM 2 LOOP 4 — one-off seed for the four legal documents.
 *
 * Nothing is published when the legal-acceptance tables are first migrated,
 * so `GET /legal/documents/:type` 404s until this runs. The HTTP admin API
 * needs an authenticated admin session (chicken-and-egg for a first seed),
 * so this writes v1 PUBLISHED rows directly via Prisma instead, following
 * the same pattern as prisma/seed.ts and scripts/bootstrap-admin.ts.
 *
 * Safety: mirrors scripts/prisma-local.mjs exactly — refuses to run unless
 * CHAKUSA_LOCAL_TEST_DATABASE_URL is a localhost `chakusa_test` URL, and
 * builds its own PrismaClient bound to that URL so an unrelated
 * DATABASE_URL in the environment can never be the target. Also requires an
 * explicit confirmation token as argv[2].
 *
 * Usage (PowerShell):
 *   $env:CHAKUSA_LOCAL_TEST_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/chakusa_test'
 *   npx tsx scripts/seed-legal-documents.ts --confirm-seed-local
 *
 * Idempotent: if a version already exists for a type, it is left untouched.
 *
 * The document text is ported verbatim from website/src/pages/{privacy,
 * terms,cookies,ai-disclosure}.astro as of 2026-09-01. It is a reviewed
 * engineering draft, not attorney-reviewed — the "not yet reviewed by a
 * licensed attorney" notice is part of the content on purpose and must
 * travel with it wherever it surfaces. The Terms "Governing law" section is
 * an intentional unfilled placeholder. The AI Disclosure's honest
 * statements about the ungated customer assistant and unredacted admin
 * transcript access are load-bearing — do not soften them.
 */

const CONFIRM_TOKEN = "--confirm-seed-local";

const localTestUrl = process.env.CHAKUSA_LOCAL_TEST_DATABASE_URL;
const confirmation = process.argv[2];

if (confirmation !== CONFIRM_TOKEN) {
  console.error(`Usage: npx tsx scripts/seed-legal-documents.ts ${CONFIRM_TOKEN}`);
  console.error("(and CHAKUSA_LOCAL_TEST_DATABASE_URL must point at the local chakusa_test database)");
  process.exit(1);
}
if (!localTestUrl) {
  console.error("Refusing to run: CHAKUSA_LOCAL_TEST_DATABASE_URL must be supplied by the process environment");
  process.exit(1);
}

let target: URL;
try {
  target = new URL(localTestUrl);
} catch {
  console.error("Refusing to run: CHAKUSA_LOCAL_TEST_DATABASE_URL is not a valid URL");
  process.exit(1);
}
const database = target.pathname.replace(/^\//, "").split("/")[0];
if (
  !(
    ["postgres:", "postgresql:"].includes(target.protocol) &&
    ["localhost", "127.0.0.1", "::1"].includes(target.hostname) &&
    database === "chakusa_test"
  )
) {
  console.error("Refusing to run: target must be the local chakusa_test PostgreSQL database");
  process.exit(1);
}

const DOCUMENTS = DEFAULT_LEGAL_DOCUMENTS;

const prisma = new PrismaClient({ datasources: { db: { url: localTestUrl } } });

async function main() {
  console.log(`[seed-legal-documents] target: ${target.hostname}/${database}`);
  const now = new Date();
  for (const doc of DOCUMENTS) {
    const existing = await prisma.legalDocumentVersion.findFirst({
      where: { type: doc.type },
      orderBy: { version: "desc" },
      select: { version: true, status: true },
    });
    if (existing) {
      console.log(`  skip  ${doc.type}: already has v${existing.version} (${existing.status})`);
      continue;
    }
    const created = await prisma.legalDocumentVersion.create({
      data: {
        type: doc.type,
        version: 1,
        status: "PUBLISHED",
        title: doc.title,
        content: doc.content,
        summary: doc.summary,
        effectiveAt: now,
        publishedAt: now,
      },
      select: { id: true, type: true, version: true },
    });
    console.log(`  publish ${created.type}: v${created.version} (${created.id})`);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
