import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import { applyComplimentaryPlans, parseComplimentaryGrants } from "../src/lib/billing/complimentaryPlans.js";
import { createTestApp, registerAccount, resetDatabase } from "./helpers.js";

let app: FastifyInstance;
beforeAll(async () => { app = await createTestApp(); });
afterEach(async () => { await resetDatabase(); });
afterAll(async () => { await app.close(); await prisma.$disconnect(); });

describe("owner-granted complimentary plans", () => {
  it("parses only well-formed email:PLAN pairs", () => {
    expect(parseComplimentaryGrants(" Owner@Example.com:business , bad, x@y.z:FREE, a@b.co:pro ")).toEqual([
      { email: "owner@example.com", plan: "BUSINESS" },
      { email: "a@b.co", plan: "PRO" },
    ]);
    expect(parseComplimentaryGrants(undefined)).toEqual([]);
  });

  it("raises the listed owner's businesses only, and is idempotent", async () => {
    const owner = await registerAccount(app, { email: "comp-owner@example.com" });
    const other = await registerAccount(app, { email: "someone-else@example.com" });
    expect(await applyComplimentaryPlans("COMP-OWNER@example.com:PRO")).toEqual([{ email: "comp-owner@example.com", businessId: owner.businessId, plan: "PRO" }]);
    expect(await applyComplimentaryPlans("comp-owner@example.com:PRO")).toEqual([]);
    expect((await prisma.subscription.findUniqueOrThrow({ where: { businessId: owner.businessId } })).plan).toBe("PRO");
    expect((await prisma.subscription.findUniqueOrThrow({ where: { businessId: other.businessId } })).plan).toBe("FREE");
  });

  it("never touches a store-managed subscription and never lowers a plan", async () => {
    const store = await registerAccount(app, { email: "store-paid@example.com" });
    await prisma.subscription.update({ where: { businessId: store.businessId }, data: { plan: "PRO", status: "ACTIVE", provider: "APPLE" } });
    const big = await registerAccount(app, { email: "already-business@example.com" });
    await prisma.subscription.update({ where: { businessId: big.businessId }, data: { plan: "BUSINESS", status: "ACTIVE" } });
    expect(await applyComplimentaryPlans("store-paid@example.com:BUSINESS,already-business@example.com:PRO")).toEqual([]);
    expect((await prisma.subscription.findUniqueOrThrow({ where: { businessId: store.businessId } })).plan).toBe("PRO");
    expect((await prisma.subscription.findUniqueOrThrow({ where: { businessId: big.businessId } })).plan).toBe("BUSINESS");
  });
});
