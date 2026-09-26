import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import { displayDistanceKm, haversineKm } from "../src/lib/marketplace/geo.js";
import { createTestApp, registerAccount, resetDatabase } from "./helpers.js";

// Owner-pinned business location + customer "near me" discovery.

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function registerCustomer(app: FastifyInstance) {
  const email = `near-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const res = await app.inject({ method: "POST", url: "/customer/auth/register", payload: { email, password: "password123", fullName: "Nora Nearby" } });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.body}`);
  return res.json().accessToken as string;
}

// Harare city centre and two points roughly 1.1 km and 6 km away, plus one ~300 km away (Bulawayo).
const HARARE = { latitude: -17.8292, longitude: 31.0522 };
const AVONDALE = { latitude: -17.8, longitude: 31.04 };
const BORROWDALE = { latitude: -17.775, longitude: 31.08 };
const BULAWAYO = { latitude: -20.1325, longitude: 28.6265 };

describe("geo helpers", () => {
  it("computes great-circle distance", () => {
    expect(haversineKm(HARARE, HARARE)).toBe(0);
    // Harare -> Bulawayo is ~365 km in a straight line.
    expect(haversineKm(HARARE, BULAWAYO)).toBeGreaterThan(355);
    expect(haversineKm(HARARE, BULAWAYO)).toBeLessThan(375);
    expect(haversineKm(HARARE, AVONDALE)).toBeCloseTo(haversineKm(AVONDALE, HARARE), 9);
  });
  it("rounds distances for display", () => {
    expect(displayDistanceKm(1.26)).toBe(1.3);
    expect(displayDistanceKm(12.6)).toBe(13);
  });
});

describe("business location + nearby discovery", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterEach(async () => { await resetDatabase(); });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  const pin = (token: string, location: unknown) => app.inject({ method: "PATCH", url: "/business", headers: auth(token), payload: { location } });

  it("lets an owner pin, read back, move and clear their business location", async () => {
    const owner = await registerAccount(app, { businessName: "Pin Salon" });
    expect((await app.inject({ method: "GET", url: "/business", headers: auth(owner.accessToken) })).json().location).toBeNull();

    const saved = await pin(owner.accessToken, { ...AVONDALE, addressLine: "12 King George Rd", city: "Harare", region: "Harare Province" });
    expect(saved.statusCode).toBe(200);
    const read = (await app.inject({ method: "GET", url: "/business", headers: auth(owner.accessToken) })).json();
    expect(read.location).toMatchObject({ latitude: AVONDALE.latitude, longitude: AVONDALE.longitude, city: "Harare", region: "Harare Province", addressLine: "12 King George Rd" });
    expect(read.marketplaceListing).toBeUndefined();

    await pin(owner.accessToken, BORROWDALE);
    expect((await app.inject({ method: "GET", url: "/business", headers: auth(owner.accessToken) })).json().location).toMatchObject(BORROWDALE);

    await pin(owner.accessToken, null);
    expect((await app.inject({ method: "GET", url: "/business", headers: auth(owner.accessToken) })).json().location).toBeNull();
  });

  it("rejects impossible coordinates", async () => {
    const owner = await registerAccount(app, { businessName: "Bad Pin" });
    expect((await pin(owner.accessToken, { latitude: 91, longitude: 0 })).statusCode).toBe(400);
    expect((await pin(owner.accessToken, { latitude: 0, longitude: -181 })).statusCode).toBe(400);
    expect((await pin(owner.accessToken, { latitude: "x", longitude: 0 })).statusCode).toBe(400);
  });

  it("only writes the caller's own business and requires settings capability", async () => {
    const owner = await registerAccount(app, { businessName: "Mine" });
    const other = await registerAccount(app, { businessName: "Theirs" });
    await pin(owner.accessToken, { ...AVONDALE, businessId: other.businessId });
    expect(await prisma.businessMarketplaceListing.findUnique({ where: { businessId: other.businessId } })).toBeNull();
    expect((await prisma.businessMarketplaceListing.findUnique({ where: { businessId: owner.businessId } }))?.latitude).toBe(AVONDALE.latitude);

    // A STAFF member cannot move the business.
    const staff = await prisma.user.create({ data: { email: "staff-pin@example.com", normalizedEmail: "staff-pin@example.com", fullName: "Staff", passwordHash: (await prisma.user.findUniqueOrThrow({ where: { id: owner.userId } })).passwordHash } });
    await prisma.businessMember.create({ data: { businessId: owner.businessId, userId: staff.id, role: "STAFF", status: "ACTIVE" } });
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email: "staff-pin@example.com", password: "password123" } });
    expect(login.statusCode).toBe(200);
    expect((await pin(login.json().accessToken, BORROWDALE)).statusCode).toBe(403);
  });

  it("ranks nearby businesses nearest-first with a distance, inside a true radius", async () => {
    const near = await registerAccount(app, { businessName: "Avondale Barbers" });
    const mid = await registerAccount(app, { businessName: "Borrowdale Spa" });
    const far = await registerAccount(app, { businessName: "Bulawayo Cuts" });
    await registerAccount(app, { businessName: "No Pin Studio" });
    // Register the mid one first so ordering can't come from insertion order.
    await pin(mid.accessToken, { ...BORROWDALE, city: "Harare" });
    await pin(near.accessToken, { ...AVONDALE, city: "Harare" });
    await pin(far.accessToken, { ...BULAWAYO, city: "Bulawayo" });

    const customer = await registerCustomer(app);
    const res = await app.inject({ method: "GET", url: `/customer/marketplace/nearby?lat=${HARARE.latitude}&lng=${HARARE.longitude}&radiusKm=15`, headers: auth(customer) });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<{ name: string; distanceKm: number | null; city: string | null }>;
    expect(items.map((item) => item.name)).toEqual(["Avondale Barbers", "Borrowdale Spa"]);
    expect(items[0].distanceKm).toBe(displayDistanceKm(haversineKm(HARARE, AVONDALE)));
    expect(items[0].distanceKm!).toBeLessThan(items[1].distanceKm!);
    expect(res.json().nextCursor).toBeNull();

    // A corner of the bounding box that is outside the circle is excluded.
    const corner = await registerAccount(app, { businessName: "Corner Case" });
    await pin(corner.accessToken, { latitude: HARARE.latitude + 0.12, longitude: HARARE.longitude + 0.12 }); // ~18 km diagonal
    const again = await app.inject({ method: "GET", url: `/customer/marketplace/nearby?lat=${HARARE.latitude}&lng=${HARARE.longitude}&radiusKm=15`, headers: auth(customer) });
    expect((again.json().items as Array<{ name: string }>).map((item) => item.name)).not.toContain("Corner Case");

    // Browse without a position carries no distance.
    const browse = await app.inject({ method: "GET", url: "/customer/marketplace", headers: auth(customer) });
    expect((browse.json().items as Array<{ distanceKm: number | null }>).every((item) => item.distanceKm === null)).toBe(true);
  });
});
