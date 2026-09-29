import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import { authHeader, createTestApp, registerAccount, resetDatabase } from "./helpers.js";

// Loyalty management writes must stay inside the caller's business and within
// the same bounds as create, including on PATCH.
describe("loyalty management validation", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterEach(resetDatabase);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  async function business(name: string) {
    const account = await registerAccount(app, { email: `${name.toLowerCase().replace(/\W/g, "")}-${Date.now()}@example.com`, businessName: name });
    const service = await prisma.serviceOffering.create({ data: { businessId: account.businessId, name: `${name} cut`, durationMinutes: 30, price: 20 } });
    return { ...account, serviceId: service.id, h: authHeader(account.token) };
  }

  it("membership plans cannot include another business's services (create or update)", async () => {
    const a = await business("Alpha");
    const b = await business("Beta");
    const create = await app.inject({ method: "POST", url: "/loyalty/membership-plans", headers: a.h, payload: { name: "Gold", billingInterval: "monthly", priceAmount: 30, includedServiceIds: [b.serviceId] } });
    expect(create.statusCode).toBe(400);
    const ok = await app.inject({ method: "POST", url: "/loyalty/membership-plans", headers: a.h, payload: { name: "Gold", billingInterval: "monthly", priceAmount: 30, includedServiceIds: [a.serviceId] } });
    expect(ok.statusCode).toBe(201);
    const patch = await app.inject({ method: "PATCH", url: `/loyalty/membership-plans/${ok.json().id}`, headers: a.h, payload: { includedServiceIds: [a.serviceId, b.serviceId] } });
    expect(patch.statusCode).toBe(400);
  });

  it("campaigns cannot reference another business's reward", async () => {
    const a = await business("Gamma");
    const b = await business("Delta");
    const foreignReward = await app.inject({ method: "POST", url: "/loyalty/rewards", headers: b.h, payload: { name: "Free", type: "promo", pointsCost: 10 } }).then((r) => r.json());
    const res = await app.inject({ method: "POST", url: "/loyalty/campaigns", headers: a.h, payload: { name: "Double", kind: "bonus_reward", rewardId: foreignReward.id, startsAt: "2026-10-01T00:00:00.000Z", endsAt: "2026-10-31T00:00:00.000Z" } });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH bodies are bounded like create; mobile's extra fields are ignored", async () => {
    const a = await business("Epsilon");
    const reward = await app.inject({ method: "POST", url: "/loyalty/rewards", headers: a.h, payload: { name: "Free", type: "promo", pointsCost: 10 } }).then((r) => r.json());
    for (const payload of [{ pointsCost: -5 }, { pointsCost: "lots" }, { startsAt: "not-a-date" }, { name: "" }]) {
      expect((await app.inject({ method: "PATCH", url: `/loyalty/rewards/${reward.id}`, headers: a.h, payload })).statusCode, JSON.stringify(payload)).toBe(400);
    }
    const edited = await app.inject({ method: "PATCH", url: `/loyalty/rewards/${reward.id}`, headers: a.h, payload: { name: "Free coffee", type: "promo", serviceOfferingId: a.serviceId, pointsCost: 20 } });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({ name: "Free coffee", pointsCost: 20 });

    const plan = await app.inject({ method: "POST", url: "/loyalty/membership-plans", headers: a.h, payload: { name: "Silver", billingInterval: "monthly", priceAmount: 10 } }).then((r) => r.json());
    expect((await app.inject({ method: "PATCH", url: `/loyalty/membership-plans/${plan.id}`, headers: a.h, payload: { discountPercent: 150 } })).statusCode).toBe(400);

    const campaign = await app.inject({ method: "POST", url: "/loyalty/campaigns", headers: a.h, payload: { name: "Boost", startsAt: "2026-10-01T00:00:00.000Z", endsAt: "2026-10-31T00:00:00.000Z" } }).then((r) => r.json());
    expect((await app.inject({ method: "PATCH", url: `/loyalty/campaigns/${campaign.id}`, headers: a.h, payload: { endsAt: "2026-09-01T00:00:00.000Z" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: `/loyalty/campaigns/${campaign.id}`, headers: a.h, payload: { multiplier: 50 } })).statusCode).toBe(400);
  });
});
