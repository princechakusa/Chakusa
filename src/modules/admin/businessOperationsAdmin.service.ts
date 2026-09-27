import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";

// Read-only operational snapshot of one business for platform support:
// leads, review requests, invoices, quotes, services, inventory, and
// reminders. Same guard as the support context (support.impersonate.read,
// audited at the route). Deliberately metadata-level: status counts plus
// recent items WITHOUT customer names, contact details, message bodies, or
// notes, so an admin can see whether a business's workflow is healthy
// without reading its customers' personal data.

const RECENT = 8;

function counts<T extends { status: string; _count: { _all: number } }>(rows: T[]) {
  return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
}

export async function getAdminBusinessOperations(businessId: string) {
  const exists = await prisma.business.findUnique({ where: { id: businessId }, select: { id: true } });
  if (!exists) throw ApiError.notFound("Business not found");
  const where = { businessId };

  const [
    leadStatus, recentLeads,
    reviewStatus, recentReviews,
    invoiceStatus, recentInvoices,
    quoteStatus, recentQuotes,
    services, inventoryTotal, inventoryActive,
    reminderStatus, nextReminders,
  ] = await Promise.all([
    prisma.lead.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.lead.findMany({ where, orderBy: { createdAt: "desc" }, take: RECENT, select: { id: true, source: true, status: true, urgency: true, serviceRequested: true, paymentStatus: true, createdAt: true, contactedAt: true, bookedAt: true } }),
    prisma.reviewRequest.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.reviewRequest.findMany({ where, orderBy: { createdAt: "desc" }, take: RECENT, select: { id: true, status: true, serviceName: true, sentAt: true, createdAt: true } }),
    prisma.invoice.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.invoice.findMany({ where, orderBy: { createdAt: "desc" }, take: RECENT, select: { id: true, invoiceNumber: true, status: true, currency: true, issueDate: true, dueDate: true, createdAt: true } }),
    prisma.quoteDocument.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.quoteDocument.findMany({ where, orderBy: { createdAt: "desc" }, take: RECENT, select: { id: true, documentNumber: true, documentType: true, status: true, currency: true, expiresAt: true, createdAt: true } }),
    prisma.serviceOffering.findMany({ where, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], take: 50, select: { id: true, name: true, category: true, durationMinutes: true, price: true, active: true, publiclyBookable: true } }),
    prisma.inventoryItem.count({ where }),
    prisma.inventoryItem.count({ where: { ...where, active: true } }),
    prisma.reminder.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.reminder.findMany({ where: { ...where, dueDate: { gte: new Date() } }, orderBy: { dueDate: "asc" }, take: RECENT, select: { id: true, status: true, serviceName: true, dueDate: true } }),
  ]);

  return {
    businessId,
    leads: { byStatus: counts(leadStatus), recent: recentLeads },
    reviewRequests: { byStatus: counts(reviewStatus), recent: recentReviews },
    invoices: { byStatus: counts(invoiceStatus), recent: recentInvoices },
    quotes: { byStatus: counts(quoteStatus), recent: recentQuotes },
    services: services.map((s) => ({ ...s, price: s.price === null ? null : Number(s.price) })),
    inventory: { total: inventoryTotal, active: inventoryActive },
    reminders: { byStatus: counts(reminderStatus), upcoming: nextReminders },
  };
}
