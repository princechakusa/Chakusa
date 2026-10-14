import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { DEFAULT_LEGAL_DOCUMENTS, ensureDefaultLegalDocuments } from "../src/modules/legal/defaultLegalDocuments.js";
import { resetDatabase } from "./helpers.js";

describe("default legal documents published at server start", () => {
  beforeEach(async () => { await resetDatabase(); });
  afterEach(async () => { await resetDatabase(); });
  afterAll(async () => { await prisma.$disconnect(); });

  it("publishes v1 of every missing type, once, with no draft notice", async () => {
    expect(await ensureDefaultLegalDocuments(prisma)).toEqual(DEFAULT_LEGAL_DOCUMENTS.map((doc) => doc.type));
    expect(await ensureDefaultLegalDocuments(prisma)).toEqual([]);
    const rows = await prisma.legalDocumentVersion.findMany({ orderBy: { type: "asc" } });
    expect(rows).toHaveLength(DEFAULT_LEGAL_DOCUMENTS.length);
    for (const row of rows) {
      expect(row).toMatchObject({ version: 1, status: "PUBLISHED" });
      expect(row.content).not.toMatch(/Not yet reviewed|Do not publish as final/);
    }
  });

  it("never touches a type that already has a version", async () => {
    const now = new Date();
    await prisma.legalDocumentVersion.create({ data: { type: "TERMS_OF_SERVICE", version: 3, status: "PUBLISHED", title: "Owner terms", content: "Owner-published text", effectiveAt: now, publishedAt: now } });
    const published = await ensureDefaultLegalDocuments(prisma);
    expect(published).not.toContain("TERMS_OF_SERVICE");
    const terms = await prisma.legalDocumentVersion.findMany({ where: { type: "TERMS_OF_SERVICE" } });
    expect(terms).toHaveLength(1);
    expect(terms[0]).toMatchObject({ version: 3, content: "Owner-published text" });
  });
});
