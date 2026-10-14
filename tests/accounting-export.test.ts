import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import { authHeader, createTestApp, registerAccount, resetDatabase, setPlan, setSubscriptionStatus } from "./helpers.js";
import { createAccountingExportToken, verifyAccountingExportToken } from "../src/modules/accounting/accountingExport.service.js";

const FROM = "2026-10-01T00:00:00.000Z";
const TO = "2026-11-01T00:00:00.000Z";

async function businessAccount(app: FastifyInstance, plan: "FREE" | "PRO" | "BUSINESS" = "BUSINESS") {
  const account = await registerAccount(app);
  if (plan !== "FREE") { await setPlan(account.businessId, plan); await setSubscriptionStatus(account.businessId, "ACTIVE"); }
  return account;
}

async function seedInvoice(businessId: string, number: string, customerName: string) {
  const member = await prisma.businessMember.findFirstOrThrow({ where: { businessId } });
  const customer = await prisma.customer.create({ data: { businessId, name: customerName } });
  const invoice = await prisma.invoice.create({ data: { businessId, createdByMemberId: member.id, customerId: customer.id, invoiceNumber: number, status: "SENT", currency: "USD", issueDate: new Date("2026-10-05T10:00:00Z"), dueDate: new Date("2026-10-19T10:00:00Z") } });
  const revision = await prisma.invoiceRevision.create({ data: { invoiceId: invoice.id, revisionNumber: 1, subtotal: 100, taxTotal: 15, discountTotal: 0, total: 115, createdByMemberId: member.id } });
  await prisma.invoice.update({ where: { id: invoice.id }, data: { currentRevisionId: revision.id } });
  await prisma.invoicePaymentTransaction.create({ data: { businessId, invoiceId: invoice.id, invoiceRevisionId: revision.id, status: "paid", amount: 115, currency: "USD", paidAt: new Date("2026-10-06T09:00:00Z") } });
}

let app: FastifyInstance;
beforeAll(async () => { app = await createTestApp(); });
afterEach(async () => { await resetDatabase(); });
afterAll(async () => { await app.close(); await prisma.$disconnect(); });

describe("accounting export", () => {
  it("issues a link to an entitled owner and the CSV holds only that business's invoices and payments", async () => {
    const owner = await businessAccount(app);
    const other = await businessAccount(app);
    await seedInvoice(owner.businessId, "INV-0001", "=HYPERLINK(\"evil\")");
    await seedInvoice(other.businessId, "INV-OTHER", "Other Co");
    const link = await app.inject({ method: "POST", url: "/accounting/export-link", headers: authHeader(owner.token), payload: { from: FROM, to: TO } });
    expect(link.statusCode).toBe(200);
    const csv = await app.inject({ method: "GET", url: link.json().path });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    const lines = csv.body.trim().split("\r\n");
    expect(lines[0]).toContain("Invoice number");
    expect(lines.some((line) => line.startsWith("Invoice,2026-10-05,INV-0001,") && line.includes(",115.00,"))).toBe(true);
    expect(lines.some((line) => line.startsWith("Payment,2026-10-06,INV-0001,") && line.includes(",115.00,"))).toBe(true);
    expect(csv.body).not.toContain("INV-OTHER");
    // Formula injection is neutralised.
    expect(csv.body).toContain("'=HYPERLINK");
  });

  it("refuses tampered, expired, unentitled and unauthenticated requests", async () => {
    const owner = await businessAccount(app);
    const other = await businessAccount(app);
    const { token } = createAccountingExportToken(owner.businessId, new Date(FROM), new Date(TO));
    const [encoded, signature] = token.split(".");
    const forged = Buffer.from(Buffer.from(encoded!, "base64url").toString("utf8").replace(owner.businessId, other.businessId)).toString("base64url");
    expect((await app.inject({ method: "GET", url: `/accounting/export.csv?token=${forged}.${signature}` })).statusCode).toBe(403);
    const expired = createAccountingExportToken(owner.businessId, new Date(FROM), new Date(TO), Date.now() - 11 * 60_000);
    expect(() => verifyAccountingExportToken(expired.token)).toThrow(/expired/);
    expect((await app.inject({ method: "POST", url: "/accounting/export-link", payload: { from: FROM, to: TO } })).statusCode).toBe(401);
    const free = await businessAccount(app, "FREE");
    expect((await app.inject({ method: "POST", url: "/accounting/export-link", headers: authHeader(free.token), payload: { from: FROM, to: TO } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/accounting/export-link", headers: authHeader(owner.token), payload: { from: TO, to: FROM } })).statusCode).toBe(400);
  });
});
