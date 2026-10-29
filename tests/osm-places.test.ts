import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import { googleMapsSearchUrl, setOsmFetcher, withoutChakusaDuplicates } from "../src/lib/marketplace/osmPlaces.js";
import { trustedGoogleLink } from "../src/lib/marketplace/discovery.js";
import { createTestApp, registerAccount, resetDatabase } from "./helpers.js";

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function registerCustomer(app: FastifyInstance) {
  const res = await app.inject({ method: "POST", url: "/customer/auth/register", payload: { ageConfirmed: true, email: `c-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`, password: "password123", fullName: "Casey" } });
  return res.json().accessToken as string;
}

const overpass = (elements: unknown[]) => async () => new Response(JSON.stringify({ elements }), { status: 200 });

describe("free nearby places (OpenStreetMap) and Google Maps links", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterEach(async () => { setOsmFetcher(null); await resetDatabase(); });
  afterAll(async () => { await app.close(); });

  it("lists named service places nearest first, with attribution and a free Google Maps link, minus Chakusa duplicates", async () => {
    let calls = 0;
    setOsmFetcher(async (...args) => { calls += 1; return overpass([
      { type: "node", id: 1, lat: -17.8300, lon: 31.0500, tags: { shop: "hairdresser", name: "Corner Cuts", "addr:street": "Main Rd", "addr:housenumber": "12" } },
      { type: "way", id: 2, center: { lat: -17.8250, lon: 31.0450 }, tags: { amenity: "spa", name: "Calm Spa", website: "javascript:alert(1)" } },
      { type: "node", id: 3, lat: -17.8301, lon: 31.0501, tags: { shop: "beauty", name: "Ada Studio" } },
      { type: "node", id: 4, lat: -17.8300, lon: 31.0500, tags: { shop: "supermarket", name: "Not a service" } },
      { type: "node", id: 5, lat: -17.8300, lon: 31.0500, tags: { shop: "hairdresser" } },
    ])(...(args as unknown as [])); });
    const owner = await registerAccount(app, { businessName: "Ada Studio" });
    await prisma.businessMarketplaceListing.create({ data: { businessId: owner.businessId, latitude: -17.8301, longitude: 31.0501 } });
    const token = await registerCustomer(app);

    const res = await app.inject({ method: "GET", url: "/customer/marketplace/nearby-places?lat=-17.83&lng=31.05&radiusKm=5", headers: auth(token) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.attribution).toBe("© OpenStreetMap contributors");
    expect(body.places.map((p: { name: string }) => p.name)).toEqual(["Corner Cuts", "Calm Spa"]);
    expect(body.places[0]).toMatchObject({ category: "Hair & barber", address: "12 Main Rd" });
    expect(body.places[0].googleMapsUrl).toMatch(/^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=Corner\+Cuts/);
    expect(body.places[1].website).toBeNull();

    // Cached: a second search in the same area does not hit Overpass again.
    await app.inject({ method: "GET", url: "/customer/marketplace/nearby-places?lat=-17.831&lng=31.051&radiusKm=5", headers: auth(token) });
    expect(calls).toBe(1);
  });

  it("degrades to an empty list when Overpass fails, and does not cache the failure", async () => {
    let calls = 0;
    setOsmFetcher(async () => { calls += 1; return new Response("busy", { status: 429 }); });
    const token = await registerCustomer(app);
    const first = await app.inject({ method: "GET", url: "/customer/marketplace/nearby-places?lat=10&lng=10", headers: auth(token) });
    expect(first.statusCode).toBe(200);
    expect(first.json().places).toEqual([]);
    await app.inject({ method: "GET", url: "/customer/marketplace/nearby-places?lat=10&lng=10", headers: auth(token) });
    expect(calls).toBe(2);
  });

  it("gives every business page a Google Maps link, using the owner's link only when it is really Google", async () => {
    const owner = await registerAccount(app, { businessName: "Linked Salon" });
    const biz = await prisma.business.update({ where: { id: owner.businessId }, data: { googleReviewLink: "https://g.page/r/abc/review" }, select: { publicSlug: true } });
    const token = await registerCustomer(app);
    const profile = await app.inject({ method: "GET", url: `/customer/marketplace/businesses/${biz.publicSlug}`, headers: auth(token) }).then((r) => r.json());
    expect(profile.googleMapsUrl).toBe("https://g.page/r/abc/review");

    await prisma.business.update({ where: { id: owner.businessId }, data: { googleReviewLink: "https://google.evil.com/phish" } });
    const fallback = await app.inject({ method: "GET", url: `/customer/marketplace/businesses/${biz.publicSlug}`, headers: auth(token) }).then((r) => r.json());
    expect(fallback.googleMapsUrl).toMatch(/^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=Linked\+Salon/);
  });

  it("only trusts https Google hosts", () => {
    for (const ok of ["https://g.page/r/x", "https://maps.app.goo.gl/abc", "https://www.google.com/maps/place/x", "https://google.co.zw/maps", "https://search.google.com/local/writereview?placeid=x"]) expect(trustedGoogleLink(ok)).not.toBeNull();
    for (const bad of ["http://g.page/r/x", "https://google.evil.com", "https://evilgoogle.com", "https://g.page.evil.com", "javascript:alert(1)", "not a url"]) expect(trustedGoogleLink(bad)).toBeNull();
    expect(googleMapsSearchUrl("A & B", null, "Harare")).toBe("https://www.google.com/maps/search/?api=1&query=A+%26+B+Harare");
  });

  it("keeps a same-name place far away from a Chakusa business", () => {
    const place = { id: "node/1", name: "Ada Studio", category: "Beauty", latitude: 0, longitude: 0, address: null, phone: null, website: null, openingHours: null, googleMapsUrl: "" };
    expect(withoutChakusaDuplicates([place], [{ name: "Ada Studio", latitude: 0.01, longitude: 0 }])).toHaveLength(1);
    expect(withoutChakusaDuplicates([place], [{ name: "Ada Studio", latitude: 0.0001, longitude: 0 }])).toHaveLength(0);
  });
});
