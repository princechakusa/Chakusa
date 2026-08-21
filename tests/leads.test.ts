import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, resetDatabase, registerAccount, authHeader } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { LEAD_SOURCE_MISSED_CALL } from "../src/lib/leadSources.js";

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
      payload: { source: LEAD_SOURCE_MISSED_CALL, serviceRequested: "haircut", estimatedValue: 40 },
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
      payload: { source: LEAD_SOURCE_MISSED_CALL },
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
      payload: { source: LEAD_SOURCE_MISSED_CALL, missedCallTime: missedCallTime.toISOString() },
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
      payload: { source: LEAD_SOURCE_MISSED_CALL, missedCallTime: new Date().toISOString() },
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
      payload: { source: LEAD_SOURCE_MISSED_CALL },
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
      payload: { source: LEAD_SOURCE_MISSED_CALL },
    });

    const wonOnly = await app.inject({
      method: "GET",
      url: "/leads?status=won",
      headers: authHeader(token),
    });

    expect(wonOnly.json().total).toBe(1);
    expect(wonOnly.json().items[0].status).toBe("won");
  });

  it("rejects status in the PATCH body instead of silently applying it without timestamps", async () => {
    const { token } = await registerAccount(app);

    const created = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: { source: LEAD_SOURCE_MISSED_CALL, estimatedValue: 500 },
    });
    const leadId = created.json().id;

    const patched = await app.inject({
      method: "PATCH",
      url: `/leads/${leadId}`,
      headers: authHeader(token),
      payload: { status: "won", notes: "trying to sneak status through" },
    });

    // Zod strips unknown keys by default rather than erroring, so the PATCH
    // succeeds but must NOT move the lead to won or touch wonAt.
    expect(patched.statusCode).toBe(200);
    expect(patched.json().status).toBe("new");
    expect(patched.json().wonAt).toBeNull();
    expect(patched.json().notes).toBe("trying to sneak status through");
  });

  it("only mark-won stamps wonAt and only mark-lost stamps lostAt", async () => {
    const { token } = await registerAccount(app);

    const lead = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: { source: LEAD_SOURCE_MISSED_CALL },
    });
    const leadId = lead.json().id;

    const lost = await app.inject({
      method: "POST",
      url: `/leads/${leadId}/mark-lost`,
      headers: authHeader(token),
    });
    expect(lost.json().status).toBe("lost");
    expect(lost.json().lostAt).not.toBeNull();
    expect(lost.json().wonAt).toBeNull();
    expect(lost.json().contactedAt).toBeNull();
    expect(lost.json().bookedAt).toBeNull();
  });

  it("returns estimatedValue as a JSON number, not a Decimal string, on every lead endpoint", async () => {
    const { token } = await registerAccount(app);

    const created = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: { source: LEAD_SOURCE_MISSED_CALL, estimatedValue: 120.5 },
    });
    expect(created.json().estimatedValue).toBe(120.5);
    expect(typeof created.json().estimatedValue).toBe("number");

    const leadId = created.json().id;

    const fetched = await app.inject({
      method: "GET",
      url: `/leads/${leadId}`,
      headers: authHeader(token),
    });
    expect(typeof fetched.json().estimatedValue).toBe("number");

    const patched = await app.inject({
      method: "PATCH",
      url: `/leads/${leadId}`,
      headers: authHeader(token),
      payload: { estimatedValue: 200 },
    });
    expect(patched.json().estimatedValue).toBe(200);
    expect(typeof patched.json().estimatedValue).toBe("number");

    const listed = await app.inject({
      method: "GET",
      url: "/leads",
      headers: authHeader(token),
    });
    expect(typeof listed.json().items[0].estimatedValue).toBe("number");

    const won = await app.inject({
      method: "POST",
      url: `/leads/${leadId}/mark-won`,
      headers: authHeader(token),
    });
    expect(typeof won.json().estimatedValue).toBe("number");
  });

  it("rejects creating a lead against another business's customer", async () => {
    const { token: tokenA } = await registerAccount(app, { email: "lead-fk-a@example.com" });
    const { token: tokenB } = await registerAccount(app, { email: "lead-fk-b@example.com" });

    const otherCustomer = await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(tokenB),
      payload: { name: "Business B's Customer" },
    });

    const response = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(tokenA),
      payload: { customerId: otherCustomer.json().id, source: LEAD_SOURCE_MISSED_CALL },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
  });

  describe("payment tracking", () => {
    async function createWonLead(app: FastifyInstance, token: string) {
      const created = await app.inject({
        method: "POST",
        url: "/leads",
        headers: authHeader(token),
        payload: { source: LEAD_SOURCE_MISSED_CALL, estimatedValue: 100 },
      });
      const leadId = created.json().id;
      await app.inject({ method: "POST", url: `/leads/${leadId}/mark-won`, headers: authHeader(token) });
      return leadId;
    }

    it("rejects setting payment status before a lead is won", async () => {
      const { token } = await registerAccount(app);
      const created = await app.inject({
        method: "POST",
        url: "/leads",
        headers: authHeader(token),
        payload: { source: LEAD_SOURCE_MISSED_CALL },
      });

      const response = await app.inject({
        method: "PATCH",
        url: `/leads/${created.json().id}/payment`,
        headers: authHeader(token),
        payload: { paymentStatus: "paid", paidAmount: 100 },
      });

      expect(response.statusCode).toBe(409);
    });

    it("requires paidAmount when marking paid", async () => {
      const { token } = await registerAccount(app);
      const leadId = await createWonLead(app, token);

      const response = await app.inject({
        method: "PATCH",
        url: `/leads/${leadId}/payment`,
        headers: authHeader(token),
        payload: { paymentStatus: "paid" },
      });

      expect(response.statusCode).toBe(400);
    });

    it("marks a won lead as paid with an amount", async () => {
      const { token } = await registerAccount(app);
      const leadId = await createWonLead(app, token);

      const response = await app.inject({
        method: "PATCH",
        url: `/leads/${leadId}/payment`,
        headers: authHeader(token),
        payload: { paymentStatus: "paid", paidAmount: 100 },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().paymentStatus).toBe("paid");
      expect(response.json().paidAmount).toBe(100);
    });

    it("clears paidAmount when moved back to unpaid", async () => {
      const { token } = await registerAccount(app);
      const leadId = await createWonLead(app, token);
      await app.inject({
        method: "PATCH",
        url: `/leads/${leadId}/payment`,
        headers: authHeader(token),
        payload: { paymentStatus: "paid", paidAmount: 100 },
      });

      const response = await app.inject({
        method: "PATCH",
        url: `/leads/${leadId}/payment`,
        headers: authHeader(token),
        payload: { paymentStatus: "unpaid" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().paymentStatus).toBe("unpaid");
      expect(response.json().paidAmount).toBeNull();
    });
  });
});
