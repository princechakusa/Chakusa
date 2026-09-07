import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { config } from "../../lib/config.js";
import { generateOpaqueToken } from "../../lib/authTokens.js";
import { withLimitCheck } from "../../lib/entitlements.js";
import { assertLegalInvoiceTransition, calculateInvoiceTotals, canSendInvoice, formatInvoiceNumber } from "../../lib/invoices/invoices.domain.js";
import { deriveInvoicePayment } from "../../lib/invoices/invoicePayments.domain.js";
import { buildPublicInvoiceUrl } from "../../lib/invoices/publicInvoiceLinks.js";
import type { InvoiceLineItemInput, InvoiceTotals } from "../../lib/invoices/invoices.types.js";
import type { CreateInvoiceInput, ListInvoicesQuery, UpdateInvoiceInput } from "./invoices.schemas.js";

// PROGRAM 3 / Invoicing I2: BUSINESS-side draft + read service. Every
// function takes a server-resolved `businessId` (from requireBusiness -
// never a client value) and a server-resolved `createdByMemberId`. Only
// DRAFT invoices are created / edited / deleted here. All money is
// computed by the I1 domain layer - a client-supplied total is never
// persisted. Editing a DRAFT writes a NEW immutable InvoiceRevision and
// repoints Invoice.currentRevisionId; existing revisions / line items are
// never mutated.

const ZERO_TOTALS: InvoiceTotals = { lineItems: [], subtotal: "0.00", discountTotal: "0.00", taxTotal: "0.00", total: "0.00" };

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
// Tenant-safe validation of every client-referenced id. A foreign or
// nonexistent id returns the SAME 404 either way (no existence probing).
// ---------------------------------------------------------------------------

async function assertOriginsInBusiness(
  businessId: string,
  input: { customerId?: string | null; customerProfileId?: string | null; appointmentId?: string | null },
) {
  if (input.customerId) {
    const customer = await prisma.customer.findFirst({ where: { id: input.customerId, businessId }, select: { id: true } });
    if (!customer) throw ApiError.notFound("Customer not found");
  }
  if (input.appointmentId) {
    const appointment = await prisma.appointment.findFirst({ where: { id: input.appointmentId, businessId }, select: { id: true } });
    if (!appointment) throw ApiError.notFound("Appointment not found");
  }
  if (input.customerProfileId) {
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

function computeTotals(input: {
  lineItems?: ReadonlyArray<{ quantity: number | string; unitPrice: number | string; discountAmount?: number | string; taxable?: boolean }>;
  taxRatePercent?: number | string;
}): InvoiceTotals {
  const lineItems = input.lineItems ?? [];
  // A DRAFT may have zero line items -> all-zero totals WITHOUT calling
  // calculateInvoiceTotals (which correctly still rejects an empty list -
  // canSendInvoice stays strict for the later send stage).
  if (!lineItems.length) return ZERO_TOTALS;
  return calculateInvoiceTotals({
    lineItems: lineItems.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discountAmount: l.discountAmount, taxable: l.taxable })),
    taxRatePercent: input.taxRatePercent,
  });
}

// ---------------------------------------------------------------------------
// Invoice-number allocation - server-only, transaction-safe, one sequence
// per (business, year). Fresh counter nextValue=1 -> first number
// INV-<year>-0001. The `increment` update returns the post-increment
// value, so the number just allocated is `returned - 1`.
// ---------------------------------------------------------------------------

async function allocateNextCounterValue(tx: Prisma.TransactionClient, businessId: string, year: number): Promise<number> {
  const key = { businessId_year: { businessId, year } };
  try {
    const updated = await tx.invoiceCounter.update({ where: key, data: { nextValue: { increment: 1 } } });
    return updated.nextValue - 1;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      try {
        await tx.invoiceCounter.create({ data: { businessId, year, nextValue: 2 } });
        return 1;
      } catch (createError) {
        if (createError instanceof Prisma.PrismaClientKnownRequestError && createError.code === "P2002") {
          const updated = await tx.invoiceCounter.update({ where: key, data: { nextValue: { increment: 1 } } });
          return updated.nextValue - 1;
        }
        throw createError;
      }
    }
    throw error;
  }
}

