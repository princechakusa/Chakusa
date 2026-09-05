import { Prisma, type QuoteDocumentType } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { config } from "../../lib/config.js";
import { generateOpaqueToken } from "../../lib/authTokens.js";
import { withLimitCheck } from "../../lib/entitlements.js";
import { assertLegalQuoteTransition, calculateQuoteTotals, canSendQuote, formatDocumentNumber } from "../../lib/quotes/quotes.domain.js";
import type { QuoteLineItemInput, QuoteTotals } from "../../lib/quotes/quotes.types.js";
import type { CreateQuoteInput, ListQuotesQuery, SendQuoteInput, UpdateQuoteInput } from "./quotes.schemas.js";

// PROGRAM 3 LOOP 3B: BUSINESS-side draft + read service for Quotes &
// Estimates. Every function takes a server-resolved `businessId` (from
// requireBusiness — never a client value) and a server-resolved
// `createdByMemberId`. Only DRAFT documents are ever created, edited, or
// deleted here. All money is computed by the approved Loop 3A domain
// layer (calculateQuoteTotals) — a client-supplied total is never
// persisted.
//
// DRAFT-content versioning vs. the SENT->SENT "REVISE" lifecycle action:
// editing a DRAFT's commercial content creates a NEW immutable
// QuoteRevision and repoints QuoteDocument.currentRevisionId, exactly
// because Loop 3A made QuoteRevision/QuoteLineItem immutable — we never
// UPDATE an existing revision or line item. The document stays in DRAFT
// status throughout. This is storage-model versioning, NOT the lifecycle
// REVISE action (which only applies to a SENT document and is a later
// loop's concern).

const ZERO_TOTALS: QuoteTotals = {
  lineItems: [],
  subtotal: "0.00",
  discountTotal: "0.00",
  taxTotal: "0.00",
  total: "0.00",
};

const REVISION_SELECT = {
  id: true,
  revisionNumber: true,
  subtotal: true,
  taxTotal: true,
  discountTotal: true,
  total: true,
  notes: true,
  terms: true,
  createdAt: true,
  createdByMemberId: true,
  lineItems: {
    orderBy: { sortOrder: "asc" as const },
    select: {
      id: true,
      serviceOfferingId: true,
      description: true,
      quantity: true,
      unitPrice: true,
      discountAmount: true,
      taxable: true,
      lineTotal: true,
      sortOrder: true,
    },
  },
};

// ---------------------------------------------------------------------------
// Origin / line-item ownership validation — every referenced id is checked
// against the authenticated business before anything is persisted. A
// foreign or nonexistent id returns the SAME 404 either way, so an
// attacker cannot probe whether another tenant's record exists.
// ---------------------------------------------------------------------------

async function assertOriginsInBusiness(businessId: string, input: { leadId?: string | null; customerId?: string | null; customerProfileId?: string | null; appointmentId?: string | null }) {
  if (input.leadId) {
    const lead = await prisma.lead.findFirst({ where: { id: input.leadId, businessId }, select: { id: true } });
    if (!lead) throw ApiError.notFound("Lead not found");
  }
  if (input.customerId) {
    const customer = await prisma.customer.findFirst({ where: { id: input.customerId, businessId }, select: { id: true } });
    if (!customer) throw ApiError.notFound("Customer not found");
  }
  if (input.appointmentId) {
    const appointment = await prisma.appointment.findFirst({ where: { id: input.appointmentId, businessId }, select: { id: true } });
    if (!appointment) throw ApiError.notFound("Appointment not found");
  }
  if (input.customerProfileId) {
    // A CustomerProfile is a customer-app account, not a business-owned
    // row — the legitimate link is a CustomerBusinessLink between that
    // profile and this business.
    const link = await prisma.customerBusinessLink.findFirst({ where: { customerProfileId: input.customerProfileId, businessId }, select: { id: true } });
    if (!link) throw ApiError.notFound("Customer not found");
  }
}

