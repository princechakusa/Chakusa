import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { config } from "../src/lib/config.js";
import { prisma } from "../src/lib/prisma.js";
import { createTestApp, registerAccount, resetDatabase } from "./helpers.js";
import { deriveBusinessKnowledge } from "../src/lib/ai/memory/knowledgeSources.js";

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function registerCustomer(app: FastifyInstance, over: Partial<{ email: string; fullName: string }> = {}) {
  const email = over.email ?? `cust-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const res = await app.inject({ method: "POST", url: "/customer/auth/register", payload: { email, password: "password123", fullName: over.fullName ?? "Casey Customer" } });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.body}`);
  const body = res.json();
  return { email, token: body.accessToken as string, profileId: body.profile.id as string, userId: body.user.id as string };
}

/** Registers a business account and returns its id + generated public slug, with industry applied. */
async function registerBusiness(app: FastifyInstance, businessName: string, industry: string) {
  const account = await registerAccount(app, { businessName });
  const business = await prisma.business.update({ where: { id: account.businessId }, data: { industry }, select: { id: true, publicSlug: true } });
  return { ...account, id: business.id, slug: business.publicSlug as string };
}

async function admin(app: FastifyInstance) {
  const email = `mkt-admin-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const account = await registerAccount(app, { email, password: "admin-password-123", businessName: "Admin Co" });
  await prisma.adminMembership.create({ data: { userId: account.userId, role: "SUPER_ADMIN" } });
  const login = await app.inject({ method: "POST", url: "/admin/auth/login", payload: { email, password: "admin-password-123" } });
  if (login.statusCode !== 200) throw new Error(`admin login ${login.statusCode}: ${login.body}`);
  const token = login.json().accessToken as string;
  const csrf = login.json().csrfToken as string;
  return { headers: { authorization: `Bearer ${token}` }, write: { authorization: `Bearer ${token}`, origin: "http://localhost:5173", "x-csrf-token": csrf } };
}

async function adminWithRole(app: FastifyInstance, role: string) {
  const email = `mkt-admin-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const account = await registerAccount(app, { email, password: "admin-password-123", businessName: `Role ${role}` });
  await prisma.adminMembership.create({ data: { userId: account.userId, role: role as never } });
  const login = await app.inject({ method: "POST", url: "/admin/auth/login", payload: { email, password: "admin-password-123" } });
  const token = login.json().accessToken as string;
  const csrf = login.json().csrfToken as string;
  return { headers: { authorization: `Bearer ${token}` }, write: { authorization: `Bearer ${token}`, origin: "http://localhost:5173", "x-csrf-token": csrf } };
}

