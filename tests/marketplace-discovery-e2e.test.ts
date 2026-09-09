import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import { createTestApp, registerAccount, resetDatabase } from "./helpers.js";

// #19 Marketplace & Discovery Completion — the completion criterion:
// "customer discovery -> business -> service -> availability -> booking E2E,
//  tenant/public-data boundaries, performance tests."

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const openEveryDay = { version: 1, days: Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => [d, { enabled: true, opensAt: "00:00", closesAt: "23:59" }])) };

function futureSlot(days = 7, hourUtc = 10): string {
  const date = new Date(Date.now() + days * 86_400_000);
  date.setUTCHours(hourUtc, 0, 0, 0);
  return date.toISOString();
}

async function registerCustomer(app: FastifyInstance) {
  const email = `cust-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const res = await app.inject({ method: "POST", url: "/customer/auth/register", payload: { email, password: "password123", fullName: "Casey Customer" } });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.body}`);
  const body = res.json();
  return { token: body.accessToken as string, profileId: body.profile.id as string };
}

/** A discoverable business with open hours, one member and one publicly bookable service. */
async function discoverableBusiness(app: FastifyInstance, name: string, industry = "hair salon") {
  const email = `owner-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const account = await registerAccount(app, { businessName: name, email });
  const business = await prisma.business.update({
    where: { id: account.businessId },
    data: { timezone: "UTC", workingHours: openEveryDay, bookingMinNoticeMinutes: 0, bookingWindowDays: 365, cancellationNoticeMinutes: 0, defaultAppointmentReminderMinutes: 1440, industry, description: `${name} does great work` },
    select: { id: true, publicSlug: true },
  });
  const member = await prisma.businessMember.findFirstOrThrow({ where: { businessId: business.id } });
  const service = await prisma.serviceOffering.create({ data: { businessId: business.id, name: "Signature Cut", durationMinutes: 60, price: 45, publiclyBookable: true } });
  return { ...account, email, slug: business.publicSlug as string, businessId: business.id, memberId: member.id, serviceId: service.id };
}

describe("marketplace discovery -> booking (#19)", () => {
  let app: FastifyInstance;
  let queryCount = 0;
  let counting = false;

  beforeAll(async () => {
    app = await createTestApp();
    prisma.$use(async (params, next) => {
      if (counting) queryCount += 1;
      return next(params);
    });
  });
  afterEach(resetDatabase);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it("a customer discovers a business, reads its profile, checks real availability and books", async () => {
    const biz = await discoverableBusiness(app, "Northside Studio");
    const customer = await registerCustomer(app);
    const startsAt = futureSlot();

    // 1. discovery — the business is found and advertises online booking
    const search = await app.inject({ method: "GET", url: "/customer/marketplace/search?q=Northside", headers: auth(customer.token) }).then((r) => r.json());
    const card = search.items.find((i: { slug: string }) => i.slug === biz.slug);
    expect(card).toBeTruthy();
    expect(card.acceptsOnlineBooking).toBe(true);

    // 2. business profile — public fields + the bookable service
    const profile = await app.inject({ method: "GET", url: `/customer/marketplace/businesses/${biz.slug}`, headers: auth(customer.token) }).then((r) => r.json());
    expect(profile.acceptsOnlineBooking).toBe(true);
    const service = profile.services.find((s: { bookable: boolean }) => s.bookable);
    expect(service.name).toBe("Signature Cut");

    // 3. availability — real slots from the availability engine
    const from = new Date(new Date(startsAt).getTime() - 3_600_000).toISOString();
    const to = new Date(new Date(startsAt).getTime() + 3_600_000).toISOString();
    const availability = await app.inject({ method: "GET", url: `/customer/bookings/businesses/${biz.slug}/availability?serviceOfferingId=${service.id}&from=${from}&to=${to}`, headers: auth(customer.token) }).then((r) => r.json());
    expect(availability.slots.some((s: { startsAt: string }) => s.startsAt === startsAt)).toBe(true);

    // 4. booking — persisted, attributed to the customer, visible in their calendar
    const booked = await app.inject({ method: "POST", url: "/customer/bookings", headers: auth(customer.token), payload: { slug: biz.slug, serviceOfferingId: service.id, startsAt } });
    expect(booked.statusCode).toBe(201);
    expect(booked.json().appointment.bookedByCustomerProfileId).toBe(customer.profileId);

    const mine = await app.inject({ method: "GET", url: "/customer/bookings?scope=upcoming", headers: auth(customer.token) }).then((r) => r.json());
    expect(mine.map((b: { serviceName: string }) => b.serviceName)).toContain("Signature Cut");
  });

  it("discovery exposes only public data and never another tenant's or the owner's private fields", async () => {
    const shown = await discoverableBusiness(app, "Public Face");
    const hiddenSuspended = await discoverableBusiness(app, "Suspended Co");
    await prisma.business.update({ where: { id: hiddenSuspended.businessId }, data: { platformStatus: "SUSPENDED" } });
    const hiddenUnlisted = await discoverableBusiness(app, "Unlisted Co");
    await prisma.businessMarketplaceListing.create({ data: { businessId: hiddenUnlisted.businessId, listed: false, discoverable: false } });
    const customer = await registerCustomer(app);

    const list = await app.inject({ method: "GET", url: "/customer/marketplace", headers: auth(customer.token) }).then((r) => r.json());
    const slugs = list.items.map((i: { slug: string }) => i.slug);
    expect(slugs).toContain(shown.slug);
    expect(slugs).not.toContain(hiddenSuspended.slug);
    expect(slugs).not.toContain(hiddenUnlisted.slug);

    const serialized = JSON.stringify(list.items.find((i: { slug: string }) => i.slug === shown.slug));
    expect(serialized).not.toContain(shown.email); // owner account email never leaks onto a card

    const profile = await app.inject({ method: "GET", url: `/customer/marketplace/businesses/${shown.slug}`, headers: auth(customer.token) }).then((r) => r.json());
    for (const key of ["ownerId", "subscription", "stripeCustomerId", "platformStatus", "internalNotes"]) {
      expect(profile).not.toHaveProperty(key);
    }
    expect(JSON.stringify(profile)).not.toContain(shown.email);

    // a non-discoverable business 404s on its profile
    expect((await app.inject({ method: "GET", url: `/customer/marketplace/businesses/${hiddenUnlisted.slug}`, headers: auth(customer.token) })).statusCode).toBe(404);
  });

  it("the customer marketplace rejects a non-customer (business) session", async () => {
    const biz = await discoverableBusiness(app, "Guarded Co");
    const res = await app.inject({ method: "GET", url: "/customer/marketplace", headers: auth(biz.token) });
    expect([401, 403]).toContain(res.statusCode);
  });

  it("discovery query volume is bounded and does not grow with the result count (no N+1)", async () => {
    const make = async (n: number, prefix: string) => {
      for (let i = 0; i < n; i += 1) {
        const b = await discoverableBusiness(app, `${prefix} ${i}`, "hair salon");
        await prisma.businessMarketplaceListing.create({ data: { businessId: b.businessId, listed: true, discoverable: true, favouriteCount: i, viewCount: i * 3, categorySlug: "hair" } });
        const reviewer = await prisma.customer.create({ data: { businessId: b.businessId, name: "R", phone: `+1600000${i.toString().padStart(4, "0")}`, phoneE164: `+1600000${i.toString().padStart(4, "0")}` } });
        await prisma.feedback.create({ data: { businessId: b.businessId, customerId: reviewer.id, rating: 4, comment: "good" } });
      }
    };

    const customer = await registerCustomer(app);
    const measure = async (limit: number) => {
      queryCount = 0;
      counting = true;
      const res = await app.inject({ method: "GET", url: `/customer/marketplace?limit=${limit}`, headers: auth(customer.token) }).then((r) => r.json());
      counting = false;
      return { ops: queryCount, returned: res.items.length };
    };

    await make(4, "Small");
    const small = await measure(50);
    await make(11, "Big"); // 15 discoverable businesses total
    const big = await measure(50);

    expect(big.returned).toBe(15);
    expect(small.returned).toBe(4);
    // the serializer batches ratings / loyalty / membership / bookable per page,
    // so the operation count is flat regardless of how many cards come back.
    expect(big.ops - small.ops).toBeLessThanOrEqual(2);
    expect(big.ops).toBeLessThanOrEqual(14);
  });
});
