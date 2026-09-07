import type { InvoiceStatus, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";

// PROGRAM 3 / Invoicing I7: authenticated customer invoice inbox.
//
// An invoice belongs to a signed-in customer when EITHER it was bound
// directly to their cross-account CustomerProfile, OR it was addressed to
// a business-scoped Customer contact row that the same profile is linked
// to via CustomerBusinessLink (the identical, already-trusted linkage the
// customer dashboard / AI context / wallet use). DRAFT invoices are never
// visible - only what the business has actually SENT (or later VOIDed).
// Read-only: no token, no lifecycle actions, no payment fields (none
// derivable yet), no internal audit metadata.

const VISIBLE_STATUSES: InvoiceStatus[] = ["SENT", "VOID"];

/** Business-scoped Customer contact ids this profile is linked to. */
async function linkedBusinessCustomerIds(customerProfileId: string): Promise<string[]> {
  const links = await prisma.customerBusinessLink.findMany({
    where: { customerProfileId, businessCustomerId: { not: null } },
    select: { businessCustomerId: true },
  });
  return links.map((link) => link.businessCustomerId!).filter((id): id is string => Boolean(id));
}

function ownershipWhere(customerProfileId: string, linkedCustomerIds: string[]): Prisma.InvoiceWhereInput {
  const or: Prisma.InvoiceWhereInput[] = [{ customerProfileId }];
  if (linkedCustomerIds.length) or.push({ customerId: { in: linkedCustomerIds } });
  return { status: { in: VISIBLE_STATUSES }, OR: or };
}

export async function listCustomerInvoices(customerProfileId: string) {
  const linkedCustomerIds = await linkedBusinessCustomerIds(customerProfileId);
  const invoices = await prisma.invoice.findMany({
    where: ownershipWhere(customerProfileId, linkedCustomerIds),
    orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
    take: 200,
    select: {
      id: true,
      invoiceNumber: true,
      status: true,
      currency: true,
      issueDate: true,
      dueDate: true,
      createdAt: true,
      business: { select: { name: true } },
      currentRevision: { select: { total: true } },
    },
  });

  return {
    items: invoices.map((invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      currency: invoice.currency,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      total: invoice.currentRevision ? invoice.currentRevision.total.toFixed(2) : "0.00",
      business: { name: invoice.business.name },
      createdAt: invoice.createdAt,
    })),
  };
}

export async function getCustomerInvoiceForProfile(customerProfileId: string, invoiceId: string) {
  const linkedCustomerIds = await linkedBusinessCustomerIds(customerProfileId);
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, ...ownershipWhere(customerProfileId, linkedCustomerIds) },
    select: {
      id: true,
      invoiceNumber: true,
      status: true,
      currency: true,
      issueDate: true,
      dueDate: true,
      createdAt: true,
      business: { select: { name: true } },
      currentRevision: {
        select: {
          notes: true,
          terms: true,
          subtotal: true,
          discountTotal: true,
          taxTotal: true,
          total: true,
          lineItems: {
            orderBy: { sortOrder: "asc" },
            select: { description: true, quantity: true, unitPrice: true, discountAmount: true, taxable: true, lineTotal: true },
          },
        },
      },
    },
  });
  if (!invoice) throw ApiError.notFound("Invoice not found");

  const revision = invoice.currentRevision;
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    currency: invoice.currency,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    createdAt: invoice.createdAt,
    business: { name: invoice.business.name },
    revision: revision
      ? {
          notes: revision.notes,
          terms: revision.terms,
          totals: {
            subtotal: revision.subtotal.toFixed(2),
            discountTotal: revision.discountTotal.toFixed(2),
            taxTotal: revision.taxTotal.toFixed(2),
            total: revision.total.toFixed(2),
          },
          lineItems: revision.lineItems.map((line) => ({
            description: line.description,
            quantity: line.quantity.toFixed(2),
            unitPrice: line.unitPrice.toFixed(2),
            discountAmount: line.discountAmount.toFixed(2),
            taxable: line.taxable,
            lineTotal: line.lineTotal.toFixed(2),
          })),
        }
      : null,
  };
}
