import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { createTestApp, resetDatabase, registerAccount } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

// PROGRAM 3 LOOP 3A: schema-level invariant tests. No routes exist yet —
// these exercise the Prisma models directly, the same way
// tests/entitlements.test.ts exercises prisma.subscription directly
// alongside its route-level tests.

async function seedMember(app: FastifyInstance) {
  const account = await registerAccount(app);
  const member = await prisma.businessMember.findFirstOrThrow({ where: { businessId: account.businessId, userId: account.userId } });
  return { ...account, memberId: member.id };
}

async function seedDocument(businessId: string, memberId: string, documentNumber = "Q-2026-0001") {
  return prisma.quoteDocument.create({
    data: {
      businessId,
      createdByMemberId: memberId,
      documentType: "QUOTE",
      documentNumber,
      currency: "USD",
      status: "DRAFT",
    },
  });
}

async function seedRevision(quoteDocumentId: string, memberId: string, revisionNumber = 1) {
  return prisma.quoteRevision.create({
    data: {
      quoteDocumentId,
      revisionNumber,
      subtotal: new Prisma.Decimal("10.00"),
      total: new Prisma.Decimal("10.00"),
      createdByMemberId: memberId,
    },
  });
}

describe("Quotes & Estimates schema invariants", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("creates a DRAFT document with server defaults", async () => {
    const { businessId, memberId } = await seedMember(app);
    const document = await seedDocument(businessId, memberId);
    expect(document.status).toBe("DRAFT");
    expect(document.nextRevisionNumber).toBe(1);
    expect(document.currentRevisionId).toBeNull();
    expect(document.acceptedRevisionId).toBeNull();
  });

  it("rejects a duplicate document number within the same business and document type", async () => {
    const { businessId, memberId } = await seedMember(app);
    await seedDocument(businessId, memberId, "Q-2026-0001");
    await expect(seedDocument(businessId, memberId, "Q-2026-0001")).rejects.toMatchObject({ code: "P2002" });
  });

  it("allows the same document number across different businesses", async () => {
    const a = await seedMember(app);
    const b = await seedMember(app);
    await expect(seedDocument(a.businessId, a.memberId, "Q-2026-0001")).resolves.toBeTruthy();
    await expect(seedDocument(b.businessId, b.memberId, "Q-2026-0001")).resolves.toBeTruthy();
  });

  it("allows the same counter number to be reused across ESTIMATE and QUOTE (separate sequences)", async () => {
    const { businessId, memberId } = await seedMember(app);
    await expect(
      prisma.quoteDocument.create({ data: { businessId, createdByMemberId: memberId, documentType: "QUOTE", documentNumber: "0001", currency: "USD" } }),
    ).resolves.toBeTruthy();
    await expect(
      prisma.quoteDocument.create({ data: { businessId, createdByMemberId: memberId, documentType: "ESTIMATE", documentNumber: "0001", currency: "USD" } }),
    ).resolves.toBeTruthy();
  });

  it("rejects a duplicate revision number within the same document", async () => {
    const { businessId, memberId } = await seedMember(app);
    const document = await seedDocument(businessId, memberId);
    await seedRevision(document.id, memberId, 1);
    await expect(seedRevision(document.id, memberId, 1)).rejects.toMatchObject({ code: "P2002" });
  });

  it("allows revision number 1 to repeat across different documents", async () => {
    const { businessId, memberId } = await seedMember(app);
    const docA = await seedDocument(businessId, memberId, "Q-2026-0001");
    const docB = await seedDocument(businessId, memberId, "Q-2026-0002");
    await expect(seedRevision(docA.id, memberId, 1)).resolves.toBeTruthy();
    await expect(seedRevision(docB.id, memberId, 1)).resolves.toBeTruthy();
  });

  it("lets a document point its currentRevisionId at its OWN revision", async () => {
    const { businessId, memberId } = await seedMember(app);
    const document = await seedDocument(businessId, memberId);
    const revision = await seedRevision(document.id, memberId, 1);
    await expect(
      prisma.quoteDocument.update({ where: { id: document.id }, data: { status: "SENT", currentRevisionId: revision.id } }),
    ).resolves.toBeTruthy();
  });

  it("REJECTS a document pointing currentRevisionId at a revision belonging to a DIFFERENT document (composite FK)", async () => {
    const { businessId, memberId } = await seedMember(app);
    const docA = await seedDocument(businessId, memberId, "Q-2026-0001");
    const docB = await seedDocument(businessId, memberId, "Q-2026-0002");
    const revisionOfB = await seedRevision(docB.id, memberId, 1);

    await expect(
      prisma.quoteDocument.update({ where: { id: docA.id }, data: { status: "SENT", currentRevisionId: revisionOfB.id } }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("REJECTS a document pointing acceptedRevisionId at a revision belonging to a DIFFERENT document (composite FK)", async () => {
    const { businessId, memberId } = await seedMember(app);
    const docA = await seedDocument(businessId, memberId, "Q-2026-0001");
    const docB = await seedDocument(businessId, memberId, "Q-2026-0002");
    const revisionOfB = await seedRevision(docB.id, memberId, 1);

    await expect(
      prisma.quoteDocument.update({ where: { id: docA.id }, data: { status: "ACCEPTED", acceptedRevisionId: revisionOfB.id } }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("enforces the accepted-revision CHECK constraint: ACCEPTED requires acceptedRevisionId", async () => {
    const { businessId, memberId } = await seedMember(app);
    const document = await seedDocument(businessId, memberId);
    await seedRevision(document.id, memberId, 1);
    await expect(
      prisma.quoteDocument.update({ where: { id: document.id }, data: { status: "ACCEPTED" } }),
    ).rejects.toBeTruthy();
  });

  it("enforces the accepted-revision CHECK constraint: a non-ACCEPTED status cannot carry acceptedRevisionId", async () => {
    const { businessId, memberId } = await seedMember(app);
    const document = await seedDocument(businessId, memberId);
    const revision = await seedRevision(document.id, memberId, 1);
    await expect(
      prisma.quoteDocument.update({ where: { id: document.id }, data: { status: "SENT", acceptedRevisionId: revision.id } }),
    ).rejects.toBeTruthy();
  });

  it("allows the correct ACCEPTED shape: status=ACCEPTED with acceptedRevisionId pointing at the document's own revision", async () => {
    const { businessId, memberId } = await seedMember(app);
    const document = await seedDocument(businessId, memberId);
    const revision = await seedRevision(document.id, memberId, 1);
    await prisma.quoteDocument.update({ where: { id: document.id }, data: { currentRevisionId: revision.id, status: "SENT" } });
    const accepted = await prisma.quoteDocument.update({
      where: { id: document.id },
      data: { status: "ACCEPTED", acceptedRevisionId: revision.id },
    });
    expect(accepted.status).toBe("ACCEPTED");
    expect(accepted.acceptedRevisionId).toBe(revision.id);
  });

  it("preserves the QuoteDocument when its referenced Customer is deleted (SetNull)", async () => {
    const { businessId, memberId } = await seedMember(app);
    const customer = await prisma.customer.create({ data: { businessId, name: "Someone" } });
    const document = await prisma.quoteDocument.create({
      data: { businessId, createdByMemberId: memberId, documentType: "QUOTE", documentNumber: "Q-2026-0099", currency: "USD", customerId: customer.id },
    });
    await prisma.customer.delete({ where: { id: customer.id } });
    const survived = await prisma.quoteDocument.findUniqueOrThrow({ where: { id: document.id } });
    expect(survived.customerId).toBeNull();
  });

  it("preserves the QuoteDocument when its referenced Lead is deleted (SetNull)", async () => {
    const { businessId, memberId } = await seedMember(app);
    const lead = await prisma.lead.create({ data: { businessId } });
    const document = await prisma.quoteDocument.create({
      data: { businessId, createdByMemberId: memberId, documentType: "QUOTE", documentNumber: "Q-2026-0098", currency: "USD", leadId: lead.id },
    });
    await prisma.lead.delete({ where: { id: lead.id } });
    const survived = await prisma.quoteDocument.findUniqueOrThrow({ where: { id: document.id } });
    expect(survived.leadId).toBeNull();
  });

  it("preserves the QuoteLineItem when its referenced ServiceOffering is deleted (SetNull), snapshot untouched", async () => {
    const { businessId, memberId } = await seedMember(app);
    const service = await prisma.serviceOffering.create({ data: { businessId, name: "Haircut", durationMinutes: 30, price: new Prisma.Decimal("25.00") } });
    const document = await seedDocument(businessId, memberId, "Q-2026-0097");
    const revision = await seedRevision(document.id, memberId, 1);
    const lineItem = await prisma.quoteLineItem.create({
      data: {
        quoteRevisionId: revision.id,
        serviceOfferingId: service.id,
        description: "Haircut",
        quantity: new Prisma.Decimal("1"),
        unitPrice: new Prisma.Decimal("25.00"),
        lineTotal: new Prisma.Decimal("25.00"),
      },
    });
    // Change the live service price — the historical line item must not change.
    await prisma.serviceOffering.update({ where: { id: service.id }, data: { price: new Prisma.Decimal("99.00") } });
    await prisma.serviceOffering.delete({ where: { id: service.id } });
    const survived = await prisma.quoteLineItem.findUniqueOrThrow({ where: { id: lineItem.id } });
    expect(survived.serviceOfferingId).toBeNull();
    expect(survived.unitPrice.toFixed(2)).toBe("25.00");
  });

  it("REJECTS deleting a BusinessMember who authored a QuoteDocument (Restrict)", async () => {
    const { businessId, memberId } = await seedMember(app);
    await seedDocument(businessId, memberId);
    await expect(prisma.businessMember.delete({ where: { id: memberId } })).rejects.toBeTruthy();
  });

  it("cascades QuoteRevision/QuoteLineItem/QuoteAcceptanceToken/QuoteEvent deletion when the QuoteDocument is deleted", async () => {
    const { businessId, memberId } = await seedMember(app);
    const document = await seedDocument(businessId, memberId, "Q-2026-0096");
    const revision = await seedRevision(document.id, memberId, 1);
    await prisma.quoteLineItem.create({
      data: { quoteRevisionId: revision.id, description: "Item", quantity: new Prisma.Decimal("1"), unitPrice: new Prisma.Decimal("1"), lineTotal: new Prisma.Decimal("1") },
    });
    await prisma.quoteAcceptanceToken.create({ data: { quoteRevisionId: revision.id, tokenHash: "hash-1", expiresAt: new Date(Date.now() + 86_400_000) } });
    await prisma.quoteEvent.create({ data: { quoteDocumentId: document.id, quoteRevisionId: revision.id, eventType: "CREATED", actorType: "BUSINESS_MEMBER", actorId: memberId } });

    await prisma.quoteDocument.delete({ where: { id: document.id } });

    expect(await prisma.quoteRevision.findUnique({ where: { id: revision.id } })).toBeNull();
    expect(await prisma.quoteLineItem.count({ where: { quoteRevisionId: revision.id } })).toBe(0);
    expect(await prisma.quoteAcceptanceToken.count({ where: { quoteRevisionId: revision.id } })).toBe(0);
    expect(await prisma.quoteEvent.count({ where: { quoteDocumentId: document.id } })).toBe(0);
  });

  it("never stores a raw acceptance token — only a hash", async () => {
    const { businessId, memberId } = await seedMember(app);
    const document = await seedDocument(businessId, memberId);
    const revision = await seedRevision(document.id, memberId, 1);
    const token = await prisma.quoteAcceptanceToken.create({
      data: { quoteRevisionId: revision.id, tokenHash: "a".repeat(64), expiresAt: new Date(Date.now() + 3_600_000) },
    });
    expect(Object.keys(token)).not.toContain("token");
    expect(Object.keys(token)).not.toContain("rawToken");
  });
});

describe("CommercialDocumentCounter", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("enforces uniqueness per (business, documentType, year)", async () => {
    const { businessId } = await seedMember(app);
    await prisma.commercialDocumentCounter.create({ data: { businessId, documentType: "QUOTE", year: 2026 } });
    await expect(prisma.commercialDocumentCounter.create({ data: { businessId, documentType: "QUOTE", year: 2026 } })).rejects.toMatchObject({ code: "P2002" });
  });

  it("allocates atomically via an increment-and-return update, safe under concurrent callers", async () => {
    const { businessId } = await seedMember(app);
    const counter = await prisma.commercialDocumentCounter.create({ data: { businessId, documentType: "QUOTE", year: 2026 } });

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        prisma.commercialDocumentCounter.update({ where: { id: counter.id }, data: { nextValue: { increment: 1 } } }),
      ),
    );
    const allocatedValues = results.map((r) => r.nextValue).sort((a, b) => a - b);
    // Started at 1, ten concurrent increments -> values 2..11, all unique.
    expect(new Set(allocatedValues).size).toBe(10);
    expect(allocatedValues).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });
});