async function assertServiceOfferingsInBusiness(businessId: string, lineItems: ReadonlyArray<{ serviceOfferingId?: string | null }>) {
  const ids = [...new Set(lineItems.map((l) => l.serviceOfferingId).filter((v): v is string => Boolean(v)))];
  if (!ids.length) return;
  const found = await prisma.serviceOffering.findMany({ where: { id: { in: ids }, businessId }, select: { id: true } });
  if (found.length !== ids.length) throw ApiError.notFound("Service not found");
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

function computeTotals(input: { lineItems?: ReadonlyArray<{ quantity: number | string; unitPrice: number | string; discountAmount?: number | string; taxable?: boolean }>; taxRatePercent?: number | string }): QuoteTotals {
  const lineItems = input.lineItems ?? [];
  // A DRAFT is explicitly allowed to have zero line items — that yields
  // all-zero totals here WITHOUT calling calculateQuoteTotals (which
  // correctly still rejects an empty list, because it models a
  // calculable/sendable revision — canSendQuote stays strict).
  if (!lineItems.length) return ZERO_TOTALS;
  return calculateQuoteTotals({
    lineItems: lineItems.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discountAmount: l.discountAmount, taxable: l.taxable })),
    taxRatePercent: input.taxRatePercent,
  });
}

// ---------------------------------------------------------------------------
// Document-number allocation — server-side, transaction-safe, per
// (business, documentType, year). CommercialDocumentCounter.nextValue is
// "the next number to hand out": a fresh counter starts at 1, so the first
// allocated QUOTE number is Q-<year>-0001. The Prisma `increment` update
// returns the POST-increment value, so the number just allocated is
// `returned - 1`. QUOTE and ESTIMATE keep independent sequences via the
// counter's (businessId, documentType, year) unique key.
// ---------------------------------------------------------------------------

async function allocateNextCounterValue(tx: Prisma.TransactionClient, businessId: string, documentType: QuoteDocumentType, year: number): Promise<number> {
  const key = { businessId_documentType_year: { businessId, documentType, year } };
  try {
    const updated = await tx.commercialDocumentCounter.update({ where: key, data: { nextValue: { increment: 1 } } });
    return updated.nextValue - 1;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      try {
        await tx.commercialDocumentCounter.create({ data: { businessId, documentType, year, nextValue: 2 } });
        return 1;
      } catch (createError) {
        if (createError instanceof Prisma.PrismaClientKnownRequestError && createError.code === "P2002") {
          const updated = await tx.commercialDocumentCounter.update({ where: key, data: { nextValue: { increment: 1 } } });
          return updated.nextValue - 1;
        }
        throw createError;
      }
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Create draft
// ---------------------------------------------------------------------------

export async function createQuoteDraft(businessId: string, createdByMemberId: string, input: CreateQuoteInput) {
  await assertOriginsInBusiness(businessId, input);
  if (input.lineItems?.length) await assertServiceOfferingsInBusiness(businessId, input.lineItems);

  const totals = computeTotals(input);

  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { currency: true } });
  const currency = (business?.currency ?? "USD").toUpperCase();
  const year = new Date().getUTCFullYear();

  const documentId = await withLimitCheck(async (tx) => {
    const counterValue = await allocateNextCounterValue(tx, businessId, input.documentType, year);
    const documentNumber = formatDocumentNumber({ documentType: input.documentType, year, counterValue });

    const document = await tx.quoteDocument.create({
      data: {
        businessId,
        createdByMemberId,
        documentType: input.documentType,
        documentNumber,
        currency,
        status: "DRAFT",
        // nextRevisionNumber defaults to 1; we consume it here for revision
        // #1 and bump to 2 in the same transaction.
        nextRevisionNumber: 2,
        leadId: input.leadId ?? null,
        customerId: input.customerId ?? null,
        customerProfileId: input.customerProfileId ?? null,
        appointmentId: input.appointmentId ?? null,
        expiresAt: input.expiresAt ?? null,
      },
    });

    const revision = await createRevision(tx, document.id, 1, createdByMemberId, input, totals);
    await tx.quoteDocument.update({ where: { id: document.id }, data: { currentRevisionId: revision.id } });
    await tx.quoteEvent.create({
      data: { quoteDocumentId: document.id, quoteRevisionId: revision.id, eventType: "CREATED", actorType: "BUSINESS_MEMBER", actorId: createdByMemberId },
    });
    return document.id;
  });

  return getQuoteDetail(businessId, documentId);
}

