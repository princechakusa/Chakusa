import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import { config } from "../src/lib/config.js";
import { authHeader, createTestApp, registerAccount, resetDatabase } from "./helpers.js";

const openEveryDay = { version: 1, days: Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => [d, { enabled: true, opensAt: "00:00", closesAt: "23:59" }])) };
const SLOT_BASE = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() + 30); d.setUTCHours(0, 0, 0, 0); return d; })();
const slotAt = (hour: number) => { const d = new Date(SLOT_BASE); d.setUTCHours(hour, 0, 0, 0); return d.toISOString(); };

async function bookableBusiness(app: FastifyInstance, name: string) {
  const account = await registerAccount(app, { businessName: name });
  const business = await prisma.business.update({
    where: { id: account.businessId },
    data: { timezone: "UTC", workingHours: openEveryDay, bookingMinNoticeMinutes: 0, bookingWindowDays: 365, cancellationNoticeMinutes: 0 },
    select: { id: true, publicSlug: true },
  });
  const member = await prisma.businessMember.findFirstOrThrow({ where: { businessId: business.id } });
  const service = await prisma.serviceOffering.create({ data: { businessId: business.id, name: "Signature Cut", durationMinutes: 60, price: 40, publiclyBookable: true } });
  await prisma.serviceOffering.create({ data: { businessId: business.id, name: "Internal Only", durationMinutes: 30, publiclyBookable: false } });
  return { ...account, slug: business.publicSlug as string, businessId: business.id, memberId: member.id, serviceId: service.id };
}

