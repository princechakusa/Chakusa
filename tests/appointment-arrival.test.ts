import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import { authHeader, createTestApp, registerAccount, resetDatabase } from "./helpers.js";

describe("appointment arrival (On My Way / Arrival)", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterEach(resetDatabase);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  async function fixture(email = "arrival@example.com") {
    const account = await registerAccount(app, { email });
    const customer = await prisma.customer.create({ data: { businessId: account.businessId, name: "Pat Customer" } });
    const created = await app.inject({
      method: "POST", url: "/appointments", headers: authHeader(account.token),
      payload: { customerId: customer.id, serviceName: "Haircut", startsAt: "2026-09-01T09:00:00.000Z", endsAt: "2026-09-01T10:00:00.000Z" },
    });
    return { ...account, customer, appointmentId: created.json().id as string };
  }

  it("sets, transitions and clears a GPS-free arrival status", async () => {
    const account = await fixture();
    const headers = authHeader(account.token);

    const onWay = await app.inject({ method: "POST", url: `/appointments/${account.appointmentId}/arrival`, headers, payload: { state: "ON_MY_WAY" } });
    expect(onWay.statusCode).toBe(200);
    expect(onWay.json().arrivalState).toBe("ON_MY_WAY");
    expect(onWay.json().arrivalStateAt).not.toBeNull();

    const arrived = await app.inject({ method: "POST", url: `/appointments/${account.appointmentId}/arrival`, headers, payload: { state: "ARRIVED" } });
    expect(arrived.json().arrivalState).toBe("ARRIVED");

    const cleared = await app.inject({ method: "DELETE", url: `/appointments/${account.appointmentId}/arrival`, headers });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().arrivalState).toBeNull();
    expect(cleared.json().arrivalStateAt).toBeNull();
  });

  it("rejects an unknown arrival state", async () => {
    const account = await fixture("arrival-bad@example.com");
    const res = await app.inject({ method: "POST", url: `/appointments/${account.appointmentId}/arrival`, headers: authHeader(account.token), payload: { state: "PARKING" } });
    expect(res.statusCode).toBe(400);
  });

  it("will not change arrival status on a closed appointment", async () => {
    const account = await fixture("arrival-closed@example.com");
    const headers = authHeader(account.token);
    await app.inject({ method: "POST", url: `/appointments/${account.appointmentId}/status`, headers, payload: { status: "CONFIRMED" } });
    await app.inject({ method: "POST", url: `/appointments/${account.appointmentId}/status`, headers, payload: { status: "COMPLETED" } });
    const res = await app.inject({ method: "POST", url: `/appointments/${account.appointmentId}/arrival`, headers, payload: { state: "ON_MY_WAY" } });
    expect(res.statusCode).toBe(409);
  });

  it("is tenant scoped", async () => {
    const owner = await fixture("arrival-owner@example.com");
    const outsider = await registerAccount(app, { email: "arrival-outsider@example.com" });
    const res = await app.inject({ method: "POST", url: `/appointments/${owner.appointmentId}/arrival`, headers: authHeader(outsider.token), payload: { state: "ARRIVED" } });
    expect(res.statusCode).toBe(404);
  });

  it("does not fabricate a customer notification when messaging is unavailable", async () => {
    const account = await fixture("arrival-notify@example.com");
    const res = await app.inject({
      method: "POST", url: `/appointments/${account.appointmentId}/arrival`,
      headers: authHeader(account.token), payload: { state: "ON_MY_WAY", notifyCustomer: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().arrivalCustomerNotifiedAt).toBeNull();
    const messages = await prisma.message.count({ where: { businessId: account.businessId, messageType: "appointment_on_the_way" } });
    expect(messages).toBe(0);
  });
});
