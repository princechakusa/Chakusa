import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, resetDatabase, registerAccount, authHeader, setPlan, setSubscriptionStatus } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

// PROGRAM 3 / Invoicing I7: authenticated customer invoice inbox.

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function businessAccount(app: FastifyInstance) {
  const account = await registerAccount(app);
  await setPlan(account.businessId, "BUSINESS");
  await setSubscriptionStatus(account.businessId, "ACTIVE");
  return account;
}

async function registerCustomer(app: FastifyInstance) {
  const email = `c-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const res = await app.inject({ method: "POST", url: "/customer/auth/register", payload: { email, password: "password123", fullName: "Casey Customer" } });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.body}`);
  const body = res.json();
  return { email, token: body.accessToken as string, profileId: body.profile.id as string };
}

async function draftInvoice(app: FastifyInstance, token: string, over: Record<string, unknown> = {}) {
  const body = { lineItems: [{ description: "Consulting", quantity: 2, unitPrice: "75.00", discountAmount: "10.00" }], ...over };
  const res = await app.inject({ method: "POST", url: "/invoices", headers: authHeader(token), payload: body });
  if (res.statusCode !== 201) throw new Error(`draft failed: ${res.body}`);
  return res.json();
}

async function sendInvoice(app: FastifyInstance, token: string, invoiceId: string) {
  const res = await app.inject({ method: "POST", url: `/invoices/${invoiceId}/send`, headers: authHeader(token) });
  if (res.statusCode !== 200) throw new Error(`send failed: ${res.body}`);
  return res.json();
}

/** Link a profile to a business via a business-scoped Customer contact row. */
async function linkViaContact(profileId: string, businessId: string) {
  const contact = await prisma.customer.create({ data: { businessId, name: "Casey Customer" } });
  await prisma.customerBusinessLink.create({ data: { customerProfileId: profileId, businessId, businessCustomerId: contact.id } });
  return contact.id;
}

describe("Authenticated customer invoice inbox (Program 3, Invoicing I7)", () => {
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

  it("rejects an unauthenticated caller", async () => {
    const res = await app.inject({ method: "GET", url: "/customer/invoices" });
    expect(res.statusCode).toBe(401);
  });

  it("returns an empty inbox for a customer with no linked invoices", async () => {
    const customer = await registerCustomer(app);
    const res = await app.inject({ method: "GET", url: "/customer/invoices", headers: auth(customer.token) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [] });
  });

  it("shows a SENT invoice bound to the profile directly, with a customer-safe read model", async () => {
    const account = await businessAccount(app);
    const customer = await registerCustomer(app);
    const draft = await draftInvoice(app, account.token, { dueDate: "2999-01-01" });
    await sendInvoice(app, account.token, draft.id);
    await prisma.invoice.update({ where: { id: draft.id }, data: { customerProfileId: customer.profileId } });

    const list = await app.inject({ method: "GET", url: "/customer/invoices", headers: auth(customer.token) });
    expect(list.statusCode).toBe(200);
    const items = list.json().items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: draft.id, status: "SENT", total: "140.00", business: { name: expect.any(String) } });

    const detail = await app.inject({ method: "GET", url: `/customer/invoices/${draft.id}`, headers: auth(customer.token) });
    expect(detail.statusCode).toBe(200);
    const body = detail.json();
    expect(body.revision.totals.total).toBe("140.00");
    expect(body.revision.lineItems).toHaveLength(1);
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("tokenHash");
    expect(raw).not.toContain("createdByMemberId");
    expect(raw).not.toContain("customerProfileId");
    expect(raw).not.toContain("businessId");
    expect(raw).not.toContain("amountPaid");
  });

  it("shows a SENT invoice addressed to a linked business contact row", async () => {
    const account = await businessAccount(app);
    const customer = await registerCustomer(app);
    const contactId = await linkViaContact(customer.profileId, account.businessId);
    const draft = await draftInvoice(app, account.token, { customerId: contactId, dueDate: "2999-01-01" });
    await sendInvoice(app, account.token, draft.id);

    const list = await app.inject({ method: "GET", url: "/customer/invoices", headers: auth(customer.token) });
    expect(list.json().items.map((i: { id: string }) => i.id)).toEqual([draft.id]);
  });

  it("never exposes a DRAFT invoice", async () => {
    const account = await businessAccount(app);
    const customer = await registerCustomer(app);
    const draft = await draftInvoice(app, account.token);
    await prisma.invoice.update({ where: { id: draft.id }, data: { customerProfileId: customer.profileId } });

    const list = await app.inject({ method: "GET", url: "/customer/invoices", headers: auth(customer.token) });
    expect(list.json().items).toEqual([]);
    const detail = await app.inject({ method: "GET", url: `/customer/invoices/${draft.id}`, headers: auth(customer.token) });
    expect(detail.statusCode).toBe(404);
  });

  it("shows a VOIDed invoice with status VOID", async () => {
    const account = await businessAccount(app);
    const customer = await registerCustomer(app);
    const draft = await draftInvoice(app, account.token, { dueDate: "2999-01-01" });
    await sendInvoice(app, account.token, draft.id);
    await prisma.invoice.update({ where: { id: draft.id }, data: { customerProfileId: customer.profileId } });
    const voided = await app.inject({ method: "POST", url: `/invoices/${draft.id}/void`, headers: authHeader(account.token) });
    expect(voided.statusCode).toBe(200);

    const list = await app.inject({ method: "GET", url: "/customer/invoices", headers: auth(customer.token) });
    expect(list.json().items[0]).toMatchObject({ id: draft.id, status: "VOID" });
  });

  it("does not let one customer read another customer's invoice", async () => {
    const account = await businessAccount(app);
    const owner = await registerCustomer(app);
    const intruder = await registerCustomer(app);
    const draft = await draftInvoice(app, account.token, { dueDate: "2999-01-01" });
    await sendInvoice(app, account.token, draft.id);
    await prisma.invoice.update({ where: { id: draft.id }, data: { customerProfileId: owner.profileId } });

    const list = await app.inject({ method: "GET", url: "/customer/invoices", headers: auth(intruder.token) });
    expect(list.json().items).toEqual([]);
    const detail = await app.inject({ method: "GET", url: `/customer/invoices/${draft.id}`, headers: auth(intruder.token) });
    expect(detail.statusCode).toBe(404);
  });

  it("rejects a business session token on the customer inbox", async () => {
    const account = await businessAccount(app);
    const res = await app.inject({ method: "GET", url: "/customer/invoices", headers: authHeader(account.token) });
    expect(res.statusCode).toBe(401);
  });
});
