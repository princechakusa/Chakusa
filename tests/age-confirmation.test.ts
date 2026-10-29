import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "../src/lib/errors.js";
import { prisma } from "../src/lib/prisma.js";
import type { GoogleTokenVerifier, VerifiedGoogleIdentity } from "../src/modules/auth/googleVerifier.js";
import { createTestApp, resetDatabase } from "./helpers.js";

// Everyone using Chakusa must be 18 or older: no account is created, by any
// route, unless the person ticked "I confirm I am 18 or older".

const identities = new Map<string, VerifiedGoogleIdentity>([
  ["new-person", { providerSubject: "age-subject-1", email: "age-google@example.com", fullName: "Age Google", issuedAt: 0 }],
]);
const verifier: GoogleTokenVerifier = async (idToken) => {
  const identity = identities.get(idToken);
  if (!identity) throw ApiError.auth(401, "GOOGLE_TOKEN_INVALID", "Google identity token is invalid or expired");
  return { ...identity, issuedAt: Math.floor(Date.now() / 1000) };
};

const business = (extra: Record<string, unknown> = {}) => ({ email: "owner-age@example.com", password: "password12345", fullName: "Owner Age", businessName: "Age Co", ...extra });
const customer = (extra: Record<string, unknown> = {}) => ({ email: "client-age@example.com", password: "password12345", fullName: "Client Age", ...extra });

describe("18+ confirmation at sign-up", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp({ googleTokenVerifier: verifier }); });
  afterEach(resetDatabase);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it("refuses a business sign-up without the tick and creates nothing", async () => {
    for (const payload of [business(), business({ ageConfirmed: false })]) {
      const response = await app.inject({ method: "POST", url: "/auth/register", payload });
      expect(response.statusCode).toBe(400);
    }
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.business.count()).toBe(0);
  });

  it("refuses a customer sign-up without the tick and creates nothing", async () => {
    for (const payload of [customer(), customer({ ageConfirmed: false })]) {
      const response = await app.inject({ method: "POST", url: "/customer/auth/register", payload });
      expect(response.statusCode).toBe(400);
    }
    expect(await prisma.user.count()).toBe(0);
  });

  it("records when the person confirmed their age", async () => {
    const before = Date.now();
    expect((await app.inject({ method: "POST", url: "/auth/register", payload: business({ ageConfirmed: true }) })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: "/customer/auth/register", payload: customer({ ageConfirmed: true }) })).statusCode).toBe(201);
    const users = await prisma.user.findMany({ select: { ageConfirmedAt: true } });
    expect(users).toHaveLength(2);
    for (const user of users) expect(user.ageConfirmedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("refuses to create an account through Google without the tick, for business and customer", async () => {
    for (const url of ["/auth/google", "/customer/auth/google"]) {
      const response = await app.inject({ method: "POST", url, payload: { idToken: "new-person" } });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("AGE_CONFIRMATION_REQUIRED");
    }
    expect(await prisma.user.count()).toBe(0);
  });

  it("creates the Google account with the tick, and lets that person sign in again", async () => {
    const created = await app.inject({ method: "POST", url: "/auth/google", payload: { idToken: "new-person", ageConfirmed: true } });
    expect(created.statusCode).toBe(200);
    expect((await prisma.user.findFirstOrThrow()).ageConfirmedAt).not.toBeNull();
    // An existing account is signed in, not created, so the API does not refuse it.
    const again = await app.inject({ method: "POST", url: "/auth/google", payload: { idToken: "new-person" } });
    expect(again.statusCode).toBe(200);
    expect(await prisma.user.count()).toBe(1);
  });
});
