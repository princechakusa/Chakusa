import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { config } from "../../lib/config.js";
import { ApiError } from "../../lib/errors.js";

// Accounting export: invoices and their card payments for a period, as one
// CSV that QuickBooks, Xero or an accountant can import. The phone opens the
// file in its browser, which can't send the app's Bearer token, so an
// authorized owner/admin first gets a short-lived link whose HMAC binds the
// business and the period; the download route trusts nothing else.

const LINK_TTL_MS = 10 * 60_000;
const MAX_RANGE_DAYS = 400;

function mac(payload: string) {
  return createHmac("sha256", config.JWT_SECRET).update(`accounting-export:${payload}`).digest();
}

export function createAccountingExportToken(businessId: string, from: Date, to: Date, now = Date.now()) {
  if (!(to > from)) throw ApiError.badRequest("The end date must be after the start date");
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86_400_000) throw ApiError.badRequest(`Export at most ${MAX_RANGE_DAYS} days at a time`);
  const expiresAt = now + LINK_TTL_MS;
  const payload = `${businessId}|${from.toISOString()}|${to.toISOString()}|${expiresAt}`;
  return { token: `${Buffer.from(payload).toString("base64url")}.${mac(payload).toString("base64url")}`, expiresAt: new Date(expiresAt) };
}

export function verifyAccountingExportToken(token: string, now = Date.now()) {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) throw ApiError.forbidden("Invalid export link");
  const payload = Buffer.from(encoded, "base64url").toString("utf8");
  const expected = mac(payload);
  const supplied = Buffer.from(signature, "base64url");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw ApiError.forbidden("Invalid export link");
  const [businessId, fromIso, toIso, expiresAt] = payload.split("|");
  if (!businessId || !fromIso || !toIso || !expiresAt) throw ApiError.forbidden("Invalid export link");
  if (Number(expiresAt) <= now) throw ApiError.forbidden("This export link has expired. Create a new one in the app.");
  return { businessId, from: new Date(fromIso), to: new Date(toIso) };
}

function csvCell(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "";
  let text = String(value);
  // Spreadsheet formula injection: neutralise cells that start like a formula.
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const money = (value: { toString(): string } | null | undefined) => (value == null ? "" : Number(value.toString()).toFixed(2));
const day = (value: Date | null | undefined) => (value ? value.toISOString().slice(0, 10) : "");

export const ACCOUNTING_EXPORT_COLUMNS = ["Type", "Date", "Invoice number", "Customer", "Status", "Currency", "Subtotal", "Tax", "Discount", "Total", "Amount paid", "Amount refunded", "Due date"];

export async function buildAccountingExportCsv(businessId: string, from: Date, to: Date) {
  const invoices = await prisma.invoice.findMany({
    where: { businessId, status: { not: "DRAFT" }, OR: [{ issueDate: { gte: from, lt: to } }, { issueDate: null, createdAt: { gte: from, lt: to } }] },
    include: { currentRevision: true, customer: { select: { name: true } }, customerProfile: { select: { displayName: true } } },
    orderBy: [{ issueDate: "asc" }, { createdAt: "asc" }],
  });
  const payments = await prisma.invoicePaymentTransaction.findMany({
    where: { businessId, status: { in: ["paid", "partially_refunded", "refunded"] }, paidAt: { gte: from, lt: to } },
    include: { invoice: { select: { invoiceNumber: true, customer: { select: { name: true } }, customerProfile: { select: { displayName: true } } } } },
    orderBy: { paidAt: "asc" },
  });
  const rows: Array<Array<string | number | null>> = [ACCOUNTING_EXPORT_COLUMNS];
  for (const invoice of invoices) {
    const revision = invoice.currentRevision;
    rows.push(["Invoice", day(invoice.issueDate ?? invoice.createdAt), invoice.invoiceNumber, invoice.customer?.name ?? invoice.customerProfile?.displayName ?? "", invoice.status, invoice.currency, money(revision?.subtotal), money(revision?.taxTotal), money(revision?.discountTotal), money(revision?.total), "", "", day(invoice.dueDate)]);
  }
  for (const payment of payments) {
    rows.push(["Payment", day(payment.paidAt), payment.invoice.invoiceNumber, payment.invoice.customer?.name ?? payment.invoice.customerProfile?.displayName ?? "", payment.status, payment.currency, "", "", "", "", money(payment.amount), money(payment.refundedAmount), ""]);
  }
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
