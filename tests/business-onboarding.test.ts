import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { prisma } from "../src/lib/prisma.js";
import { authHeader, createTestApp, registerAccount, resetDatabase } from "./helpers.js";

describe("business onboarding completion", () => {
  let app: FastifyInstance;

  beforeAll(async () => { app = await createTestApp(); });
  afterEach(resetDatabase);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it("rejects completion until the persisted business setup is sufficient", async () => {
    const account = await registerAccount(app);
    const response = await app.inject({ method: "POST", url: "/business/onboarding/complete", headers: authHeader(account.token) });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain("business phone");
  });

  it("persists explicit completion after required setup is saved", async () => {
    const account = await registerAccount(app);
    const setup = await app.inject({
      method: "PATCH",
      url: "/business",
      headers: authHeader(account.token),
      payload: { industry: "salon", phone: "+15551234567", defaultServices: ["Haircut"], workingHours: { summary: "Mon-Fri 09:00-17:00" } },
    });
    expect(setup.statusCode).toBe(200);

    const response = await app.inject({ method: "POST", url: "/business/onboarding/complete", headers: authHeader(account.token) });
    expect(response.statusCode).toBe(200);
    expect(response.json().onboardingCompletedAt).toBeTypeOf("string");
    expect((await prisma.business.findUnique({ where: { id: account.businessId } }))?.onboardingCompletedAt).not.toBeNull();
  });

  it("rejects malformed structured opening times", async () => {
    const account = await registerAccount(app);
    const invalid = await app.inject({ method: "PATCH", url: "/business", headers: authHeader(account.token), payload: {
      workingHours: { version: 1, days: Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map(day => [day, { enabled: true, opensAt: "9am", closesAt: "17:00" }])) },
    } });
    expect(invalid.statusCode).toBe(400);
  });
});
