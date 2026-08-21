import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, resetDatabase, registerAccount, authHeader } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

describe("public business profile", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("1. assigns every newly registered business a public slug", async () => {
    const { businessId } = await registerAccount(app, { businessName: "Jane's Plumbing" });
    const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });

    expect(business.publicSlug).toBeTruthy();
    expect(business.publicSlug).toMatch(/^jane-s-plumbing/);
  });

  it("2. assigns distinct slugs to two businesses with the same name", async () => {
    const first = await registerAccount(app, { email: "dup-a@example.com", businessName: "Same Name Co" });
    const second = await registerAccount(app, { email: "dup-b@example.com", businessName: "Same Name Co" });

    const businessA = await prisma.business.findUniqueOrThrow({ where: { id: first.businessId } });
    const businessB = await prisma.business.findUniqueOrThrow({ where: { id: second.businessId } });

    expect(businessA.publicSlug).not.toBe(businessB.publicSlug);
  });

  it("3. resolves a valid slug with minimal, public-safe fields", async () => {
    const { businessId, token } = await registerAccount(app, { businessName: "Sparkle Clean" });
    await app.inject({
      method: "PATCH",
      url: "/business",
      headers: authHeader(token),
      payload: { industry: "cleaning", defaultServices: ["Deep clean", "Move-out clean"] },
    });
    const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });

    const response = await app.inject({ method: "GET", url: `/public/business/${business.publicSlug}` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      name: "Sparkle Clean",
      industry: "cleaning",
      defaultServices: ["Deep clean", "Move-out clean"],
    });
  });

  it("4. returns a generic 404 for an unknown slug", async () => {
    const response = await app.inject({ method: "GET", url: "/public/business/does-not-exist" });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("NOT_FOUND");
  });

  it("5. never exposes businessId, ownerId, or subscription data in the public response", async () => {
    const { businessId } = await registerAccount(app, { businessName: "No Leak Co" });
    const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });

    const response = await app.inject({ method: "GET", url: `/public/business/${business.publicSlug}` });
    const body = JSON.stringify(response.json());

    expect(body).not.toMatch(/businessId/i);
    expect(body).not.toMatch(/ownerId/i);
    expect(body).not.toMatch(/plan/i);
  });

  it("6. accepts a valid contact submission and creates a real lead", async () => {
    const { businessId } = await registerAccount(app, { businessName: "Contact Me Co" });
    const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });

    const response = await app.inject({
      method: "POST",
      url: `/public/business/${business.publicSlug}/contact`,
      payload: { name: "Prospective Customer", phone: "+15551234567", serviceRequested: "Quote", message: "Please call me back" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ state: "submitted", businessName: "Contact Me Co" });

    const lead = await prisma.lead.findFirstOrThrow({ where: { businessId } });
    expect(lead.source).toBe("public_profile");
    expect(lead.serviceRequested).toBe("Quote");
    expect(lead.notes).toBe("Please call me back");

    const customer = await prisma.customer.findFirstOrThrow({ where: { businessId } });
    expect(customer.name).toBe("Prospective Customer");
  });

  it("7. resolves a repeat submission from the same phone number to the same customer", async () => {
    const { businessId } = await registerAccount(app, { businessName: "Repeat Co" });
    const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });

    await app.inject({
      method: "POST",
      url: `/public/business/${business.publicSlug}/contact`,
      payload: { name: "First Visit", phone: "+263771234567" },
    });
    await app.inject({
      method: "POST",
      url: `/public/business/${business.publicSlug}/contact`,
      payload: { name: "First Visit", phone: "+263771234567" },
    });

    expect(await prisma.customer.count({ where: { businessId } })).toBe(1);
    expect(await prisma.lead.count({ where: { businessId } })).toBe(2);
  });

  it("8. returns a generic 404 for a contact submission to an unknown slug", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/public/business/does-not-exist/contact",
      payload: { name: "Someone", phone: "+15551234567" },
    });

    expect(response.statusCode).toBe(404);
  });

  it("9. rejects a contact submission missing a required field", async () => {
    const { businessId } = await registerAccount(app, { businessName: "Validation Co" });
    const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });

    const response = await app.inject({
      method: "POST",
      url: `/public/business/${business.publicSlug}/contact`,
      payload: { name: "No Phone" },
    });

    expect(response.statusCode).toBe(400);
    expect(await prisma.lead.count({ where: { businessId } })).toBe(0);
  });

  it("10. does not fire LEAD_CREATED automation for a public-profile lead", async () => {
    const { businessId } = await registerAccount(app, { businessName: "Automation Co" });
    const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });

    await app.inject({
      method: "POST",
      url: `/public/business/${business.publicSlug}/contact`,
      payload: { name: "Auto Test", phone: "+15550001111" },
    });

    expect(await prisma.automationRun.count({ where: { businessId } })).toBe(0);
  });

  it("11. Business A's slug cannot resolve or affect Business B's data", async () => {
    const businessA = await registerAccount(app, { email: "biz-a@example.com", businessName: "Business A" });
    const businessB = await registerAccount(app, { email: "biz-b@example.com", businessName: "Business B" });
    const bizA = await prisma.business.findUniqueOrThrow({ where: { id: businessA.businessId } });

    await app.inject({
      method: "POST",
      url: `/public/business/${bizA.publicSlug}/contact`,
      payload: { name: "Someone", phone: "+15552223333" },
    });

    expect(await prisma.lead.count({ where: { businessId: businessB.businessId } })).toBe(0);
    expect(await prisma.lead.count({ where: { businessId: businessA.businessId } })).toBe(1);
  });

  it("12. works without any authentication", async () => {
    const { businessId } = await registerAccount(app, { businessName: "No Auth Needed" });
    const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });

    const response = await app.inject({ method: "GET", url: `/public/business/${business.publicSlug}` }); // no Authorization header

    expect(response.statusCode).toBe(200);
  });

  it("13. rate limits the public contact submission route", async () => {
    const isolatedApp = await createTestApp({ enableRateLimit: true });
    const { businessId } = await registerAccount(isolatedApp, { businessName: "Rate Limited Co" });
    const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });

    const responses = [];
    for (let index = 0; index < 11; index += 1) {
      responses.push(
        await isolatedApp.inject({
          method: "POST",
          url: `/public/business/${business.publicSlug}/contact`,
          payload: { name: `Person ${index}`, phone: `+1555000${String(index).padStart(4, "0")}` },
        }),
      );
    }

    expect(responses.slice(0, 10).every((r) => r.statusCode === 201)).toBe(true);
    expect(responses[10]!.statusCode).toBe(429);
    expect(responses[10]!.json().error.code).toBe("RATE_LIMITED");
    await isolatedApp.close();
  });
});