async function createRevision(
  tx: Prisma.TransactionClient,
  invoiceId: string,
  revisionNumber: number,
  createdByMemberId: string,
  content: { notes?: string | null; terms?: string | null; lineItems?: ReadonlyArray<{ serviceOfferingId?: string | null; description: string; sortOrder?: number }> },
  totals: InvoiceTotals,
) {
  const lineItems = content.lineItems ?? [];
  return tx.invoiceRevision.create({
    data: {
      invoiceId,
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
// Create draft
// ---------------------------------------------------------------------------

export async function createInvoiceDraft(businessId: string, createdByMemberId: string, input: CreateInvoiceInput) {
  await assertOriginsInBusiness(businessId, input);
  if (input.lineItems?.length) await assertServiceOfferingsInBusiness(businessId, input.lineItems);

  const totals = computeTotals(input);
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { currency: true } });
  const currency = (business?.currency ?? "USD").toUpperCase();
  const year = new Date().getUTCFullYear();

  const invoiceId = await withLimitCheck(async (tx) => {
    const counterValue = await allocateNextCounterValue(tx, businessId, year);
    const invoiceNumber = formatInvoiceNumber({ year, counterValue });

    const invoice = await tx.invoice.create({
      data: {
        businessId,
        createdByMemberId,
        invoiceNumber,
        currency,
        status: "DRAFT",
        nextRevisionNumber: 2,
        customerId: input.customerId ?? null,
        customerProfileId: input.customerProfileId ?? null,
        appointmentId: input.appointmentId ?? null,
        issueDate: input.issueDate ?? null,
        dueDate: input.dueDate ?? null,
      },
    });

    const revision = await createRevision(tx, invoice.id, 1, createdByMemberId, input, totals);
    await tx.invoice.update({ where: { id: invoice.id }, data: { currentRevisionId: revision.id } });
    await tx.invoiceEvent.create({
      data: { invoiceId: invoice.id, invoiceRevisionId: revision.id, eventType: "CREATED", actorType: "BUSINESS_MEMBER", actorId: createdByMemberId },
    });
    return invoice.id;
  });

  return getInvoiceDetail(businessId, invoiceId);
}

// ---------------------------------------------------------------------------
// Edit draft - new immutable revision, DRAFT-only, optimistic-concurrency
// guarded. The old revision + its line items are never touched.
// ---------------------------------------------------------------------------

export async function updateInvoiceDraft(businessId: string, actorMemberId: string, invoiceId: string, input: UpdateInvoiceInput) {
  await assertOriginsInBusiness(businessId, input);
  if (input.lineItems?.length) await assertServiceOfferingsInBusiness(businessId, input.lineItems);

  const totals = computeTotals(input);

  await withLimitCheck(async (tx) => {
    const invoice = await tx.invoice.findFirst({
      where: { id: invoiceId, businessId },
      select: { id: true, status: true, currentRevisionId: true, nextRevisionNumber: true },
    });
    if (!invoice) throw ApiError.notFound("Invoice not found");
    if (invoice.status !== "DRAFT") throw ApiError.conflict("Only draft invoices can be edited");
    if (invoice.currentRevisionId !== input.expectedCurrentRevisionId) {
      throw ApiError.conflict("This draft has changed since you loaded it — reload and try again");
    }

    const revision = await createRevision(tx, invoice.id, invoice.nextRevisionNumber, actorMemberId, input, totals);

    const advanced = await tx.invoice.updateMany({
      where: { id: invoice.id, businessId, status: "DRAFT", currentRevisionId: input.expectedCurrentRevisionId },
      data: {
        currentRevisionId: revision.id,
        nextRevisionNumber: { increment: 1 },
        customerId: input.customerId ?? null,
        customerProfileId: input.customerProfileId ?? null,
        appointmentId: input.appointmentId ?? null,
        issueDate: input.issueDate ?? null,
        dueDate: input.dueDate ?? null,
      },
    });
    if (advanced.count !== 1) {
      throw ApiError.conflict("This draft has changed since you loaded it — reload and try again");
    }
  });

  return getInvoiceDetail(businessId, invoiceId);
}

// ---------------------------------------------------------------------------
// Delete draft - DRAFT-only, race-guarded.
// ---------------------------------------------------------------------------

export async function deleteInvoiceDraft(businessId: string, invoiceId: string) {
  await withLimitCheck(async (tx) => {
    const deleted = await tx.invoice.deleteMany({ where: { id: invoiceId, businessId, status: "DRAFT" } });
    if (deleted.count === 1) return;
    const existing = await tx.invoice.findFirst({ where: { id: invoiceId, businessId }, select: { status: true } });
    if (existing) throw ApiError.conflict("Only draft invoices can be deleted");
    throw ApiError.notFound("Invoice not found");
  });
}

// ---------------------------------------------------------------------------
// Send (DRAFT -> SENT) + secure customer access token issuance - I4.
//
// One atomic Serializable transaction: validate DRAFT + current revision
// -> single-winner conditional DRAFT->SENT transition -> create exactly
// one hashed InvoiceAccessToken bound to the frozen revision -> record
// one SENT event. The raw token is returned once (for delivery) and
// never persisted or logged. issueDate defaults to the send moment.
// ---------------------------------------------------------------------------

function resolveInvoiceTokenExpiry(now: Date): Date {
  // Unlike a quote (which becomes un-actionable at expiry), an
  // over-deadline invoice is still collectible - so the token expiry is
  // simply a bounded, configurable TTL and is NOT capped by dueDate.
  return new Date(now.getTime() + config.INVOICE_ACCESS_TOKEN_TTL_DAYS * 86_400_000);
}

export async function sendInvoice(businessId: string, actorMemberId: string, invoiceId: string) {
  const rawToken = await withLimitCheck(async (tx) => {
    const invoice = await tx.invoice.findFirst({
      where: { id: invoiceId, businessId },
      select: {
        id: true,
        status: true,
        currentRevisionId: true,
        issueDate: true,
        dueDate: true,
        currentRevision: {
          select: { id: true, lineItems: { select: { quantity: true, unitPrice: true, discountAmount: true, taxable: true } } },
        },
      },
    });
    if (!invoice) throw ApiError.notFound("Invoice not found");

    // Lifecycle authority - non-DRAFT (SENT / VOID) throws ApiError.conflict (409).
    assertLegalInvoiceTransition(invoice.status, "SEND");

    if (!invoice.currentRevisionId || !invoice.currentRevision) {
      throw ApiError.conflict("This invoice has no current revision to send");
    }
    if (invoice.dueDate && invoice.issueDate && invoice.dueDate.getTime() < invoice.issueDate.getTime()) {
      throw ApiError.badRequest("The due date cannot be before the issue date");
    }

    const lineItems: InvoiceLineItemInput[] = invoice.currentRevision.lineItems.map((li) => ({
      quantity: li.quantity.toFixed(2),
      unitPrice: li.unitPrice.toFixed(2),
      discountAmount: li.discountAmount.toFixed(2),
      taxable: li.taxable,
    }));
    const eligibility = canSendInvoice({ status: invoice.status, lineItems });
    if (!eligibility.ok) throw ApiError.badRequest(eligibility.reason);

    const now = new Date();
    if (invoice.dueDate && !invoice.issueDate && invoice.dueDate.getTime() < now.getTime()) {
      throw ApiError.badRequest("The due date cannot be in the past");
    }

    const token = generateOpaqueToken();

    const transitioned = await tx.invoice.updateMany({
      where: { id: invoice.id, businessId, status: "DRAFT", currentRevisionId: invoice.currentRevisionId },
      data: { status: "SENT", issueDate: invoice.issueDate ?? now },
    });
    if (transitioned.count !== 1) {
      throw ApiError.conflict("This invoice has changed since you loaded it — reload and try again");
    }

    await tx.invoiceAccessToken.create({
      data: {
        id: token.id,
        invoiceRevisionId: invoice.currentRevisionId,
        tokenHash: token.hash,
        expiresAt: resolveInvoiceTokenExpiry(now),
      },
    });

    await tx.invoiceEvent.create({
      data: { invoiceId: invoice.id, invoiceRevisionId: invoice.currentRevisionId, eventType: "SENT", actorType: "BUSINESS_MEMBER", actorId: actorMemberId },
    });

    return token.raw;
  });

  const invoice = await getInvoiceDetail(businessId, invoiceId);
  return { invoice, accessToken: rawToken, accessUrl: buildPublicInvoiceUrl(rawToken) };
}

// ---------------------------------------------------------------------------
// Reissue link (I4/I5) - re-mint the customer access token for a SENT
// invoice (same current revision, no lifecycle change) so the business
// can hand the customer a working link again after the previous one was
// lost or expired. Any still-live token for the current revision is
// revoked. Not a lifecycle transition; no event.
// ---------------------------------------------------------------------------

export async function reissueInvoiceLink(businessId: string, invoiceId: string) {
  const rawToken = await withLimitCheck(async (tx) => {
    const invoice = await tx.invoice.findFirst({
      where: { id: invoiceId, businessId },
      select: { id: true, status: true, currentRevisionId: true },
    });
    if (!invoice) throw ApiError.notFound("Invoice not found");
    if (invoice.status !== "SENT" || !invoice.currentRevisionId) {
      throw ApiError.conflict("Only a sent invoice can have its link reissued");
    }

    // Conditional write on the row itself: enforces the SENT guard
    // atomically and makes a concurrent void abort under Serializable
    // isolation rather than racing the token swap.
    const claimed = await tx.invoice.updateMany({
      where: { id: invoice.id, businessId, status: "SENT", currentRevisionId: invoice.currentRevisionId },
      data: { status: "SENT" },
    });
    if (claimed.count !== 1) throw ApiError.conflict("This invoice has changed since you loaded it — reload and try again");

    await tx.invoiceAccessToken.updateMany({
      where: { invoiceRevisionId: invoice.currentRevisionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const token = generateOpaqueToken();
    await tx.invoiceAccessToken.create({
      data: { id: token.id, invoiceRevisionId: invoice.currentRevisionId, tokenHash: token.hash, expiresAt: resolveInvoiceTokenExpiry(new Date()) },
    });
    return token.raw;
  });

  const invoice = await getInvoiceDetail(businessId, invoiceId);
  return { invoice, accessToken: rawToken, accessUrl: buildPublicInvoiceUrl(rawToken) };
}

// ---------------------------------------------------------------------------
// Void - terminal. Legal from DRAFT or SENT. Revokes every live access
// token so the customer link can no longer resolve as "open". Never
// erases revisions or financial history.
// ---------------------------------------------------------------------------

export async function voidInvoice(businessId: string, actorMemberId: string, invoiceId: string) {
  await withLimitCheck(async (tx) => {
    const invoice = await tx.invoice.findFirst({
      where: { id: invoiceId, businessId },
      select: { id: true, status: true, currentRevisionId: true },
    });
    if (!invoice) throw ApiError.notFound("Invoice not found");
    assertLegalInvoiceTransition(invoice.status, "VOID");

    const transitioned = await tx.invoice.updateMany({
      where: { id: invoice.id, businessId, status: { in: ["DRAFT", "SENT"] } },
      data: { status: "VOID" },
    });
    if (transitioned.count !== 1) {
      throw ApiError.conflict("This invoice has already been actioned");
    }

    await tx.invoiceAccessToken.updateMany({
      where: { invoiceRevision: { invoiceId: invoice.id }, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await tx.invoiceEvent.create({
      data: { invoiceId: invoice.id, invoiceRevisionId: invoice.currentRevisionId, eventType: "VOIDED", actorType: "BUSINESS_MEMBER", actorId: actorMemberId },
    });
  });

  return getInvoiceDetail(businessId, invoiceId);
}

// ---------------------------------------------------------------------------
// Create from an accepted quote (I3) - an explicit business action, never
// automatic. The financial snapshot is copied VERBATIM from the exact
// accepted QuoteRevision (never the document's current revision if they
// somehow differ). Provenance is recorded on the Invoice + a
// CONVERTED_FROM_QUOTE event. One live invoice per quote: a second
// conversion is rejected while a non-VOID invoice already exists for it.
// ---------------------------------------------------------------------------

export async function createInvoiceFromQuote(businessId: string, createdByMemberId: string, quoteId: string) {
  const invoiceId = await withLimitCheck(async (tx) => {
    const quote = await tx.quoteDocument.findFirst({
      where: { id: quoteId, businessId },
      select: {
        id: true,
        status: true,
        currency: true,
        acceptedRevisionId: true,
        customerId: true,
        customerProfileId: true,
        appointmentId: true,
        acceptedRevision: {
          select: {
            id: true,
            subtotal: true,
            taxTotal: true,
            discountTotal: true,
            total: true,
            notes: true,
            terms: true,
            lineItems: {
              orderBy: { sortOrder: "asc" },
              select: { serviceOfferingId: true, description: true, quantity: true, unitPrice: true, discountAmount: true, taxable: true, lineTotal: true, sortOrder: true },
            },
          },
        },
      },
    });
    if (!quote) throw ApiError.notFound("Quote not found");
    if (quote.status !== "ACCEPTED" || !quote.acceptedRevisionId || !quote.acceptedRevision) {
      throw ApiError.conflict("Only an accepted quote can be turned into an invoice");
    }

    const existing = await tx.invoice.findFirst({
      where: { businessId, sourceQuoteDocumentId: quote.id, status: { not: "VOID" } },
      select: { id: true },
    });
    if (existing) throw ApiError.conflict("An invoice already exists for this quote");

    const year = new Date().getUTCFullYear();
    const counterValue = await allocateNextCounterValue(tx, businessId, year);
    const invoiceNumber = formatInvoiceNumber({ year, counterValue });
    const rev = quote.acceptedRevision;

    const invoice = await tx.invoice.create({
      data: {
        businessId,
        createdByMemberId,
        invoiceNumber,
        currency: quote.currency,
        status: "DRAFT",
        nextRevisionNumber: 2,
        customerId: quote.customerId,
        customerProfileId: quote.customerProfileId,
        appointmentId: quote.appointmentId,
        sourceQuoteDocumentId: quote.id,
        sourceQuoteRevisionId: quote.acceptedRevisionId,
      },
    });

    const revision = await tx.invoiceRevision.create({
      data: {
        invoiceId: invoice.id,
        revisionNumber: 1,
        subtotal: rev.subtotal,
        taxTotal: rev.taxTotal,
        discountTotal: rev.discountTotal,
        total: rev.total,
        notes: rev.notes,
        terms: rev.terms,
        createdByMemberId,
        lineItems: {
          create: rev.lineItems.map((li) => ({
            serviceOfferingId: li.serviceOfferingId,
            description: li.description,
            quantity: li.quantity,
            unitPrice: li.unitPrice,
            discountAmount: li.discountAmount,
            taxable: li.taxable,
            lineTotal: li.lineTotal,
            sortOrder: li.sortOrder,
          })),
        },
      },
    });

    await tx.invoice.update({ where: { id: invoice.id }, data: { currentRevisionId: revision.id } });
    await tx.invoiceEvent.create({
      data: {
        invoiceId: invoice.id,
        invoiceRevisionId: revision.id,
        eventType: "CONVERTED_FROM_QUOTE",
        actorType: "BUSINESS_MEMBER",
        actorId: createdByMemberId,
        metadata: { quoteDocumentId: quote.id, quoteRevisionId: quote.acceptedRevisionId },
      },
    });

    return invoice.id;
  });

  return getInvoiceDetail(businessId, invoiceId);
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function listInvoices(businessId: string, query: ListInvoicesQuery) {
  const where: Prisma.InvoiceWhereInput = {
    businessId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.customerId ? { customerId: query.customerId } : {}),
  };

  const [items, total] = await prisma.$transaction([
    prisma.invoice.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        currency: true,
        issueDate: true,
        dueDate: true,
        createdAt: true,
        updatedAt: true,
        currentRevision: { select: { id: true, revisionNumber: true, subtotal: true, discountTotal: true, taxTotal: true, total: true } },
        customer: { select: { id: true, name: true } },
        payments: { select: { status: true, amount: true, refundedAmount: true } },
      },
    }),
    prisma.invoice.count({ where }),
  ]);

  return {
    items: items.map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      status: inv.status,
      currency: inv.currency,
      totals: inv.currentRevision
        ? {
            subtotal: inv.currentRevision.subtotal.toFixed(2),
            discountTotal: inv.currentRevision.discountTotal.toFixed(2),
            taxTotal: inv.currentRevision.taxTotal.toFixed(2),
            total: inv.currentRevision.total.toFixed(2),
          }
        : { subtotal: "0.00", discountTotal: "0.00", taxTotal: "0.00", total: "0.00" },
      customer: inv.customer,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      payment: deriveInvoicePayment({
        invoiceStatus: inv.status,
        dueDate: inv.dueDate,
        currency: inv.currency,
        invoiceTotal: inv.currentRevision?.total ?? null,
        transactions: inv.payments,
      }),
      createdAt: inv.createdAt,
      updatedAt: inv.updatedAt,
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function getInvoiceDetail(businessId: string, invoiceId: string) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, businessId },
    select: {
      id: true,
      invoiceNumber: true,
      status: true,
      currency: true,
      customerId: true,
      customerProfileId: true,
      appointmentId: true,
      sourceQuoteDocumentId: true,
      sourceQuoteRevisionId: true,
      currentRevisionId: true,
      issueDate: true,
      dueDate: true,
      createdAt: true,
      updatedAt: true,
      createdByMemberId: true,
      currentRevision: { select: REVISION_SELECT },
      customer: { select: { id: true, name: true, phone: true, email: true } },
      revisions: { select: { id: true, revisionNumber: true, total: true, createdAt: true }, orderBy: { revisionNumber: "asc" } },
      payments: { select: { status: true, amount: true, refundedAmount: true } },
    },
  });
  if (!invoice) throw ApiError.notFound("Invoice not found");

  const current = invoice.currentRevision;
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    currency: invoice.currency,
    origins: {
      customerId: invoice.customerId,
      customerProfileId: invoice.customerProfileId,
      appointmentId: invoice.appointmentId,
    },
    quoteProvenance:
      invoice.sourceQuoteDocumentId
        ? { quoteDocumentId: invoice.sourceQuoteDocumentId, quoteRevisionId: invoice.sourceQuoteRevisionId }
        : null,
    customer: invoice.customer,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
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
    revisionHistory: invoice.revisions.map((r) => ({ id: r.id, revisionNumber: r.revisionNumber, total: r.total.toFixed(2), createdAt: r.createdAt })),
    payment: deriveInvoicePayment({
      invoiceStatus: invoice.status,
      dueDate: invoice.dueDate,
      currency: invoice.currency,
      invoiceTotal: current?.total ?? null,
      transactions: invoice.payments,
    }),
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt,
  };
}
