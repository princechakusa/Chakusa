import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { ApiError } from "../src/lib/errors.js";
import { assertUnderLimit, describePlans, getPlanLimits, hasFeature, nextPlan, PLAN_ORDER, planRank } from "../src/lib/entitlements.js";
import { parseComplimentaryGrants } from "../src/lib/billing/complimentaryPlans.js";
import { normalizeAppConfigValue } from "../src/modules/appConfig/appConfig.service.js";
import { createTestApp, resetDatabase } from "./helpers.js";

describe("Starter plan entitlements", () => {
  it("orders plans Free < Starter < Pro < Business and names the next one up", () => {
    expect(PLAN_ORDER).toEqual(["FREE", "STARTER", "PRO", "BUSINESS"]);
    expect(planRank("STARTER")).toBeGreaterThan(planRank("FREE"));
    expect(planRank("PRO")).toBeGreaterThan(planRank("STARTER"));
    expect(nextPlan("FREE")).toBe("STARTER");
    expect(nextPlan("STARTER")).toBe("PRO");
    expect(nextPlan("BUSINESS")).toBe("BUSINESS");
  });

  it("gives Starter roomier limits than Free, but not Pro's unlimited ones", () => {
    const free = getPlanLimits("FREE");
    const starter = getPlanLimits("STARTER");
    for (const key of ["leadsPerMonth", "reviewRequestsPerMonth", "customers", "openReminders", "customTemplatesPerType"] as const) {
      expect(starter[key]).not.toBeNull();
      expect(starter[key]!).toBeGreaterThan(free[key]!);
      expect(getPlanLimits("PRO")[key]).toBeNull();
    }
    expect(starter.staffSeats).toBe(1);
  });

  it("keeps the features that send messages or act on the business's behalf off Starter", () => {
    expect(hasFeature("STARTER", "EXTENDED_HISTORY")).toBe(true);
    expect(hasFeature("STARTER", "ACTIVE", "OUTBOUND_MESSAGING")).toBe(false);
    expect(hasFeature("STARTER", "ACTIVE", "AUTOMATION")).toBe(false);
    expect(hasFeature("STARTER", "ADVANCED_ANALYTICS")).toBe(false);
    expect(hasFeature("PRO", "ADVANCED_ANALYTICS")).toBe(true);
  });

  it("tells someone at a limit which plan to move to", () => {
    const hit = (plan: "FREE" | "STARTER") => {
      try { assertUnderLimit({ plan, resource: "leads", limit: 1, current: 1 }); } catch (error) { return error as ApiError; }
      throw new Error("expected a limit error");
    };
    expect(hit("FREE").details).toMatchObject({ requiredPlan: "STARTER" });
    expect(hit("FREE").message).toBe("Free plan limit reached for leads");
    expect(hit("STARTER").details).toMatchObject({ requiredPlan: "PRO" });
    expect(hit("STARTER").message).toBe("Starter plan limit reached for leads");
  });

  it("accepts Starter in complimentary grants", () => {
    expect(parseComplimentaryGrants("a@b.co:STARTER,c@d.co:PRO")).toEqual([{ email: "a@b.co", plan: "STARTER" }, { email: "c@d.co", plan: "PRO" }]);
  });

  it("describes every plan from the enforcing tables, without unbuilt features", () => {
    const plans = describePlans();
    expect(plans.map((p) => p.plan)).toEqual(PLAN_ORDER);
    expect(plans.find((p) => p.plan === "STARTER")?.limits.leadsPerMonth).toBe(150);
    const business = plans.find((p) => p.plan === "BUSINESS")!;
    expect(business.features.map((f) => f.key)).toContain("TEAM_MANAGEMENT");
    expect(business.features.map((f) => f.key)).not.toContain("INVENTORY");
  });
});

describe("price and trial settings", () => {
  it("validates prices, trial days and currency", () => {
    expect(normalizeAppConfigValue("app.price_starter_monthly", "3")).toBe("3");
    expect(normalizeAppConfigValue("app.price_pro_monthly", "$7.99")).toBe("7.99");
    expect(() => normalizeAppConfigValue("app.price_pro_monthly", "eight")).toThrow();
    expect(() => normalizeAppConfigValue("app.price_pro_monthly", "-1")).toThrow();
    expect(normalizeAppConfigValue("app.trial_days_starter", "7")).toBe("7");
    expect(() => normalizeAppConfigValue("app.trial_days_starter", "400")).toThrow();
    expect(normalizeAppConfigValue("app.price_currency", "eur")).toBe("EUR");
    expect(() => normalizeAppConfigValue("app.price_currency", "EURO")).toThrow();
  });
});

describe("public pricing endpoints", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  beforeEach(resetDatabase);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it("serves the default reference prices and trials in /app-config", async () => {
    const body = (await app.inject({ method: "GET", url: "/app-config" })).json();
    expect(body.pricing).toEqual({ currency: "USD", monthly: { STARTER: 3, PRO: 8, BUSINESS: 13 }, trialDays: { STARTER: 7, PRO: 0, BUSINESS: 0 } });
  });

  it("tells the apps whether the API can send SMS/WhatsApp at all", async () => {
    const body = (await app.inject({ method: "GET", url: "/app-config" })).json();
    // The test environment configures no sender, so the apps must prepare messages instead.
    expect(body.features.outboundMessaging).toBe(false);
  });

  it("serves /plans with limits, features and the configured prices, reflecting admin changes", async () => {
    await prisma.platformSetting.create({ data: { key: "app.price_pro_monthly", value: "9.5" } });
    const res = await app.inject({ method: "GET", url: "/plans", headers: { origin: "https://chakusarecovery.com" } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeTruthy();
    const body = res.json();
    expect(body.currency).toBe("USD");
    expect(body.plans.map((p: { plan: string }) => p.plan)).toEqual(["FREE", "STARTER", "PRO", "BUSINESS"]);
    const byPlan = Object.fromEntries(body.plans.map((p: { plan: string }) => [p.plan, p]));
    expect(byPlan.FREE).toMatchObject({ referenceMonthlyPrice: 0, trialDays: 0 });
    expect(byPlan.STARTER).toMatchObject({ referenceMonthlyPrice: 3, trialDays: 7 });
    expect(byPlan.PRO).toMatchObject({ referenceMonthlyPrice: 9.5 });
    expect(byPlan.BUSINESS).toMatchObject({ referenceMonthlyPrice: 13 });
    expect(byPlan.PRO.features.map((f: { key: string }) => f.key)).toContain("AUTOMATION");
  });
});
