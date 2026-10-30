import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import { createTestApp, registerAccount, resetDatabase } from "./helpers.js";

// Guest browsing (Apple 5.1.1(v)): /public/marketplace serves the same public
// discovery data as /customer/marketplace without an account, records nothing,
// and exposes no account actions.

async function discoverableBusiness(app: FastifyInstance, name: string) {
  const email = `owner-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const account = await registerAccount(app, { businessName: name, email });
  const business = await prisma.business.update({ where: { id: account.businessId }, data: { industry: "hair salon", description: `${name} does great work` }, select: { id: true, publicSlug: true } });
  await prisma.serviceOffering.create({ data: { businessId: business.id, name: "Signature Cut", durationMinutes: 60, price: 45, publiclyBookable: true } });
  return { slug: business.publicSlug as string, businessId: business.id };
}

describe("public marketplace (guest browsing)", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterEach(resetDatabase);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it("searches and opens a business profile without signing in, and records no search or view", async () => {
    const biz = await discoverableBusiness(app, "Guest Studio");
    const search = await app.inject({ method: "GET", url: "/public/marketplace/search?q=Guest" });
    expect(search.statusCode).toBe(200);
    expect(search.json().items.map((item: { slug: string }) => item.slug)).toContain(biz.slug);

    const profile = await app.inject({ method: "GET", url: `/public/marketplace/businesses/${biz.slug}` });
    expect(profile.statusCode).toBe(200);
    expect(profile.json().name).toBe("Guest Studio");

    expect(await prisma.customerRecentSearch.count()).toBe(0);
    expect(await prisma.customerBusinessView.count()).toBe(0);
  });

  it("serves categories and browse lists without an account", async () => {
    await discoverableBusiness(app, "Browse Barbers");
    for (const url of ["/public/marketplace", "/public/marketplace/categories", "/public/marketplace/featured", "/public/marketplace/search/suggestions?q=Bro", "/public/marketplace/promotions"]) {
      expect((await app.inject({ method: "GET", url })).statusCode, url).toBe(200);
    }
  });

  it("offers no account actions and keeps the signed-in routes protected", async () => {
    const biz = await discoverableBusiness(app, "Locked Lounge");
    for (const [method, url] of [["POST", `/public/marketplace/businesses/${biz.slug}/favourite`], ["POST", `/public/marketplace/businesses/${biz.slug}/report`], ["GET", "/public/marketplace/favourites"], ["GET", "/public/marketplace/search/recent"]] as const) {
      expect((await app.inject({ method, url, payload: method === "POST" ? {} : undefined })).statusCode, url).toBe(404);
    }
    expect((await app.inject({ method: "GET", url: "/customer/marketplace/search?q=Locked" })).statusCode).toBe(401);
  });

  it("returns 404 for a business that is not active", async () => {
    const biz = await discoverableBusiness(app, "Paused Place");
    await prisma.business.update({ where: { id: biz.businessId }, data: { platformStatus: "SUSPENDED" } });
    expect((await app.inject({ method: "GET", url: `/public/marketplace/businesses/${biz.slug}` })).statusCode).toBe(404);
  });
});