async function createRevision(
  tx: Prisma.TransactionClient,
  quoteDocumentId: string,
  revisionNumber: number,
  createdByMemberId: string,
  content: { notes?: string | null; terms?: string | null; lineItems?: ReadonlyArray<{ serviceOfferingId?: string | null; description: string; quantity: number | string; unitPrice: number | string; discountAmount?: number | string; taxable?: boolean; sortOrder?: number }> },
  totals: QuoteTotals,
) {
  const lineItems = content.lineItems ?? [];
  return tx.quoteRevision.create({
    data: {
      quoteDocumentId,
      revisionNumber,
      subtotal: new Prisma.Decimal(totals.subtotal),
      taxTotal: new Prisma.Decimal(totals.taxTotal),
      discountTotal: new Prisma.Decimal(totals.discountTotal),
      total: new Prisma.Decimal(totals.total),
      notes: content.notes ?? null,
      terms: content.terms ?? null,
      createdByMemberId,
      lineItems: {
        create: lineItems.map((line, index) => {
          const computed = totals.lineItems[index]!;
          return {
            serviceOfferingId: line.serviceOfferingId ?? null,
            description: line.description,
            quantity: new Prisma.Decimal(computed.quantity),
            unitPrice: new Prisma.Decimal(computed.unitPrice),
            discountAmount: new Prisma.Decimal(computed.discountAmount),
            taxable: computed.taxable,
            lineTotal: new Prisma.Decimal(computed.lineTotal),
            sortOrder: line.sortOrder ?? index,
          };
        }),
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Edit draft — new immutable revision, DRAFT-only, optimistic-concurrency
// guarded. The old revision + its line items are never touched.
// ---------------------------------------------------------------------------

export async function updateQuoteDraft(businessId: string, actorMemberId: string, documentId: string, input: UpdateQuoteInput) {
  await assertOriginsInBusiness(businessId, input);
  if (input.lineItems?.length) await assertServiceOfferingsInBusiness(businessId, input.lineItems);

  const totals = computeTotals(input);

  await withLimitCheck(async (tx) => {
    const document = await tx.quoteDocument.findFirst({
      where: { id: documentId, businessId },
      select: { id: true, status: true, currentRevisionId: true, nextRevisionNumber: true },
    });
    if (!document) throw ApiError.notFound("Quote not found");
    if (document.status !== "DRAFT") throw ApiError.conflict("Only draft documents can be edited");
    if (document.currentRevisionId !== input.expectedCurrentRevisionId) {
      throw ApiError.conflict("This draft has changed since you loaded it — reload and try again");
    }

    const revision = await createRevision(tx, document.id, document.nextRevisionNumber, actorMemberId, input, totals);

    // Conditional update: only advances if the document is still a DRAFT
    // whose current revision is exactly the one the caller expected. A
    // concurrent edit that already advanced currentRevisionId makes this
    // match zero rows -> serialization retry re-reads and fails the guard
    // above.
    const advanced = await tx.quoteDocument.updateMany({
      where: { id: document.id, businessId, status: "DRAFT", currentRevisionId: input.expectedCurrentRevisionId },
      data: {
        currentRevisionId: revision.id,
        nextRevisionNumber: { increment: 1 },
        leadId: input.leadId ?? null,
        customerId: input.customerId ?? null,
        customerProfileId: input.customerProfileId ?? null,
        appointmentId: input.appointmentId ?? null,
        expiresAt: input.expiresAt ?? null,
      },
    });
    if (advanced.count !== 1) {
      throw ApiError.conflict("This draft has changed since you loaded it — reload and try again");
    }
  });

  return getQuoteDetail(businessId, documentId);
}

// ---------------------------------------------------------------------------
// Delete draft — DRAFT-only, race-guarded. Cascade removes revisions /
// line items / events / acceptance tokens.
// ---------------------------------------------------------------------------

export async function deleteQuoteDraft(businessId: string, documentId: string) {
  await withLimitCheck(async (tx) => {
    const deleted = await tx.quoteDocument.deleteMany({ where: { id: documentId, businessId, status: "DRAFT" } });
    if (deleted.count === 1) return;
    // Distinguish "not a draft" (409) from "not yours / doesn't exist"
    // (404) — but never reveal that a row exists under another tenant.
    const existing = await tx.quoteDocument.findFirst({ where: { id: documentId, businessId }, select: { status: true } });
    if (existing) throw ApiError.conflict("Only draft documents can be deleted");
    throw ApiError.notFound("Quote not found");
  });
}

// ---------------------------------------------------------------------------
// Send (DRAFT -> SENT) + secure acceptance-token issuance — PROGRAM 3 LOOP 3C
//
// The whole operation is one atomic Serializable transaction:
//   validate DRAFT + current revision
//     -> conditional DRAFT->SENT transition (single-winner)
//     -> create exactly one hashed, revision-bound acceptance token
//     -> record exactly one SENT QuoteEvent
// If any step fails the transaction rolls back entirely: no SENT document
// without its token and event, no orphan token, no second raw token.
//
// The revision that is current at the instant the transition commits IS
// the sent commercial snapshot. Nothing here edits, duplicates or
// recomputes a revision, or touches currency / documentNumber /
// line items.
//
// Only the SHA-256 hash of the bearer token is persisted (authTokens.ts
// primitive, same as PublicBookingAccess). The raw token is returned once
// from this call and never stored or logged.
// ---------------------------------------------------------------------------

function resolveAcceptanceTokenExpiry(documentExpiresAt: Date | null, now: Date): Date {
  const ttlDays = config.QUOTE_ACCEPTANCE_TOKEN_TTL_DAYS;
  const ttlExpiry = new Date(now.getTime() + ttlDays * 86_400_000);
  // A bearer token must never outlive the commercial document it
  // authorizes. When the quote has no explicit commercial expiry, fall
  // back to the bounded default (never a permanent token).
  if (documentExpiresAt && documentExpiresAt.getTime() < ttlExpiry.getTime()) {
    return documentExpiresAt;
  }
  return ttlExpiry;
}

export async function sendQuote(businessId: string, actorMemberId: string, documentId: string, input: SendQuoteInput) {
  const rawToken = await withLimitCheck(async (tx) => {
    const document = await tx.quoteDocument.findFirst({
      where: { id: documentId, businessId },
      select: {
        id: true,
        status: true,
        currentRevisionId: true,
        expiresAt: true,
        currentRevision: {
          select: {
            id: true,
            lineItems: { select: { quantity: true, unitPrice: true, discountAmount: true, taxable: true } },
          },
        },
      },
    });
    // Cross-tenant / missing both surface as the same 404 — no existence leak.
    if (!document) throw ApiError.notFound("Quote not found");

    // Single lifecycle authority — throws ApiError.conflict (409) for any
    // non-DRAFT status (SENT/ACCEPTED/DECLINED/CANCELED/EXPIRED).
    assertLegalQuoteTransition(document.status, "SEND");

    if (!document.currentRevisionId || !document.currentRevision) {
      // A DRAFT always has a current revision (set at creation); treat the
      // impossible case as a conflict rather than a 500.
      throw ApiError.conflict("This quote has no current revision to send");
    }
    if (input.expectedCurrentRevisionId && input.expectedCurrentRevisionId !== document.currentRevisionId) {
      throw ApiError.conflict("This quote has changed since you loaded it — reload and try again");
    }

    // Reuse the domain send-eligibility gate (rejects zero-line documents
    // and malformed line items). Its recomputed totals are intentionally
    // discarded: the persisted immutable revision totals are authoritative.
    const lineItems: QuoteLineItemInput[] = document.currentRevision.lineItems.map((li) => ({
      quantity: li.quantity.toFixed(2),
      unitPrice: li.unitPrice.toFixed(2),
      discountAmount: li.discountAmount.toFixed(2),
      taxable: li.taxable,
    }));
    const eligibility = canSendQuote({ status: document.status, lineItems });
    if (!eligibility.ok) throw ApiError.badRequest(eligibility.reason);

    const now = new Date();
    const token = generateOpaqueToken();
    const tokenExpiresAt = resolveAcceptanceTokenExpiry(document.expiresAt, now);

    // Single-winner transition: matches exactly the DRAFT row whose
    // current revision is the one just validated. A concurrent send that
    // already flipped it to SENT, a concurrent edit that advanced
    // currentRevisionId, or a concurrent delete all make this match zero
    // rows -> the losing request creates no token and no event.
    const transitioned = await tx.quoteDocument.updateMany({
      where: { id: document.id, businessId, status: "DRAFT", currentRevisionId: document.currentRevisionId },
      data: { status: "SENT" },
    });
    if (transitioned.count !== 1) {
      throw ApiError.conflict("This quote has changed since you loaded it — reload and try again");
    }

    await tx.quoteAcceptanceToken.create({
      data: {
        // Store the token id as the row PK (mirrors PublicBookingAccess) so
        // a future public lookup can parse the id from the raw bearer,
        // fetch by id, then constant-time compare the hash.
        id: token.id,
        quoteRevisionId: document.currentRevisionId,
        tokenHash: token.hash,
        expiresAt: tokenExpiresAt,
      },
    });

    await tx.quoteEvent.create({
      data: {
        quoteDocumentId: document.id,
        quoteRevisionId: document.currentRevisionId,
        eventType: "SENT",
        actorType: "BUSINESS_MEMBER",
        actorId: actorMemberId,
        // No metadata — the raw token is NEVER written to the ledger.
      },
    });

    return token.raw;
  });

  // Safe read model (no token data) + the one-time raw bearer token.
  const quote = await getQuoteDetail(businessId, documentId);
  return { quote, acceptanceToken: rawToken };
}

// ---------------------------------------------------------------------------
// Cancel (SENT -> CANCELED) — PROGRAM 3 LOOP 3F
//
// Terminal, atomic, single-winner. Revokes every live acceptance token
// for the document so a customer holding the link can no longer accept
// (the link still RESOLVES read-only, showing "canceled"). Historical
// revisions/line items are never touched.
// ---------------------------------------------------------------------------

export async function cancelQuote(businessId: string, actorMemberId: string, documentId: string) {
  await withLimitCheck(async (tx) => {
    const document = await tx.quoteDocument.findFirst({
      where: { id: documentId, businessId },
      select: { id: true, status: true, currentRevisionId: true },
    });
    if (!document) throw ApiError.notFound("Quote not found");

    // Lifecycle authority — non-SENT (DRAFT, or already terminal) throws
    // ApiError.conflict (409). A DRAFT is deleted, never canceled.
    assertLegalQuoteTransition(document.status, "CANCEL");

    const transitioned = await tx.quoteDocument.updateMany({
      where: { id: document.id, businessId, status: "SENT" },
      data: { status: "CANCELED" },
    });
    if (transitioned.count !== 1) {
      // Lost a race to a concurrent customer accept/decline or another cancel.
      throw ApiError.conflict("This quote has already been actioned");
    }

    await tx.quoteAcceptanceToken.updateMany({
      where: { quoteRevision: { quoteDocumentId: document.id }, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await tx.quoteEvent.create({
      data: {
        quoteDocumentId: document.id,
        quoteRevisionId: document.currentRevisionId,
        eventType: "CANCELED",
        actorType: "BUSINESS_MEMBER",
        actorId: actorMemberId,
      },
    });
  });

  return getQuoteDetail(businessId, documentId);
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function listQuotes(businessId: string, query: ListQuotesQuery) {
  const where: Prisma.QuoteDocumentWhereInput = {
    businessId,
    ...(query.documentType ? { documentType: query.documentType } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.customerId ? { customerId: query.customerId } : {}),
    ...(query.leadId ? { leadId: query.leadId } : {}),
  };

  const [items, total] = await prisma.$transaction([
    prisma.quoteDocument.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        documentType: true,
        documentNumber: true,
        status: true,
        currency: true,
        expiresAt: true,
        createdAt: true,
        updatedAt: true,
        currentRevision: { select: { id: true, revisionNumber: true, subtotal: true, discountTotal: true, taxTotal: true, total: true } },
        customer: { select: { id: true, name: true } },
        lead: { select: { id: true, serviceRequested: true } },
      },
    }),
    prisma.quoteDocument.count({ where }),
  ]);

  return {
    items: items.map((doc) => ({
      id: doc.id,
      documentType: doc.documentType,
      documentNumber: doc.documentNumber,
      status: doc.status,
      currency: doc.currency,
      totals: doc.currentRevision
        ? {
            subtotal: doc.currentRevision.subtotal.toFixed(2),
            discountTotal: doc.currentRevision.discountTotal.toFixed(2),
            taxTotal: doc.currentRevision.taxTotal.toFixed(2),
            total: doc.currentRevision.total.toFixed(2),
          }
        : { subtotal: "0.00", discountTotal: "0.00", taxTotal: "0.00", total: "0.00" },
      customer: doc.customer,
      lead: doc.lead ? { id: doc.lead.id, serviceRequested: doc.lead.serviceRequested } : null,
      expiresAt: doc.expiresAt,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function getQuoteDetail(businessId: string, documentId: string) {
  const document = await prisma.quoteDocument.findFirst({
    where: { id: documentId, businessId },
    select: {
      id: true,
      documentType: true,
      documentNumber: true,
      status: true,
      currency: true,
      leadId: true,
      customerId: true,
      customerProfileId: true,
      appointmentId: true,
      currentRevisionId: true,
      acceptedRevisionId: true,
      expiresAt: true,
      createdAt: true,
      updatedAt: true,
      createdByMemberId: true,
      currentRevision: { select: REVISION_SELECT },
      customer: { select: { id: true, name: true, phone: true, email: true } },
      lead: { select: { id: true, serviceRequested: true, status: true } },
      revisions: { select: { id: true, revisionNumber: true, total: true, createdAt: true }, orderBy: { revisionNumber: "asc" } },
    },
  });
  if (!document) throw ApiError.notFound("Quote not found");

  const current = document.currentRevision;
  return {
    id: document.id,
    documentType: document.documentType,
    documentNumber: document.documentNumber,
    status: document.status,
    currency: document.currency,
    origins: {
      leadId: document.leadId,
      customerId: document.customerId,
      customerProfileId: document.customerProfileId,
      appointmentId: document.appointmentId,
    },
    customer: document.customer,
    lead: document.lead,
    currentRevision: current
      ? {
          id: current.id,
          revisionNumber: current.revisionNumber,
          notes: current.notes,
          terms: current.terms,
          totals: {
            subtotal: current.subtotal.toFixed(2),
            discountTotal: current.discountTotal.toFixed(2),
            taxTotal: current.taxTotal.toFixed(2),
            total: current.total.toFixed(2),
          },
          lineItems: current.lineItems.map((li) => ({
            id: li.id,
            serviceOfferingId: li.serviceOfferingId,
            description: li.description,
            quantity: li.quantity.toFixed(2),
            unitPrice: li.unitPrice.toFixed(2),
            discountAmount: li.discountAmount.toFixed(2),
            taxable: li.taxable,
            lineTotal: li.lineTotal.toFixed(2),
            sortOrder: li.sortOrder,
          })),
        }
      : null,
    revisionHistory: document.revisions.map((r) => ({ id: r.id, revisionNumber: r.revisionNumber, total: r.total.toFixed(2), createdAt: r.createdAt })),
    expiresAt: document.expiresAt,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}
