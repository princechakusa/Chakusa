import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, resetDatabase, registerAccount, authHeader } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { LEAD_SOURCE_MISSED_CALL } from "../src/lib/leadSources.js";

describe("tenant isolation", () => {
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

  it("prevents user A from reading user B's business", async () => {
    const userA = await registerAccount(app, { email: "a@example.com" });
    const userB = await registerAccount(app, { email: "b@example.com", businessName: "B Co" });

    const asA = await app.inject({ method: "GET", url: "/business", headers: authHeader(userA.token) });
    const asB = await app.inject({ method: "GET", url: "/business", headers: authHeader(userB.token) });

    expect(asA.json().id).toBe(userA.businessId);
    expect(asB.json().id).toBe(userB.businessId);
    expect(asA.json().id).not.toBe(asB.json().id);
  });

  it("prevents user A from reading user B's customer by ID", async () => {
    const userA = await registerAccount(app, { email: "a2@example.com" });
    const userB = await registerAccount(app, { email: "b2@example.com" });

    const created = await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(userB.token),
      payload: { name: "B's Customer" },
    });
    const customerId = created.json().id;

    const crossAccess = await app.inject({
      method: "GET",
      url: `/customers/${customerId}`,
      headers: authHeader(userA.token),
    });

    expect(crossAccess.statusCode).toBe(404);
    expect(crossAccess.json().error.code).toBe("NOT_FOUND");
  });

  it("prevents user A from updating user B's customer", async () => {
    const userA = await registerAccount(app, { email: "a3@example.com" });
    const userB = await registerAccount(app, { email: "b3@example.com" });

    const created = await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(userB.token),
      payload: { name: "B's Other Customer" },
    });
    const customerId = created.json().id;

    const crossUpdate = await app.inject({
      method: "PATCH",
      url: `/customers/${customerId}`,
      headers: authHeader(userA.token),
      payload: { name: "Hijacked" },
    });

    expect(crossUpdate.statusCode).toBe(404);

    const unchanged = await prisma.customer.findUnique({ where: { id: customerId } });
    expect(unchanged?.name).toBe("B's Other Customer");
  });

  it("scopes the customer list to the caller's business only", async () => {
    const userA = await registerAccount(app, { email: "a4@example.com" });
    const userB = await registerAccount(app, { email: "b4@example.com" });

    await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(userA.token),
      payload: { name: "A's Customer" },
    });
    await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(userB.token),
      payload: { name: "B's Customer" },
    });

    const listAsA = await app.inject({
      method: "GET",
      url: "/customers",
      headers: authHeader(userA.token),
    });

    const names = listAsA.json().items.map((c: { name: string }) => c.name);
    expect(names).toContain("A's Customer");
    expect(names).not.toContain("B's Customer");
  });

  it("prevents user A from accessing user B's lead", async () => {
    const userA = await registerAccount(app, { email: "a5@example.com" });
    const userB = await registerAccount(app, { email: "b5@example.com" });

    const created = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(userB.token),
      payload: { source: LEAD_SOURCE_MISSED_CALL, serviceRequested: "haircut" },
    });
    const leadId = created.json().id;

    const crossGet = await app.inject({
      method: "GET",
      url: `/leads/${leadId}`,
      headers: authHeader(userA.token),
    });
    expect(crossGet.statusCode).toBe(404);

    const crossTransition = await app.inject({
      method: "POST",
      url: `/leads/${leadId}/mark-won`,
      headers: authHeader(userA.token),
    });
    expect(crossTransition.statusCode).toBe(404);
  });

  it("prevents creating a lead against another business's customer", async () => {
    const userA = await registerAccount(app, { email: "a6@example.com" });
    const userB = await registerAccount(app, { email: "b6@example.com" });

    const bCustomer = await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(userB.token),
      payload: { name: "B's Customer" },
    });

    const response = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(userA.token),
      payload: { customerId: bCustomer.json().id, source: LEAD_SOURCE_MISSED_CALL },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("prevents user A from reading user B's dashboard data", async () => {
    const userA = await registerAccount(app, { email: "a7@example.com" });
    const userB = await registerAccount(app, { email: "b7@example.com" });

    await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(userB.token),
      payload: { source: LEAD_SOURCE_MISSED_CALL, estimatedValue: 500 },
    });

    const dashboardA = await app.inject({
      method: "GET",
      url: "/dashboard/summary",
      headers: authHeader(userA.token),
    });

    expect(dashboardA.json().leads.total).toBe(0);
  });

  it("rejects creating a review request against another business's customer", async () => {
    const userA = await registerAccount(app, { email: "rr-a@example.com" });
    const userB = await registerAccount(app, { email: "rr-b@example.com" });

    const bCustomer = await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(userB.token),
      payload: { name: "B's Customer" },
    });

    const response = await app.inject({
      method: "POST",
      url: "/review-requests",
      headers: authHeader(userA.token),
      payload: { customerId: bCustomer.json().id },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects creating a reminder against another business's customer", async () => {
    const userA = await registerAccount(app, { email: "rem-a@example.com" });
    const userB = await registerAccount(app, { email: "rem-b@example.com" });

    const bCustomer = await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(userB.token),
      payload: { name: "B's Customer" },
    });

    const response = await app.inject({
      method: "POST",
      url: "/reminders",
      headers: authHeader(userA.token),
      payload: { customerId: bCustomer.json().id, dueDate: new Date().toISOString() },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects creating feedback against another business's customer", async () => {
    const userA = await registerAccount(app, { email: "fb-a@example.com" });
    const userB = await registerAccount(app, { email: "fb-b@example.com" });

    const bCustomer = await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(userB.token),
      payload: { name: "B's Customer" },
    });

    const response = await app.inject({
      method: "POST",
      url: "/feedback",
      headers: authHeader(userA.token),
      payload: { customerId: bCustomer.json().id, rating: 5 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("prevents feedback from mutating another business's review request via reviewRequestId", async () => {
    const userA = await registerAccount(app, { email: "fbrr-a@example.com" });
    const userB = await registerAccount(app, { email: "fbrr-b@example.com" });

    const bReviewRequest = await app.inject({
      method: "POST",
      url: "/review-requests",
      headers: authHeader(userB.token),
      payload: {},
    });
    const reviewRequestId = bReviewRequest.json().id;
    expect(bReviewRequest.json().status).toBe("pending");

    const response = await app.inject({
      method: "POST",
      url: "/feedback",
      headers: authHeader(userA.token),
      payload: { reviewRequestId, rating: 1, comment: "hijack attempt" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");

    // B's review request must be untouched by A's attempt.
    const stillPending = await prisma.reviewRequest.findUnique({ where: { id: reviewRequestId } });
    expect(stillPending?.status).toBe("pending");

    // No feedback row should exist at all for A's business.
    const feedbackAsA = await app.inject({
      method: "GET",
      url: "/feedback",
      headers: authHeader(userA.token),
    });
    expect(feedbackAsA.json()).toHaveLength(0);
  });

  it("prevents user A from PATCHing user B's review request by guessed ID", async () => {
    const userA = await registerAccount(app, { email: "rrpatch-a@example.com" });
    const userB = await registerAccount(app, { email: "rrpatch-b@example.com" });

    const created = await app.inject({
      method: "POST",
      url: "/review-requests",
      headers: authHeader(userB.token),
      payload: { serviceName: "original" },
    });
    const reviewRequestId = created.json().id;

    const crossPatch = await app.inject({
      method: "PATCH",
      url: `/review-requests/${reviewRequestId}`,
      headers: authHeader(userA.token),
      payload: { serviceName: "hijacked" },
    });
    expect(crossPatch.statusCode).toBe(404);

    const crossTransition = await app.inject({
      method: "POST",
      url: `/review-requests/${reviewRequestId}/mark-sent`,
      headers: authHeader(userA.token),
    });
    expect(crossTransition.statusCode).toBe(404);

    const unchanged = await prisma.reviewRequest.findUnique({ where: { id: reviewRequestId } });
    expect(unchanged?.serviceName).toBe("original");
    expect(unchanged?.status).toBe("pending");
  });

  it("prevents user A from PATCHing user B's reminder by guessed ID", async () => {
    const userA = await registerAccount(app, { email: "rempatch-a@example.com" });
    const userB = await registerAccount(app, { email: "rempatch-b@example.com" });

    const created = await app.inject({
      method: "POST",
      url: "/reminders",
      headers: authHeader(userB.token),
      payload: { serviceName: "original", dueDate: new Date().toISOString() },
    });
    const reminderId = created.json().id;

    const crossPatch = await app.inject({
      method: "PATCH",
      url: `/reminders/${reminderId}`,
      headers: authHeader(userA.token),
      payload: { serviceName: "hijacked" },
    });
    expect(crossPatch.statusCode).toBe(404);

    const crossTransition = await app.inject({
      method: "POST",
      url: `/reminders/${reminderId}/mark-sent`,
      headers: authHeader(userA.token),
    });
    expect(crossTransition.statusCode).toBe(404);

    const unchanged = await prisma.reminder.findUnique({ where: { id: reminderId } });
    expect(unchanged?.serviceName).toBe("original");
    expect(unchanged?.status).toBe("due");
  });

  it("prevents user A from PATCHing user B's message template by guessed ID", async () => {
    const userA = await registerAccount(app, { email: "tplpatch-a@example.com" });
    const userB = await registerAccount(app, { email: "tplpatch-b@example.com" });

    const created = await app.inject({
      method: "POST",
      url: "/message-templates",
      headers: authHeader(userB.token),
      payload: { templateType: "missed_call", name: "original", body: "Hi {{customer_name}}" },
    });
    const templateId = created.json().id;

    const crossPatch = await app.inject({
      method: "PATCH",
      url: `/message-templates/${templateId}`,
      headers: authHeader(userA.token),
      payload: { name: "hijacked" },
    });
    expect(crossPatch.statusCode).toBe(404);

    const unchanged = await prisma.messageTemplate.findUnique({ where: { id: templateId } });
    expect(unchanged?.name).toBe("original");
  });

  it("prevents user A from mutating user B's feedback status by guessed ID", async () => {
    const userA = await registerAccount(app, { email: "fbpatch-a@example.com" });
    const userB = await registerAccount(app, { email: "fbpatch-b@example.com" });

    const created = await app.inject({
      method: "POST",
      url: "/feedback",
      headers: authHeader(userB.token),
      payload: { rating: 4 },
    });
    const feedbackId = created.json().id;

    const crossPatch = await app.inject({
      method: "PATCH",
      url: `/feedback/${feedbackId}`,
      headers: authHeader(userA.token),
      payload: { status: "resolved" },
    });
    expect(crossPatch.statusCode).toBe(404);

    const unchanged = await prisma.feedback.findUnique({ where: { id: feedbackId } });
    expect(unchanged?.status).toBe("new");
  });
});
