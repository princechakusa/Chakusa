import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import { createTestApp, registerAccount, resetDatabase } from "./helpers.js";

// Business photo (owner uploads, customers see) and customer profile picture.

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
// A real 1x1 PNG.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("profile pictures", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterEach(async () => { await resetDatabase(); });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it("serves a business photo publicly once uploaded, and exposes a versioned link on customer-facing data", async () => {
    const owner = await registerAccount(app, { businessName: "Photo Salon" });
    const slug = (await prisma.business.findUniqueOrThrow({ where: { id: owner.businessId } })).publicSlug!;
    expect((await app.inject({ method: "GET", url: `/public/business/${slug}/photo` })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/public/business/${slug}` })).json().photoUrl).toBeNull();

    expect((await app.inject({ method: "PATCH", url: "/business", headers: auth(owner.accessToken), payload: { logoDataUrl: PNG } })).statusCode).toBe(200);
    const photo = await app.inject({ method: "GET", url: `/public/business/${slug}/photo` });
    expect(photo.statusCode).toBe(200);
    expect(photo.headers["content-type"]).toBe("image/png");
    expect(photo.headers["cache-control"]).toContain("max-age");
    expect(photo.rawPayload.subarray(1, 4).toString()).toBe("PNG");

    const profile = (await app.inject({ method: "GET", url: `/public/business/${slug}` })).json();
    expect(profile.photoUrl).toMatch(new RegExp(`^/public/business/${slug}/photo\\?v=`));
    const customer = await app.inject({ method: "POST", url: "/customer/auth/register", payload: { email: "pic-cust@example.com", password: "password123", fullName: "Pic Customer" } });
    const cards = (await app.inject({ method: "GET", url: "/customer/marketplace", headers: auth(customer.json().accessToken) })).json().items as Array<{ name: string; photoUrl: string | null }>;
    expect(cards.find((card) => card.name === "Photo Salon")?.photoUrl).toBe(profile.photoUrl);

    // Removing it takes it down.
    await app.inject({ method: "PATCH", url: "/business", headers: auth(owner.accessToken), payload: { logoDataUrl: null } });
    expect((await app.inject({ method: "GET", url: `/public/business/${slug}/photo` })).statusCode).toBe(404);
  });

  it("hides a suspended business's photo and rejects non-images", async () => {
    const owner = await registerAccount(app, { businessName: "Hidden Salon" });
    const slug = (await prisma.business.findUniqueOrThrow({ where: { id: owner.businessId } })).publicSlug!;
    expect((await app.inject({ method: "PATCH", url: "/business", headers: auth(owner.accessToken), payload: { logoDataUrl: "data:text/html;base64,PHNjcmlwdD4=" } })).statusCode).toBe(400);
    await app.inject({ method: "PATCH", url: "/business", headers: auth(owner.accessToken), payload: { logoDataUrl: PNG } });
    await prisma.business.update({ where: { id: owner.businessId }, data: { platformStatus: "SUSPENDED" } });
    expect((await app.inject({ method: "GET", url: `/public/business/${slug}/photo` })).statusCode).toBe(404);
  });

  it("lets a customer set, keep and remove a profile picture, and rejects unsafe values", async () => {
    const reg = await app.inject({ method: "POST", url: "/customer/auth/register", payload: { email: "avatar@example.com", password: "password123", fullName: "Ava Tar" } });
    const token = reg.json().accessToken as string;
    const patch = (avatarUrl: unknown) => app.inject({ method: "PATCH", url: "/customer/profile", headers: auth(token), payload: { avatarUrl } });

    expect((await patch(PNG)).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/customer/auth/me", headers: auth(token) })).json().profile.avatarUrl).toBe(PNG);
    expect((await patch("https://images.example.com/me.png")).statusCode).toBe(200);
    expect((await patch("http://insecure.example.com/me.png")).statusCode).toBe(400);
    expect((await patch("javascript:alert(1)")).statusCode).toBe(400);
    expect((await patch("data:text/html;base64,PHNjcmlwdD4=")).statusCode).toBe(400);
    expect((await patch(`data:image/png;base64,${"A".repeat(400_001)}`)).statusCode).toBe(400);
    expect((await patch(null)).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/customer/auth/me", headers: auth(token) })).json().profile.avatarUrl).toBeNull();
  });
});
