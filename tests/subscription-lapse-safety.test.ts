import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { config } from "../src/lib/config.js";
import { getPlanLimits, isSubscriptionEntitled, resolveSubscription } from "../src/lib/entitlements.js";
import { resolveApplePlan } from "../src/lib/billing/productCatalog.js";
import { authHeader, createTestApp, registerAccount, resetDatabase } from "./helpers.js";

// Nobody may keep a paid plan without paying for it: a subscription that was
// bought and then lapsed (or a free trial that was cancelled) must fall back
// to Free everywhere a plan gates something.

const DAY_MS = 24 * 60 * 60 * 1000;
const now = new Date("2026-10-29T12:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS);

describe("resolveSubscription", () => {
  it("keeps a paid plan only while the subscription is in an entitled status", () => {
    expect(resolveSubscription(null, now)).toEqual({ plan: "FREE", status: "ACTIVE" });
    expect(resolveSubscription({ plan: "PRO", status: "ACTIVE" }, now)).toEqual({ plan: "PRO", status: "ACTIVE" });
    expect(resolveSubscription({ plan: "STARTER", status: "TRIALING" }, now)).toEqual({ plan: "STARTER", status: "TRIALING" });
    expect(resolveSubscription({ plan: "BUSINESS", status: "GRACE_PERIOD" }, now).plan).toBe("BUSINESS");
    expect(resolveSubscription({ plan: "STARTER", status: "EXPIRED" }, now)).toEqual({ plan: "FREE", status: "EXPIRED" });
    expect(resolveSubscription({ plan: "PRO", status: "CANCELED" }, now)).toEqual({ plan: "FREE", status: "CANCELED" });
  });

  it("treats a store period that ended with no renewal on record as lapsed", () => {
    expect(resolveSubscription({ plan: "PRO", status: "ACTIVE", provider: "APPLE", currentPeriodEnd: daysAgo(2) }, now).plan).toBe("PRO");
    expect(resolveSubscription({ plan: "PRO", status: "ACTIVE", provider: "APPLE", currentPeriodEnd: daysAgo(4) }, now)).toEqual({ plan: "FREE", status: "EXPIRED" });
    expect(resolveSubscription({ plan: "STARTER", status: "TRIALING", provider: "GOOGLE", currentPeriodEnd: daysAgo(4) }, now).plan).toBe("FREE");
    expect(resolveSubscription({ plan: "PRO", status: "GRACE_PERIOD", provider: "GOOGLE", currentPeriodEnd: daysAgo(20) }, now).plan).toBe("PRO");
    expect(resolveSubscription({ plan: "PRO", status: "GRACE_PERIOD", provider: "GOOGLE", currentPeriodEnd: daysAgo(40) }, now).plan).toBe("FREE");
    // Owner-granted complimentary plans have no store period to lapse.
    expect(resolveSubscription({ plan: "BUSINESS", status: "ACTIVE", provider: null, currentPeriodEnd: daysAgo(400) }, now).plan).toBe("BUSINESS");
  });

  it("never entitles a lapsed or missing subscription to any paid feature", () => {
    expect(isSubscriptionEntitled(null, "EXTENDED_HISTORY", now)).toBe(false);
    expect(isSubscriptionEntitled({ plan: "PRO", status: "EXPIRED" }, "ADVANCED_ANALYTICS", now)).toBe(false);
    expect(isSubscriptionEntitled({ plan: "STARTER", status: "CANCELED" }, "EXTENDED_HISTORY", now)).toBe(false);
    expect(isSubscriptionEntitled({ plan: "PRO", status: "ACTIVE" }, "ADVANCED_ANALYTICS", now)).toBe(true);
  });
});

describe("store product catalog", () => {
  it("refuses a product ID configured for two plans instead of granting the higher one", () => {
    const original = config.APPLE_STARTER_MONTHLY_PRODUCT_ID;
    try {
      config.APPLE_STARTER_MONTHLY_PRODUCT_ID = "chakusa_starter_monthly";
      expect(resolveApplePlan("chakusa_starter_monthly")).toBe("STARTER");
      expect(resolveApplePlan("chakusa_pro_monthly")).toBe("PRO");
      config.APPLE_STARTER_MONTHLY_PRODUCT_ID = "chakusa_pro_monthly";
      expect(resolveApplePlan("chakusa_pro_monthly")).toBeNull();
    } finally {
      config.APPLE_STARTER_MONTHLY_PRODUCT_ID = original;
    }
  });
});

describe("lapsed subscriptions over the API", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterEach(resetDatabase);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it("reports a cancelled Starter trial with Free's features and limits", async () => {
    const { token, businessId } = await registerAccount(app);
    await prisma.subscription.update({ where: { businessId }, data: { plan: "STARTER", status: "EXPIRED", provider: "APPLE" } });

    const body = (await app.inject({ method: "GET", url: "/subscription/status", headers: authHeader(token) })).json();
    expect(body.plan).toBe("STARTER");
    expect(body.status).toBe("EXPIRED");
    expect(body.features.extendedHistory).toBe(false);
    expect(body.usage.leads.limit).toBe(getPlanLimits("FREE").leadsPerMonth);
    expect(body.usage.customers.limit).toBe(getPlanLimits("FREE").customers);
  });

  it("enforces Free's lead limit on an expired Pro subscription", async () => {
    const { token, businessId } = await registerAccount(app);
    await prisma.subscription.update({ where: { businessId }, data: { plan: "PRO", status: "EXPIRED", provider: "GOOGLE" } });
    const freeLimit = getPlanLimits("FREE").leadsPerMonth!;
    await prisma.lead.createMany({ data: Array.from({ length: freeLimit }, () => ({ businessId })) });

    const response = await app.inject({ method: "POST", url: "/leads", headers: authHeader(token), payload: {} });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("LIMIT_REACHED");
  });

  it("enforces Free's lead limit when the store period ended with no renewal on record", async () => {
    const { token, businessId } = await registerAccount(app);
    await prisma.subscription.update({ where: { businessId }, data: { plan: "PRO", status: "ACTIVE", provider: "APPLE", currentPeriodEnd: new Date(Date.now() - 10 * DAY_MS) } });
    await prisma.lead.createMany({ data: Array.from({ length: getPlanLimits("FREE").leadsPerMonth! }, () => ({ businessId })) });

    const response = await app.inject({ method: "POST", url: "/leads", headers: authHeader(token), payload: {} });
    expect(response.statusCode).toBe(403);
    const status = (await app.inject({ method: "GET", url: "/subscription/status", headers: authHeader(token) })).json();
    expect(status.status).toBe("EXPIRED");
  });

  it("still lets an active Pro subscription past Free's limit", async () => {
    const { token, businessId } = await registerAccount(app);
    await prisma.subscription.update({ where: { businessId }, data: { plan: "PRO", status: "ACTIVE", provider: "APPLE", currentPeriodEnd: new Date(Date.now() + 10 * DAY_MS) } });
    await prisma.lead.createMany({ data: Array.from({ length: getPlanLimits("FREE").leadsPerMonth! }, () => ({ businessId })) });

    const response = await app.inject({ method: "POST", url: "/leads", headers: authHeader(token), payload: {} });
    expect(response.statusCode).toBe(201);
  });
});
