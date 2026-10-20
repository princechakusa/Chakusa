import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import { config } from "../src/lib/config.js";
import { setGooglePlacesFetcher } from "../src/lib/marketplace/googlePlaces.js";
import { GALLERY_MAX_PHOTOS } from "../src/lib/marketplace/gallery.js";
import { createTestApp, registerAccount, resetDatabase } from "./helpers.js";

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
// Smallest valid JPEG/PNG headers - the server sniffs magic bytes only.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]).toString("base64");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 2)]).toString("base64");

async function registerCustomer(app: FastifyInstance, fullName = "Casey Customer") {
  const email = `cust-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const res = await app.inject({ method: "POST", url: "/customer/auth/register", payload: { email, password: "password123", fullName } });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.body}`);
  const body = res.json();
  return { token: body.accessToken as string, profileId: body.profile.id as string };
}

async function business(app: FastifyInstance, name: string) {
  const account = await registerAccount(app, { businessName: name, email: `owner-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` });
  const row = await prisma.business.findUniqueOrThrow({ where: { id: account.businessId }, select: { publicSlug: true } });
  return { token: account.token as string, businessId: account.businessId as string, slug: row.publicSlug as string };
}

describe("business photo gallery", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterEach(resetDatabase);
  afterAll(async () => { await app.close(); });

  it("an owner uploads photos that customers see on cards and the profile, served publicly", async () => {
    const biz = await business(app, "Gallery Studio");
    const first = await app.inject({ method: "POST", url: "/business/gallery", headers: auth(biz.token), payload: { dataBase64: JPEG, caption: "Front desk" } });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({ method: "POST", url: "/business/gallery", headers: auth(biz.token), payload: { dataBase64: PNG } });
    expect(second.statusCode).toBe(201);

    const customer = await registerCustomer(app);
    const profile = await app.inject({ method: "GET", url: `/customer/marketplace/businesses/${biz.slug}`, headers: auth(customer.token) }).then((r) => r.json());
    expect(profile.gallery).toHaveLength(2);
    expect(profile.gallery[0].caption).toBe("Front desk");
    expect(profile.photos[0]).toBe(profile.gallery[0].url);

    const search = await app.inject({ method: "GET", url: "/customer/marketplace/search?q=Gallery", headers: auth(customer.token) }).then((r) => r.json());
    const card = search.items.find((item: { slug: string }) => item.slug === biz.slug);
    expect(card.photo).toBe(profile.gallery[0].url);
    expect(card.photos).toHaveLength(2);

    const image = await app.inject({ method: "GET", url: profile.gallery[1].url });
    expect(image.statusCode).toBe(200);
    expect(image.headers["content-type"]).toBe("image/png");
    expect(image.headers["cache-control"]).toContain("immutable");
  });

  it("rejects non-images, enforces the cap, and reorders only the owner's own complete set", async () => {
    const biz = await business(app, "Cap Studio");
    const bad = await app.inject({ method: "POST", url: "/business/gallery", headers: auth(biz.token), payload: { dataBase64: Buffer.from("<svg onload=alert(1)>").toString("base64") } });
    expect(bad.statusCode).toBe(400);

    for (let i = 0; i < GALLERY_MAX_PHOTOS; i += 1) {
      expect((await app.inject({ method: "POST", url: "/business/gallery", headers: auth(biz.token), payload: { dataBase64: JPEG } })).statusCode).toBe(201);
    }
    expect((await app.inject({ method: "POST", url: "/business/gallery", headers: auth(biz.token), payload: { dataBase64: JPEG } })).statusCode).toBe(400);

    const list = await app.inject({ method: "GET", url: "/business/gallery", headers: auth(biz.token) }).then((r) => r.json());
    const ids = list.map((p: { id: string }) => p.id);
    expect((await app.inject({ method: "PUT", url: "/business/gallery/order", headers: auth(biz.token), payload: { ids: ids.slice(1) } })).statusCode).toBe(400);
    const reordered = await app.inject({ method: "PUT", url: "/business/gallery/order", headers: auth(biz.token), payload: { ids: [...ids].reverse() } }).then((r) => r.json());
    expect(reordered[0].id).toBe(ids[ids.length - 1]);
  });

  it("keeps galleries tenant-isolated and hides photos of unlisted businesses", async () => {
    const owner = await business(app, "Owner Studio");
    const other = await business(app, "Other Studio");
    const photo = await app.inject({ method: "POST", url: "/business/gallery", headers: auth(owner.token), payload: { dataBase64: JPEG } }).then((r) => r.json());

    expect((await app.inject({ method: "DELETE", url: `/business/gallery/${photo.id}`, headers: auth(other.token) })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/public/business/${other.slug}/gallery/${photo.id}` })).statusCode).toBe(404);

    await prisma.businessMarketplaceListing.create({ data: { businessId: owner.businessId, listed: false } });
    expect((await app.inject({ method: "GET", url: `/public/business/${owner.slug}/gallery/${photo.id}` })).statusCode).toBe(404);

    await prisma.businessMarketplaceListing.update({ where: { businessId: owner.businessId }, data: { listed: true } });
    expect((await app.inject({ method: "DELETE", url: `/business/gallery/${photo.id}`, headers: auth(owner.token) })).statusCode).toBe(204);
  });
});

describe("ask the business (customer <-> business messaging)", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterEach(resetDatabase);
  afterAll(async () => { await app.close(); });

  it("customer asks, the business sees it in its inbox and replies, the customer reads the reply", async () => {
    const biz = await business(app, "Ask Studio");
    const customer = await registerCustomer(app, "Riley Asker");

    const sent = await app.inject({ method: "POST", url: "/customer/inquiries", headers: auth(customer.token), payload: { slug: biz.slug, body: "Do you do balayage?" } });
    expect(sent.statusCode).toBe(201);
    const { threadId } = sent.json();

    const inbox = await app.inject({ method: "GET", url: "/messages/conversations", headers: auth(biz.token) }).then((r) => r.json());
    const conversation = inbox.find((c: { id: string }) => c.id === threadId);
    expect(conversation.subject).toBe("Riley Asker");
    expect(conversation.unread).toBe(true);

    const replied = await app.inject({ method: "POST", url: `/messages/conversations/${threadId}/reply`, headers: auth(biz.token), payload: { body: "Yes! Book a colour consult." } });
    expect(replied.statusCode).toBe(201);

    const threads = await app.inject({ method: "GET", url: "/customer/inquiries", headers: auth(customer.token) }).then((r) => r.json());
    expect(threads[0].unreadCount).toBe(1);
    expect(threads[0].business.slug).toBe(biz.slug);

    const thread = await app.inject({ method: "GET", url: `/customer/inquiries/${threadId}`, headers: auth(customer.token) }).then((r) => r.json());
    expect(thread.messages.map((m: { body: string; fromBusiness: boolean }) => [m.body, m.fromBusiness])).toEqual([["Do you do balayage?", false], ["Yes! Book a colour consult.", true]]);
    const after = await app.inject({ method: "GET", url: "/customer/inquiries", headers: auth(customer.token) }).then((r) => r.json());
    expect(after[0].unreadCount).toBe(0);

    const notification = await prisma.customerNotification.findFirst({ where: { customerProfileId: customer.profileId, category: "message" } });
    expect(notification?.body).toBe("Yes! Book a colour consult.");

    // Follow-up lands in the same thread.
    const followUp = await app.inject({ method: "POST", url: `/customer/inquiries/${threadId}/messages`, headers: auth(customer.token), payload: { body: "Great, thanks" } });
    expect(followUp.json().threadId).toBe(threadId);
  });

  it("isolates threads between customers and businesses", async () => {
    const biz = await business(app, "Private Studio");
    const other = await business(app, "Nosy Studio");
    const alice = await registerCustomer(app, "Alice");
    const bob = await registerCustomer(app, "Bob");
    const { threadId } = await app.inject({ method: "POST", url: "/customer/inquiries", headers: auth(alice.token), payload: { slug: biz.slug, body: "Private question" } }).then((r) => r.json());

    expect((await app.inject({ method: "GET", url: `/customer/inquiries/${threadId}`, headers: auth(bob.token) })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/customer/inquiries/${threadId}/messages`, headers: auth(bob.token), payload: { body: "hi" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/messages/conversations/${threadId}/reply`, headers: auth(other.token), payload: { body: "hi" } })).statusCode).toBe(404);
    expect(await app.inject({ method: "GET", url: "/customer/inquiries", headers: auth(bob.token) }).then((r) => r.json())).toEqual([]);
  });

  it("only returns in-app messages to the customer and refuses replies to non-app threads", async () => {
    const biz = await business(app, "Mixed Studio");
    const customer = await registerCustomer(app);
    const { threadId } = await app.inject({ method: "POST", url: "/customer/inquiries", headers: auth(customer.token), payload: { slug: biz.slug, body: "Hello" } }).then((r) => r.json());
    await prisma.message.create({ data: { businessId: biz.businessId, conversationId: threadId, messageType: "custom", channel: "sms", direction: "OUTBOUND", body: "SMS-only content", status: "sent" } });
    const thread = await app.inject({ method: "GET", url: `/customer/inquiries/${threadId}`, headers: auth(customer.token) }).then((r) => r.json());
    expect(thread.messages.map((m: { body: string }) => m.body)).toEqual(["Hello"]);

    const smsThread = await prisma.conversation.create({ data: { businessId: biz.businessId, subject: "SMS lead" } });
    expect((await app.inject({ method: "POST", url: `/messages/conversations/${smsThread.id}/reply`, headers: auth(biz.token), payload: { body: "hi" } })).statusCode).toBe(400);
  });

  it("validates bodies, honours a business block and rate-limits a flooding customer", async () => {
    const biz = await business(app, "Guarded Studio");
    const customer = await registerCustomer(app);
    expect((await app.inject({ method: "POST", url: "/customer/inquiries", headers: auth(customer.token), payload: { slug: biz.slug, body: "   " } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/customer/inquiries", headers: auth(customer.token), payload: { slug: "no-such-business", body: "hi" } })).statusCode).toBe(404);

    const { threadId } = await app.inject({ method: "POST", url: "/customer/inquiries", headers: auth(customer.token), payload: { slug: biz.slug, body: "first" } }).then((r) => r.json());
    await prisma.message.createMany({ data: Array.from({ length: 29 }, (_, i) => ({ businessId: biz.businessId, conversationId: threadId, messageType: "custom" as const, channel: "other" as const, provider: "in_app", direction: "INBOUND", body: `m${i}`, status: "delivered" as const })) });
    expect((await app.inject({ method: "POST", url: "/customer/inquiries", headers: auth(customer.token), payload: { slug: biz.slug, body: "one more" } })).statusCode).toBe(429);

    await prisma.customerBusinessLink.update({ where: { customerProfileId_businessId: { customerProfileId: customer.profileId, businessId: biz.businessId } }, data: { blockedByBusiness: true } });
    expect((await app.inject({ method: "POST", url: "/customer/inquiries", headers: auth(customer.token), payload: { slug: biz.slug, body: "blocked" } })).statusCode).toBe(403);
  });
});

describe("Google ratings and nearby places", () => {
  let app: FastifyInstance;
  const original = config.GOOGLE_PLACES_API_KEY;
  beforeAll(async () => { app = await createTestApp(); });
  afterEach(async () => { (config as { GOOGLE_PLACES_API_KEY?: string }).GOOGLE_PLACES_API_KEY = original; setGooglePlacesFetcher(null); await resetDatabase(); });
  afterAll(async () => { await app.close(); });

  it("is off without a key: no Google calls, no rating, empty nearby", async () => {
    (config as { GOOGLE_PLACES_API_KEY?: string }).GOOGLE_PLACES_API_KEY = undefined;
    let calls = 0;
    setGooglePlacesFetcher(async () => { calls += 1; return new Response("{}"); });
    const biz = await business(app, "Offline Studio");
    await prisma.business.update({ where: { id: biz.businessId }, data: { googlePlaceId: "ChIJ_offline_place_123" } });
    const customer = await registerCustomer(app);
    const profile = await app.inject({ method: "GET", url: `/customer/marketplace/businesses/${biz.slug}`, headers: auth(customer.token) }).then((r) => r.json());
    expect(profile.google).toBeNull();
    const nearby = await app.inject({ method: "GET", url: "/customer/marketplace/google-nearby?lat=51.5&lng=-0.1", headers: auth(customer.token) }).then((r) => r.json());
    expect(nearby).toEqual({ enabled: false, attribution: "Google", places: [] });
    expect(calls).toBe(0);
  });

  it("with a key: shows the live rating with attribution, never stores it, and hides places already on Chakusa", async () => {
    (config as { GOOGLE_PLACES_API_KEY?: string }).GOOGLE_PLACES_API_KEY = "test-key";
    const seenKeys: string[] = [];
    setGooglePlacesFetcher(async (url, init) => {
      seenKeys.push(String((init?.headers as Record<string, string>)["x-goog-api-key"]));
      if (String(url).includes("searchNearby")) {
        return new Response(JSON.stringify({ places: [
          { id: "ChIJ_linked_place_456", displayName: { text: "Linked" }, rating: 4.1, userRatingCount: 9, businessStatus: "OPERATIONAL" },
          { id: "ChIJ_external_place_789", displayName: { text: "Corner Cafe" }, rating: 4.6, userRatingCount: 210, businessStatus: "OPERATIONAL", location: { latitude: 51.5, longitude: -0.1 } },
          { id: "ChIJ_closed_place_000", displayName: { text: "Gone" }, businessStatus: "CLOSED_PERMANENTLY" },
        ] }));
      }
      return new Response(JSON.stringify({ id: "ChIJ_linked_place_456", rating: 4.1, userRatingCount: 9, googleMapsUri: "https://maps.google.com/?cid=1" }));
    });
    const biz = await business(app, "Linked Studio");
    const linked = await app.inject({ method: "PUT", url: "/business/google-place", headers: auth(biz.token), payload: { placeId: "ChIJ_linked_place_456" } });
    expect(linked.statusCode).toBe(200);

    const customer = await registerCustomer(app);
    const profile = await app.inject({ method: "GET", url: `/customer/marketplace/businesses/${biz.slug}`, headers: auth(customer.token) }).then((r) => r.json());
    expect(profile.google).toEqual({ rating: 4.1, reviewCount: 9, mapsUrl: "https://maps.google.com/?cid=1", attribution: "Google" });
    const stored = await prisma.business.findUniqueOrThrow({ where: { id: biz.businessId } });
    expect(JSON.stringify(stored)).not.toContain("4.1");

    const nearby = await app.inject({ method: "GET", url: "/customer/marketplace/google-nearby?lat=51.5&lng=-0.1", headers: auth(customer.token) }).then((r) => r.json());
    expect(nearby.places.map((p: { name: string }) => p.name)).toEqual(["Corner Cafe"]);
    expect(seenKeys.every((key) => key === "test-key")).toBe(true);
  });

  it("degrades to no rating when Google errors", async () => {
    (config as { GOOGLE_PLACES_API_KEY?: string }).GOOGLE_PLACES_API_KEY = "test-key";
    setGooglePlacesFetcher(async () => new Response("quota", { status: 429 }));
    const biz = await business(app, "Flaky Studio");
    await prisma.business.update({ where: { id: biz.businessId }, data: { googlePlaceId: "ChIJ_flaky_place_111" } });
    const customer = await registerCustomer(app);
    const profile = await app.inject({ method: "GET", url: `/customer/marketplace/businesses/${biz.slug}`, headers: auth(customer.token) });
    expect(profile.statusCode).toBe(200);
    expect(profile.json().google).toBeNull();
  });
});
