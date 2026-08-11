import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, resetDatabase, registerAccount, authHeader } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { LEAD_SOURCE_MISSED_CALL } from "../src/lib/leadSources.js";

describe("dashboard summary", () => {
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

  it("aggregates lead funnel counts and conversion rate", async () => {
    const { token } = await registerAccount(app);

    const won = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: { source: LEAD_SOURCE_MISSED_CALL, estimatedValue: 100 },
    });
    await app.inject({
      method: "POST",
      url: `/leads/${won.json().id}/mark-won`,
      headers: authHeader(token),
    });

    const lost = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: { source: LEAD_SOURCE_MISSED_CALL },
    });
    await app.inject({
      method: "POST",
      url: `/leads/${lost.json().id}/mark-lost`,
      headers: authHeader(token),
    });

    await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: { source: LEAD_SOURCE_MISSED_CALL },
    });

    const summary = await app.inject({
      method: "GET",
      url: "/dashboard/summary",
      headers: authHeader(token),
    });

    const body = summary.json();
    expect(body.leads.total).toBe(3);
    expect(body.leads.won).toBe(1);
    expect(body.leads.lost).toBe(1);
    expect(body.leads.new).toBe(1);
    expect(body.leads.conversionRate).toBeCloseTo(1 / 3);
  });

  it("sums estimatedValue of won leads into recoveredRevenue.total", async () => {
    const { token } = await registerAccount(app);

    const leadA = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: { source: LEAD_SOURCE_MISSED_CALL, estimatedValue: 120.5 },
    });
    await app.inject({
      method: "POST",
      url: `/leads/${leadA.json().id}/mark-won`,
      headers: authHeader(token),
    });

    const leadB = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: { source: "referral", estimatedValue: 80 },
    });
    await app.inject({
      method: "POST",
      url: `/leads/${leadB.json().id}/mark-won`,
      headers: authHeader(token),
    });

    const summary = await app.inject({
      method: "GET",
      url: "/dashboard/summary",
      headers: authHeader(token),
    });

    expect(summary.json().recoveredRevenue.total).toBeCloseTo(200.5);
    expect(summary.json().recoveredRevenue.missedCall).toBeCloseTo(120.5);
  });

  it("counts due reminders as customersDue and surfaces them as attention items", async () => {
    const { token } = await registerAccount(app);

    const pastDue = new Date();
    pastDue.setDate(pastDue.getDate() - 1);

    await app.inject({
      method: "POST",
      url: "/reminders",
      headers: authHeader(token),
      payload: { dueDate: pastDue.toISOString() },
    });

    const futureDue = new Date();
    futureDue.setDate(futureDue.getDate() + 30);
    await app.inject({
      method: "POST",
      url: "/reminders",
      headers: authHeader(token),
      payload: { dueDate: futureDue.toISOString() },
    });

    const summary = await app.inject({
      method: "GET",
      url: "/dashboard/summary",
      headers: authHeader(token),
    });

    expect(summary.json().customersDue).toBe(1);
    expect(summary.json().todayAttentionItems).toHaveLength(1);
  });

  it("does not count a lead toward recoveredRevenue unless it went through mark-won", async () => {
    const { token } = await registerAccount(app);

    const lead = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: { source: LEAD_SOURCE_MISSED_CALL, estimatedValue: 999 },
    });

    // PATCH can no longer set status directly (see leads.test.ts), so this
    // lead stays "new" and must not contribute to recovered revenue.
    await app.inject({
      method: "PATCH",
      url: `/leads/${lead.json().id}`,
      headers: authHeader(token),
      payload: { notes: "still new" },
    });

    const summary = await app.inject({
      method: "GET",
      url: "/dashboard/summary",
      headers: authHeader(token),
    });

    expect(summary.json().recoveredRevenue.total).toBe(0);
    expect(summary.json().leads.won).toBe(0);
  });
});
