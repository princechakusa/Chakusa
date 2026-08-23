import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import { authHeader, createTestApp, registerAccount, resetDatabase } from "./helpers.js";
import { getAudienceSummaries } from "../src/modules/customers/audiences.service.js";

describe("Stage 10 audience APIs", () => {
  let app: FastifyInstance;

  beforeAll(async () => { app = await createTestApp(); });
  afterEach(async () => { await resetDatabase(); });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it("derives smart audiences, metrics, and system tags from repository data", async () => {
    const { token, businessId } = await registerAccount(app);
    const [vip, loyal, dormant] = await Promise.all([
      prisma.customer.create({ data: { businessId, name: "VIP Customer" } }),
      prisma.customer.create({ data: { businessId, name: "Loyal Customer" } }),
      prisma.customer.create({ data: { businessId, name: "Dormant Customer" } }),
    ]);
    const recent = new Date();
    const old = new Date(Date.now() - 90 * 86_400_000);
    await prisma.lead.createMany({ data: [
      { businessId, customerId: vip.id, source: "manual", status: "won", estimatedValue: 600, paidAmount: 600, paymentStatus: "paid", createdAt: recent },
      { businessId, customerId: vip.id, source: "manual", status: "won", estimatedValue: 500, paidAmount: 100, paymentStatus: "partially_paid", createdAt: recent },
      ...Array.from({ length: 3 }, () => ({ businessId, customerId: loyal.id, source: "manual", status: "won" as const, estimatedValue: 100, paidAmount: 100, paymentStatus: "paid" as const, createdAt: recent })),
      { businessId, customerId: dormant.id, source: "manual", status: "won", estimatedValue: 200, paidAmount: 200, paymentStatus: "paid", createdAt: old },
    ] });
    await prisma.reviewRequest.create({ data: { businessId, customerId: vip.id, status: "pending" } });
    await prisma.reminder.create({ data: { businessId, customerId: loyal.id, dueDate: recent, status: "due" } });

    const response = await app.inject({ method: "GET", url: "/customers/audiences", headers: authHeader(token) });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(await getAudienceSummaries(businessId)).toEqual(body.audiences);
    const byKey = new Map(body.audiences.map((audience: { key: string }) => [audience.key, audience]));
    expect(byKey.get("vip")).toMatchObject({ totalCustomers: 1, revenue: 1100, averageValue: 1100, repeatRate: 1 });
    expect(byKey.get("high_value")).toMatchObject({ totalCustomers: 1, revenue: 1100 });
    expect(byKey.get("loyal")).toMatchObject({ totalCustomers: 1, repeatRate: 1 });
    expect(byKey.get("dormant")).toMatchObject({ totalCustomers: 1 });
    expect(byKey.get("outstanding_payments")).toMatchObject({ totalCustomers: 1, outstandingPayments: 400 });
    expect(byKey.get("needs_reviews")).toMatchObject({ totalCustomers: 1 });
    expect(byKey.get("active_reminders")).toMatchObject({ totalCustomers: 1 });
    expect(body.members.find((member: { customerId: string }) => member.customerId === vip.id).systemTags).toEqual(expect.arrayContaining(["vip", "payment_outstanding", "waiting_for_review"]));
  });

  it("persists only manual tags and returns their assignments", async () => {
    const { token, businessId } = await registerAccount(app);
    const customer = await prisma.customer.create({ data: { businessId, name: "Tagged Customer" } });
    const created = await app.inject({ method: "POST", url: "/customers/tags", headers: authHeader(token), payload: { name: "Priority" } });
    expect(created.statusCode).toBe(201);

    const assigned = await app.inject({ method: "PATCH", url: `/customers/${customer.id}/tags`, headers: authHeader(token), payload: { tagIds: [created.json().id] } });
    expect(assigned.statusCode).toBe(200);
    expect(await prisma.customerTag.count({ where: { businessId } })).toBe(1);
    expect(await prisma.customerTagAssignment.count({ where: { customerId: customer.id } })).toBe(1);

    const center = await app.inject({ method: "GET", url: "/customers/audiences", headers: authHeader(token) });
    expect(center.json().members.find((member: { customerId: string }) => member.customerId === customer.id).manualTagIds).toEqual([created.json().id]);
  });

  it("keeps tag assignment tenant-isolated", async () => {
    const businessA = await registerAccount(app, { email: "audience-a@example.com" });
    const businessB = await registerAccount(app, { email: "audience-b@example.com" });
    const customerA = await prisma.customer.create({ data: { businessId: businessA.businessId, name: "A Customer" } });
    const customerB = await prisma.customer.create({ data: { businessId: businessB.businessId, name: "B Customer" } });
    const tagB = await prisma.customerTag.create({ data: { businessId: businessB.businessId, name: "B Tag" } });

    const foreignCustomer = await app.inject({ method: "PATCH", url: `/customers/${customerB.id}/tags`, headers: authHeader(businessA.token), payload: { tagIds: [] } });
    const foreignTag = await app.inject({ method: "PATCH", url: `/customers/${customerA.id}/tags`, headers: authHeader(businessA.token), payload: { tagIds: [tagB.id] } });
    expect(foreignCustomer.statusCode).toBe(404);
    expect(foreignTag.statusCode).toBe(404);
    expect(await prisma.customerTagAssignment.count()).toBe(0);
  });

  it("rejects duplicate manual tag names with a conflict", async () => {
    const { token } = await registerAccount(app);
    await app.inject({ method: "POST", url: "/customers/tags", headers: authHeader(token), payload: { name: "VIP Follow-up" } });
    const duplicate = await app.inject({ method: "POST", url: "/customers/tags", headers: authHeader(token), payload: { name: "VIP Follow-up" } });
    expect(duplicate.statusCode).toBe(409);
  });

  it("requires authentication", async () => {
    expect((await app.inject({ method: "GET", url: "/customers/audiences" })).statusCode).toBe(401);
  });
});