describe("booking distribution (#21)", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterEach(resetDatabase);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it("gives the owner shareable booking links for the business and each bookable service", async () => {
    const biz = await bookableBusiness(app, "Northside Studio");
    const res = await app.inject({ method: "GET", url: "/business/booking-links", headers: authHeader(biz.token) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.slug).toBe(biz.slug);
    expect(body.business.url).toContain(`/book/${biz.slug}`);
    expect(body.services).toHaveLength(1); // only the publicly bookable one
    expect(body.services[0].name).toBe("Signature Cut");
    expect(body.services[0].url).toBe(`${body.business.url}?service=${biz.serviceId}`);
  });

  it("requires an authenticated business session for the links endpoint", async () => {
    await bookableBusiness(app, "Guarded Co");
    const res = await app.inject({ method: "GET", url: "/business/booking-links" });
    expect([401, 403]).toContain(res.statusCode);
  });

  it("the links endpoint is tenant scoped — each business sees only its own slug", async () => {
    const a = await bookableBusiness(app, "Tenant A");
    const b = await bookableBusiness(app, "Tenant B");
    const aLinks = await app.inject({ method: "GET", url: "/business/booking-links", headers: authHeader(a.token) }).then((r) => r.json());
    const bLinks = await app.inject({ method: "GET", url: "/business/booking-links", headers: authHeader(b.token) }).then((r) => r.json());
    expect(aLinks.slug).toBe(a.slug);
    expect(bLinks.slug).toBe(b.slug);
    expect(aLinks.slug).not.toBe(bLinks.slug);
  });

  it("a shared link resolves through availability to a booking, attributed to its surface", async () => {
    const biz = await bookableBusiness(app, "Flow Salon");
    const links = await app.inject({ method: "GET", url: "/business/booking-links", headers: authHeader(biz.token) }).then((r) => r.json());
    // the client parses slug + ?service= out of the shared URL
    const url = new URL(links.services[0].url);
    const slug = url.pathname.split("/").pop()!;
    const serviceOfferingId = url.searchParams.get("service")!;
    expect(slug).toBe(biz.slug);

    const startsAt = slotAt(11);
    const from = new Date(new Date(startsAt).getTime() - 3_600_000).toISOString();
    const to = new Date(new Date(startsAt).getTime() + 3_600_000).toISOString();
    const availability = await app.inject({ method: "GET", url: `/public/business/${slug}/availability?serviceOfferingId=${serviceOfferingId}&from=${from}&to=${to}` }).then((r) => r.json());
    expect(availability.some((s: { startsAt: string }) => s.startsAt === startsAt)).toBe(true);

    const booked = await app.inject({
      method: "POST",
      url: `/public/business/${slug}/book`,
      payload: { serviceOfferingId, assignedMemberId: biz.memberId, startsAt, name: "Sam", phone: "+15550009000", source: "qr" },
    });
    expect(booked.statusCode).toBe(201);
    expect(booked.json().appointment.bookingChannel).toBe("public_qr");
    const stored = await prisma.appointment.findFirstOrThrow({ where: { businessId: biz.businessId } });
    expect(stored.bookingChannel).toBe("public_qr");
  });

  it("defaults attribution to the plain link and rejects an unknown source", async () => {
    const biz = await bookableBusiness(app, "Attr Salon");
    const base = { serviceOfferingId: biz.serviceId, assignedMemberId: biz.memberId, name: "Pat", phone: "+15550009100" };

    const noSource = await app.inject({ method: "POST", url: `/public/business/${biz.slug}/book`, payload: { ...base, startsAt: slotAt(9) } });
    expect(noSource.statusCode).toBe(201);
    expect(noSource.json().appointment.bookingChannel).toBe("public_link");

    const social = await app.inject({ method: "POST", url: `/public/business/${biz.slug}/book`, payload: { ...base, startsAt: slotAt(10), source: "social" } });
    expect(social.json().appointment.bookingChannel).toBe("public_social");

    const bad = await app.inject({ method: "POST", url: `/public/business/${biz.slug}/book`, payload: { ...base, startsAt: slotAt(12), source: "spilled-coffee" } });
    expect(bad.statusCode).toBe(400);
  });

  it("well-known app-link documents 404 until the app identifiers are configured", async () => {
    for (const path of ["/.well-known/apple-app-site-association", "/.well-known/assetlinks.json"]) {
      const res = await app.inject({ method: "GET", url: path });
      expect(res.statusCode).toBe(404);
    }
  });

  it("well-known app-link documents serve the OS-spec JSON when configured", async () => {
    const prevIos = config.IOS_UNIVERSAL_LINK_APP_ID;
    const prevPkg = config.GOOGLE_PLAY_PACKAGE_NAME;
    const prevSha = config.ANDROID_APP_LINK_SHA256;
    config.IOS_UNIVERSAL_LINK_APP_ID = "ABCDE12345.app.chakusa";
    config.GOOGLE_PLAY_PACKAGE_NAME = "app.chakusa";
    config.ANDROID_APP_LINK_SHA256 = "AA:BB:CC, DD:EE:FF";
    try {
      const aasa = await app.inject({ method: "GET", url: "/.well-known/apple-app-site-association" });
      expect(aasa.statusCode).toBe(200);
      expect(aasa.headers["content-type"]).toContain("application/json");
      expect(aasa.json().applinks.details[0]).toMatchObject({ appID: "ABCDE12345.app.chakusa", paths: ["/book/*", "/r/*"] });

      const assetlinks = await app.inject({ method: "GET", url: "/.well-known/assetlinks.json" });
      expect(assetlinks.statusCode).toBe(200);
      expect(assetlinks.json()[0].target).toMatchObject({ namespace: "android_app", package_name: "app.chakusa", sha256_cert_fingerprints: ["AA:BB:CC", "DD:EE:FF"] });
    } finally {
      config.IOS_UNIVERSAL_LINK_APP_ID = prevIos;
      config.GOOGLE_PLAY_PACKAGE_NAME = prevPkg;
      config.ANDROID_APP_LINK_SHA256 = prevSha;
    }
  });
});

describe("booking distribution abuse limits (#21)", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp({ enableRateLimit: true }); });
  afterEach(resetDatabase);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it("rate-limits the public booking endpoint", async () => {
    const biz = await bookableBusiness(app, "Rate Salon");
    const payload = { serviceOfferingId: biz.serviceId, assignedMemberId: biz.memberId, name: "X", phone: "+15550009200", startsAt: slotAt(8) };
    const codes: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const res = await app.inject({ method: "POST", url: `/public/business/${biz.slug}/book`, payload });
      codes.push(res.statusCode);
    }
    expect(codes).toContain(429); // the per-route max is 8/min
  });
});
