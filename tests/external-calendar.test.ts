import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import { authHeader, createTestApp, registerAccount, resetDatabase } from "./helpers.js";

describe("external calendar subscriptions", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterEach(resetDatabase);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it("creates a one-time secret, publishes a minimal feed, and revokes it", async () => {
    const account = await registerAccount(app, { email: "calendar-feed@example.com" });
    const headers = authHeader(account.token);
    const create = await app.inject({ method: "POST", url: "/calendar/subscriptions", headers, payload: { label: "Studio calendar" } });
    expect(create.statusCode).toBe(201);
    const created = create.json();
    expect(created.token).toMatch(/^[^.]+\.[^.]+$/);
    expect(created.feedUrl).toContain(`/public/calendar/${created.token}.ics`);
    expect(await prisma.externalCalendarSubscription.findUnique({ where: { id: created.id } })).toMatchObject({ tokenHash: expect.any(String), tokenId: created.id });

    const now = new Date();
    const customer = await prisma.customer.create({ data: { businessId: account.businessId, name: "Private Customer", phone: "+15551234567", email: "private@example.com" } });
    await prisma.appointment.create({ data: { businessId: account.businessId, customerId: customer.id, createdByUserId: account.userId, serviceName: "Consultation, premium", startsAt: new Date(now.getTime() + 3_600_000), endsAt: new Date(now.getTime() + 7_200_000), notes: "PRIVATE CUSTOMER NOTES" } });
    const feed = await app.inject({ method: "GET", url: `/public/calendar/${created.token}.ics` });
    expect(feed.statusCode).toBe(200);
    expect(feed.headers["content-type"]).toContain("text/calendar");
    expect(feed.body).toContain("Consultation\\, premium");
    expect(feed.body).toContain("Studio");
    expect(feed.body).not.toContain("Private Customer");
    expect(feed.body).not.toContain("private@example.com");
    expect(feed.body).not.toContain("PRIVATE CUSTOMER NOTES");

    const revoke = await app.inject({ method: "POST", url: `/calendar/subscriptions/${created.id}/revoke`, headers });
    expect(revoke.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/public/calendar/${created.token}.ics` })).statusCode).toBe(404);
  });

  it("does not expose token hashes and rejects malformed or unknown links", async () => {
    const account = await registerAccount(app, { email: "calendar-list@example.com" });
    const create = await app.inject({ method: "POST", url: "/calendar/subscriptions", headers: authHeader(account.token) });
    const list = await app.inject({ method: "GET", url: "/calendar/subscriptions", headers: authHeader(account.token) });
    expect(list.statusCode).toBe(200);
    expect(list.json()[0]).not.toHaveProperty("tokenHash");
    expect((await app.inject({ method: "GET", url: "/public/calendar/not-a-token.ics" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/public/calendar/00000000-0000-0000-0000-000000000000.secret.ics" })).statusCode).toBe(404);
    expect(create.json()).not.toHaveProperty("tokenHash");
  });
});
