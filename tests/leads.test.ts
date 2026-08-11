import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, resetDatabase, registerAccount, authHeader } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

describe("leads", () => {
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

  it("creates a lead with status new by default", async () => {
    const { token } = await registerAccount(app);

    const response = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: { source: "missed_call", serviceRequested: "haircut", estimatedValue: 40 },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().status).toBe("new");
  });

  it("walks a lead through the full funnel and stamps timestamps", async () => {
    const { token } = await registerAccount(app);

    const created = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: { source: "missed_call" },
    });
    const leadId = created.json().id;

    const contacted = await app.inject({
      method: "POST",
      url: `/leads/${leadId}/mark-contacted`,
      headers: authHeader(token),
    });
    expect(contacted.json().status).toBe("contacted");
    expect(contacted.json().contactedAt).not.toBeNull();

    const booked = await app.inject({
      method: "POST",
      url: `/leads/${leadId}/mark-booked`,
      headers: authHeader(token),
    });
    expect(booked.json().status).toBe("booked");
    expect(booked.json().bookedAt).not.toBeNull();

    const won = await app.inject({
      method: "POST",
      url: `/leads/${leadId}/mark-won`,
      headers: authHeader(token),
    });
    expect(won.json().status).toBe("won");
    expect(won.json().wonAt).not.toBeNull();
  });

  it("computes response time in seconds from missedCallTime to contactedAt", async () => {
    const { token } = await registerAccount(app);

    const missedCallTime = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago

    const created = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: { source: "missed_call", missedCallTime: missedCallTime.toISOString() },
    });
    const leadId = created.json().id;

    await app.inject({
      method: "POST",
      url: `/leads/${leadId}/mark-contacted`,
      headers: authHeader(token),
    });

    const fetched = await app.inject({
      method: "GET",
      url: `/leads/${leadId}`,
      headers: authHeader(token),
    });

    const responseTimeSeconds = fetched.json().responseTimeSeconds;
    expect(responseTimeSeconds).toBeGreaterThanOrEqual(590);
    expect(responseTimeSeconds).toBeLessThan(700);
  });

  it("returns null response time when not yet contacted", async () => {
    const { token } = await registerAccount(app);

    const created = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: { source: "missed_call", missedCallTime: new Date().toISOString() },
    });

    const fetched = await app.inject({
      method: "GET",
      url: `/leads/${created.json().id}`,
      headers: authHeader(token),
    });

    expect(fetched.json().responseTimeSeconds).toBeNull();
  });

  it("generates a rendered missed-call message using business + lead context", async () => {
    const { token } = await registerAccount(app, { businessName: "Fresh Cuts" });

    const customer = await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(token),
      payload: { name: "Sam" },
    });

    const lead = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: { customerId: customer.json().id, serviceRequested: "hair coloring" },
    });

    const generated = await app.inject({
      method: "POST",
      url: `/leads/${lead.json().id}/generate-message`,
      headers: authHeader(token),
    });

    expect(generated.statusCode).toBe(200);
    expect(generated.json().message).toContain("Sam");
    expect(generated.json().message).toContain("Fresh Cuts");
    expect(generated.json().message).toContain("hair coloring");
  });

  it("filters the lead list by status", async () => {
    const { token } = await registerAccount(app);

    const lead = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: { source: "missed_call" },
    });
    await app.inject({
      method: "POST",
      url: `/leads/${lead.json().id}/mark-won`,
      headers: authHeader(token),
    });
    await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: { source: "missed_call" },
    });

    const wonOnly = await app.inject({
      method: "GET",
      url: "/leads?status=won",
      headers: authHeader(token),
    });

    expect(wonOnly.json().total).toBe(1);
    expect(wonOnly.json().items[0].status).toBe("won");
  });
});