describe("Marketplace & Business Discovery (Program 2, Loop 2)", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    config.ADMIN_CONSOLE_ENABLED = true;
    app = await createTestApp();
  });
  afterEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    config.ADMIN_CONSOLE_ENABLED = false;
    await app.close();
    await prisma.$disconnect();
  });

  describe("discovery", () => {
    it("browses businesses with zero marketplace curation and hides suspended ones", async () => {
      const salon = await registerBusiness(app, "Bloom Hair Salon", "hair salon");
      const suspended = await registerBusiness(app, "Ghost Studio", "spa");
      await prisma.business.update({ where: { id: suspended.id }, data: { platformStatus: "SUSPENDED" } });
      const customer = await registerCustomer(app);

      const res = await app.inject({ method: "GET", url: "/customer/marketplace", headers: auth(customer.token) });
      expect(res.statusCode).toBe(200);
      const slugs = res.json().items.map((item: { slug: string }) => item.slug);
      expect(slugs).toContain(salon.slug);
      expect(slugs).not.toContain(suspended.slug);
    });

    it("requires a customer session", async () => {
      const res = await app.inject({ method: "GET", url: "/customer/marketplace" });
      expect([401, 403]).toContain(res.statusCode);
    });

    it("supports featured, recent, popular and verified modes", async () => {
      const a = await registerBusiness(app, "Featured Cuts", "barber");
      const b = await registerBusiness(app, "Popular Nails", "nail salon");
      const c = await registerBusiness(app, "Verified Spa", "spa");
      await prisma.business.update({ where: { id: c.id }, data: { verifiedAt: new Date() } });
      await prisma.businessMarketplaceListing.create({ data: { businessId: a.id, listed: true, discoverable: true, featured: true, featuredRank: 1 } });
      await prisma.businessMarketplaceListing.create({ data: { businessId: b.id, listed: true, discoverable: true, favouriteCount: 25, viewCount: 200 } });
      const customer = await registerCustomer(app);

      const featured = await app.inject({ method: "GET", url: "/customer/marketplace/featured", headers: auth(customer.token) }).then((r) => r.json());
      expect(featured.items.map((i: { slug: string }) => i.slug)).toEqual([a.slug]);

      const popular = await app.inject({ method: "GET", url: "/customer/marketplace/popular", headers: auth(customer.token) }).then((r) => r.json());
      expect(popular.items[0].slug).toBe(b.slug);

      const verified = await app.inject({ method: "GET", url: "/customer/marketplace/verified", headers: auth(customer.token) }).then((r) => r.json());
      expect(verified.items.map((i: { slug: string }) => i.slug)).toEqual([c.slug]);

      const recent = await app.inject({ method: "GET", url: "/customer/marketplace/recent", headers: auth(customer.token) }).then((r) => r.json());
      expect(recent.items[0].slug).toBe(c.slug); // newest first
    });

    it("filters nearby by bounding box", async () => {
      const near = await registerBusiness(app, "Corner Barber", "barber");
      const far = await registerBusiness(app, "Distant Barber", "barber");
      await prisma.businessMarketplaceListing.create({ data: { businessId: near.id, listed: true, discoverable: true, latitude: 51.5, longitude: -0.12, city: "London" } });
      await prisma.businessMarketplaceListing.create({ data: { businessId: far.id, listed: true, discoverable: true, latitude: 40.7, longitude: -74, city: "New York" } });
      const customer = await registerCustomer(app);

      const res = await app.inject({ method: "GET", url: "/customer/marketplace/nearby?lat=51.51&lng=-0.13&radiusKm=10", headers: auth(customer.token) }).then((r) => r.json());
      const slugs = res.items.map((i: { slug: string }) => i.slug);
      expect(slugs).toContain(near.slug);
      expect(slugs).not.toContain(far.slug);
    });
  });

  describe("categories", () => {
    it("seeds industry categories with subcategories, trending flags and counts", async () => {
      const hair = await registerBusiness(app, "Count Hair", "hair salon");
      expect(hair.slug).toBeTruthy();
      const customer = await registerCustomer(app);
      const a = await admin(app);
      await app.inject({ method: "POST", url: "/admin/marketplace/categories/seed", headers: a.write });

      const res = await app.inject({ method: "GET", url: "/customer/marketplace/categories", headers: auth(customer.token) }).then((r) => r.json());
      const beauty = res.categories.find((c: { slug: string }) => c.slug === "beauty");
      expect(beauty).toBeTruthy();
      expect(beauty.children.map((c: { slug: string }) => c.slug)).toContain("hair");
      expect(res.trending.some((c: { slug: string }) => c.slug === "beauty")).toBe(true);
      const hairCat = beauty.children.find((c: { slug: string }) => c.slug === "hair");
      expect(hairCat.businessCount).toBeGreaterThanOrEqual(1);
    });

    it("returns businesses for a category slug", async () => {
      const salon = await registerBusiness(app, "Slug Salon", "hair salon");
      const gym = await registerBusiness(app, "Slug Gym", "gym");
      const customer = await registerCustomer(app);
      const res = await app.inject({ method: "GET", url: "/customer/marketplace/categories/hair", headers: auth(customer.token) }).then((r) => r.json());
      const slugs = res.items.map((i: { slug: string }) => i.slug);
      expect(slugs).toContain(salon.slug);
      expect(slugs).not.toContain(gym.slug);
    });
  });

  describe("search", () => {
    it("searches by business name and records recent searches", async () => {
      const salon = await registerBusiness(app, "Aurora Beauty Bar", "beauty salon");
      await registerBusiness(app, "Unrelated Plumbing", "plumber");
      const customer = await registerCustomer(app);

      const res = await app.inject({ method: "GET", url: "/customer/marketplace/search?q=Aurora", headers: auth(customer.token) }).then((r) => r.json());
      expect(res.items.map((i: { slug: string }) => i.slug)).toEqual([salon.slug]);

      const recent = await app.inject({ method: "GET", url: "/customer/marketplace/search/recent", headers: auth(customer.token) }).then((r) => r.json());
      expect(recent.some((row: { query: string }) => row.query === "Aurora")).toBe(true);
    });

    it("searches by service name", async () => {
      const salon = await registerBusiness(app, "Service Search Salon", "hair salon");
      await prisma.serviceOffering.create({ data: { businessId: salon.id, name: "Balayage Highlights", durationMinutes: 90, active: true } });
      const customer = await registerCustomer(app);
      const res = await app.inject({ method: "GET", url: "/customer/marketplace/search?q=Balayage", headers: auth(customer.token) }).then((r) => r.json());
      expect(res.items.map((i: { slug: string }) => i.slug)).toContain(salon.slug);
    });

    it("returns suggestions for a prefix", async () => {
      const salon = await registerBusiness(app, "Suggestible Salon", "hair salon");
      expect(salon.slug).toBeTruthy();
      const customer = await registerCustomer(app);
      const res = await app.inject({ method: "GET", url: "/customer/marketplace/search/suggestions?q=Sugg", headers: auth(customer.token) }).then((r) => r.json());
      expect(res.businesses.some((b: { name: string }) => b.name === "Suggestible Salon")).toBe(true);
    });
  });

  describe("business profile", () => {
    it("returns about, services, team, promotions, reviews summary and viewer flags — no booking data", async () => {
      const salon = await registerBusiness(app, "Profile Palace", "spa");
      await prisma.business.update({ where: { id: salon.id }, data: { description: "A calm retreat", phone: "+15550001111", verifiedAt: new Date() } });
      await prisma.serviceOffering.create({ data: { businessId: salon.id, name: "Deep Tissue Massage", durationMinutes: 60, price: 80, active: true } });
      await prisma.marketplacePromotion.create({ data: { businessId: salon.id, title: "Spring Offer", badge: "-20%", active: true } });
      const reviewer = await prisma.customer.create({ data: { businessId: salon.id, name: "Rev", phone: "+15550002222", phoneE164: "+15550002222" } });
      await prisma.feedback.create({ data: { businessId: salon.id, customerId: reviewer.id, rating: 5, comment: "Wonderful", sentiment: "positive" } });
      const customer = await registerCustomer(app);

      const res = await app.inject({ method: "GET", url: `/customer/marketplace/businesses/${salon.slug}`, headers: auth(customer.token) });
      expect(res.statusCode).toBe(200);
      const profile = res.json();
      expect(profile.about).toBe("A calm retreat");
      expect(profile.contact.phone).toBe("+15550001111");
      expect(profile.services[0].name).toBe("Deep Tissue Massage");
      expect(profile.promotions[0].title).toBe("Spring Offer");
      expect(profile.reviewsSummary.averageRating).toBe(5);
      expect(profile.reviewsSummary.totalReviews).toBe(1);
      expect(profile.viewer).toEqual({ favourite: false, following: false });
      // no booking surface
      expect(profile).not.toHaveProperty("availability");
      expect(profile).not.toHaveProperty("slots");
      // a view was recorded
      expect(await prisma.customerBusinessView.count({ where: { customerProfileId: customer.profileId } })).toBe(1);
    });

    it("404s for a non-discoverable business", async () => {
      const salon = await registerBusiness(app, "Hidden Palace", "spa");
      await prisma.businessMarketplaceListing.create({ data: { businessId: salon.id, listed: false, discoverable: false } });
      const customer = await registerCustomer(app);
      const res = await app.inject({ method: "GET", url: `/customer/marketplace/businesses/${salon.slug}`, headers: auth(customer.token) });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("customer features", () => {
    it("favourites, follows, reports, shares and lists recently viewed", async () => {
      const salon = await registerBusiness(app, "Feature Salon", "hair salon");
      const customer = await registerCustomer(app);

      const fav = await app.inject({ method: "POST", url: `/customer/marketplace/businesses/${salon.slug}/favourite`, headers: auth(customer.token), payload: { favourite: true } });
      expect(fav.statusCode).toBe(200);
      expect(fav.json().favouriteCount).toBe(1);
      const favourites = await app.inject({ method: "GET", url: "/customer/marketplace/favourites", headers: auth(customer.token) }).then((r) => r.json());
      expect(favourites.map((b: { slug: string }) => b.slug)).toContain(salon.slug);

      const follow = await app.inject({ method: "POST", url: `/customer/marketplace/businesses/${salon.slug}/follow`, headers: auth(customer.token), payload: { follow: true } });
      expect(follow.json()).toMatchObject({ following: true, followerCount: 1 });
      const following = await app.inject({ method: "GET", url: "/customer/marketplace/following", headers: auth(customer.token) }).then((r) => r.json());
      expect(following.map((b: { slug: string }) => b.slug)).toContain(salon.slug);

      const report = await app.inject({ method: "POST", url: `/customer/marketplace/businesses/${salon.slug}/report`, headers: auth(customer.token), payload: { reason: "wrong_info", detail: "Address is outdated" } });
      expect(report.statusCode).toBe(201);
      expect(await prisma.businessReport.count({ where: { businessId: salon.id, status: "OPEN" } })).toBe(1);

      const share = await app.inject({ method: "GET", url: `/customer/marketplace/businesses/${salon.slug}/share`, headers: auth(customer.token) }).then((r) => r.json());
      expect(share.shareUrl).toContain(`/b/${salon.slug}`);

      await app.inject({ method: "GET", url: `/customer/marketplace/businesses/${salon.slug}`, headers: auth(customer.token) });
      const recent = await app.inject({ method: "GET", url: "/customer/marketplace/recently-viewed", headers: auth(customer.token) }).then((r) => r.json());
      expect(recent.map((b: { slug: string }) => b.slug)).toContain(salon.slug);
    });
  });

  describe("AI integration (reuses LOOP 3 memory platform)", () => {
    it("derives marketplace category and active promotions into business knowledge", async () => {
      const salon = await registerBusiness(app, "AI Knowledge Salon", "hair salon");
      await prisma.businessMarketplaceListing.create({ data: { businessId: salon.id, listed: true, discoverable: true, categorySlug: "hair", shortTagline: "Colour specialists" } });
      await prisma.marketplacePromotion.create({ data: { businessId: salon.id, title: "New client 15% off", active: true } });

      const items = await deriveBusinessKnowledge(salon.id);
      expect(items.some((i) => i.kind === "marketplace_listing" && i.content.includes("hair"))).toBe(true);
      expect(items.some((i) => i.kind === "marketplace_promotion" && i.title === "New client 15% off")).toBe(true);
    });

    it("exposes customer favourites in the customer AI context", async () => {
      const salon = await registerBusiness(app, "Context Salon", "hair salon");
      const customer = await registerCustomer(app);
      await app.inject({ method: "POST", url: `/customer/marketplace/businesses/${salon.slug}/favourite`, headers: auth(customer.token), payload: { favourite: true } });

      const ctx = await app.inject({ method: "GET", url: "/customer/ai/context", headers: auth(customer.token) }).then((r) => r.json());
      expect(ctx.favouriteBusinesses.map((b: { slug: string }) => b.slug)).toContain(salon.slug);
    });
  });

  describe("admin", () => {
    it("manages listings, featured status, categories, promotions, reports and analytics with RBAC + audit", async () => {
      const salon = await registerBusiness(app, "Admin Target Salon", "hair salon");
      const a = await admin(app);

      const list = await app.inject({ method: "GET", url: "/admin/marketplace/listings", headers: a.headers });
      expect(list.statusCode).toBe(200);
      expect(list.json().items.some((row: { businessId: string }) => row.businessId === salon.id)).toBe(true);

      const feature = await app.inject({ method: "PATCH", url: `/admin/marketplace/listings/${salon.id}`, headers: a.write, payload: { featured: true, featuredRank: 1, categorySlug: null } });
      expect(feature.statusCode).toBe(200);
      expect(feature.json().featured).toBe(true);
      expect(await prisma.adminAuditLog.count({ where: { action: "MARKETPLACE_LISTING_UPDATED", targetId: salon.id } })).toBe(1);

      await app.inject({ method: "POST", url: "/admin/marketplace/categories/seed", headers: a.write });
      const upsert = await app.inject({ method: "POST", url: "/admin/marketplace/categories", headers: a.write, payload: { slug: "mobile-detailing", name: "Mobile Detailing", parentSlug: "auto", trending: true } });
      expect(upsert.statusCode).toBe(201);

      const promo = await app.inject({ method: "POST", url: "/admin/marketplace/promotions", headers: a.write, payload: { businessId: salon.id, title: "Featured launch promo" } });
      expect(promo.statusCode).toBe(201);
      const promoId = promo.json().id;
      await app.inject({ method: "PATCH", url: `/admin/marketplace/promotions/${promoId}`, headers: a.write, payload: { active: false } });
      expect((await prisma.marketplacePromotion.findUniqueOrThrow({ where: { id: promoId } })).active).toBe(false);

      const reporter = await registerCustomer(app);
      await app.inject({ method: "POST", url: `/customer/marketplace/businesses/${salon.slug}/report`, headers: auth(reporter.token), payload: { reason: "spam" } });
      const reports = await app.inject({ method: "GET", url: "/admin/marketplace/reports?status=OPEN", headers: a.headers }).then((r) => r.json());
      expect(reports.items).toHaveLength(1);
      const resolve = await app.inject({ method: "PATCH", url: `/admin/marketplace/reports/${reports.items[0].id}`, headers: a.write, payload: { status: "RESOLVED" } });
      expect(resolve.statusCode).toBe(200);
      expect(await prisma.adminAuditLog.count({ where: { action: "MARKETPLACE_REPORT_RESOLVED" } })).toBe(1);

      const analytics = await app.inject({ method: "GET", url: "/admin/marketplace/analytics", headers: a.headers }).then((r) => r.json());
      expect(analytics.featuredBusinesses).toBeGreaterThanOrEqual(1);
      expect(analytics).toHaveProperty("businessesByCategory");
    });

    it("enforces marketplace.manage — a READ_ONLY admin can read but not curate", async () => {
      const salon = await registerBusiness(app, "RBAC Salon", "hair salon");
      const ro = await adminWithRole(app, "READ_ONLY");

      const read = await app.inject({ method: "GET", url: "/admin/marketplace/listings", headers: ro.headers });
      expect(read.statusCode).toBe(200);

      const denied = await app.inject({ method: "PATCH", url: `/admin/marketplace/listings/${salon.id}`, headers: ro.write, payload: { featured: true } });
      expect(denied.statusCode).toBe(403);
    });
  });
});
