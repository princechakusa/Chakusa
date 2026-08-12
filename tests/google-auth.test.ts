import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { TokenPayload } from "google-auth-library";
import { ApiError } from "../src/lib/errors.js";
import { config } from "../src/lib/config.js";
import { prisma } from "../src/lib/prisma.js";
import {
  assertGoogleAuthEnabled,
  validateGooglePayload,
  type GoogleTokenVerifier,
  type VerifiedGoogleIdentity,
} from "../src/modules/auth/googleVerifier.js";
import { authHeader, createTestApp, registerAccount, resetDatabase } from "./helpers.js";

const now = Math.floor(Date.now() / 1000);
const googleIdentity = (overrides: Partial<VerifiedGoogleIdentity> = {}): VerifiedGoogleIdentity => ({
  providerSubject: "google-subject-1",
  email: "google@example.com",
  fullName: "Google User",
  issuedAt: Math.floor(Date.now() / 1000),
  ...overrides,
});

const identities = new Map<string, VerifiedGoogleIdentity>([
  ["valid-new", googleIdentity()],
  ["second-google", googleIdentity({ providerSubject: "google-subject-2", email: "second-google@example.com" })],
  ["shared-email", googleIdentity({ providerSubject: "shared-subject", email: "shared@example.com" })],
]);

const verifier: GoogleTokenVerifier = async (idToken) => {
  if (idToken === "invalid-signature" || idToken === "malformed") {
    throw ApiError.auth(401, "GOOGLE_TOKEN_INVALID", "Google identity token is invalid or expired");
  }
  const identity = identities.get(idToken);
  if (!identity) throw ApiError.auth(401, "GOOGLE_TOKEN_INVALID", "Google identity token is invalid or expired");
  return { ...identity, issuedAt: Math.floor(Date.now() / 1000) };
};

describe("Google authentication", () => {
  let app: FastifyInstance;

  beforeAll(async () => { app = await createTestApp({ googleTokenVerifier: verifier }); });
  afterEach(resetDatabase);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it("creates a provider-only user and an existing Chakusa refresh session", async () => {
    const response = await app.inject({ method: "POST", url: "/auth/google", payload: { idToken: "valid-new" } });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ isNewUser: true, business: null, role: null, tokenType: "Bearer" });
    expect(body.user.authProviders).toEqual(["GOOGLE"]);
    expect(body.accessToken).toBeTypeOf("string");
    expect(body.refreshToken).toBeTypeOf("string");

    const user = await prisma.user.findUnique({ where: { id: body.user.id }, include: { authIdentities: true, authSessions: true } });
    expect(user?.passwordHash).toBeNull();
    expect(user?.authIdentities[0]).toMatchObject({ provider: "GOOGLE", providerSubject: "google-subject-1" });
    expect(user?.authSessions).toHaveLength(1);
    expect(user?.authSessions[0]?.tokenHash).not.toBe(body.refreshToken);
  });

  it("authenticates the same linked Google subject without creating another user", async () => {
    const first = await app.inject({ method: "POST", url: "/auth/google", payload: { idToken: "valid-new" } });
    const second = await app.inject({ method: "POST", url: "/auth/google", payload: { idToken: "valid-new" } });
    expect(second.statusCode).toBe(200);
    expect(second.json().user.id).toBe(first.json().user.id);
    expect(second.json().isNewUser).toBe(false);
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.authIdentity.count()).toBe(1);
    expect(await prisma.authSession.count()).toBe(2);
  });

  it.each(["malformed", "invalid-signature"])("rejects an invalid Google token: %s", async (idToken) => {
    const response = await app.inject({ method: "POST", url: "/auth/google", payload: { idToken } });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("GOOGLE_TOKEN_INVALID");
  });

  it("fails clearly when Google server credentials are missing", async () => {
    const unconfiguredApp = await createTestApp();
    const response = await unconfiguredApp.inject({ method: "POST", url: "/auth/google", payload: { idToken: "not-trusted" } });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("GOOGLE_AUTH_NOT_CONFIGURED");
    await unconfiguredApp.close();
  });

  it("stays disabled when GOOGLE_AUTH_ENABLED=false even with credentials configured", async () => {
    // The test environment always has GOOGLE_OAUTH_CLIENT_IDS set (see
    // vitest.config.ts) so this proves the *flag*, not credential absence,
    // is what gates the provider. Uses the real verifier (no DI override)
    // so the request never reaches Google's network — GOOGLE_AUTH_ENABLED
    // is checked before any HTTP call.
    expect(config.GOOGLE_AUTH_ENABLED).toBe(false);
    const unconfiguredApp = await createTestApp();
    const response = await unconfiguredApp.inject({ method: "POST", url: "/auth/google", payload: { idToken: "irrelevant" } });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("GOOGLE_AUTH_NOT_CONFIGURED");
    await unconfiguredApp.close();
  });

  it("stays disabled for linking when GOOGLE_AUTH_ENABLED=false even with credentials configured", async () => {
    expect(config.GOOGLE_AUTH_ENABLED).toBe(false);
    const unconfiguredApp = await createTestApp();
    const account = await registerAccount(unconfiguredApp, { email: "disabled-link@example.com" });
    const response = await unconfiguredApp.inject({
      method: "POST",
      url: "/auth/google/link",
      headers: authHeader(account.accessToken),
      payload: { idToken: "irrelevant" },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("GOOGLE_AUTH_NOT_CONFIGURED");
    await unconfiguredApp.close();
  });

  it("passes the config gate once GOOGLE_AUTH_ENABLED=true and credentials are present", () => {
    // Proves the flag (not credential presence, which is constant in the
    // test env — see vitest.config.ts) is what gates the provider: with the
    // flag on, the same guard verifyGoogleIdToken calls before ever
    // touching the network no longer throws.
    expect(config.GOOGLE_AUTH_ENABLED).toBe(false);
    expect(() => assertGoogleAuthEnabled()).toThrowError(
      expect.objectContaining({ code: "GOOGLE_AUTH_NOT_CONFIGURED" }),
    );

    config.GOOGLE_AUTH_ENABLED = true;
    try {
      expect(() => assertGoogleAuthEnabled()).not.toThrow();
    } finally {
      config.GOOGLE_AUTH_ENABLED = false;
    }
  });

  it("rejects expired, wrong-issuer, and wrong-audience token payloads", () => {
    const base: TokenPayload = {
      sub: "subject", email: "claims@example.com", email_verified: true, name: "Claims User",
      iss: "https://accounts.google.com", aud: "server-client", iat: now - 10, exp: now + 600,
    };
    const cases: TokenPayload[] = [
      { ...base, exp: now - 1 },
      { ...base, iss: "https://attacker.example.com" },
      { ...base, aud: "attacker-client" },
    ];
    for (const payload of cases) {
      expect(() => validateGooglePayload(payload, ["server-client"], now)).toThrowError(
        expect.objectContaining({ code: "GOOGLE_TOKEN_INVALID" }),
      );
    }
  });

  it("requires explicit linking when a verified Google email matches an existing account", async () => {
    await registerAccount(app, { email: "shared@example.com" });
    const response = await app.inject({ method: "POST", url: "/auth/google", payload: { idToken: "shared-email" } });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("ACCOUNT_LINK_REQUIRED");
    expect(await prisma.authIdentity.count()).toBe(0);
  });

  it("links Google explicitly and preserves the existing business membership", async () => {
    const account = await registerAccount(app, { email: "shared@example.com" });
    const membershipBefore = await prisma.businessMember.findFirstOrThrow({ where: { userId: account.userId } });
    const linked = await app.inject({
      method: "POST", url: "/auth/google/link", headers: authHeader(account.accessToken), payload: { idToken: "shared-email" },
    });
    expect(linked.statusCode).toBe(200);
    expect(linked.json()).toMatchObject({ provider: "GOOGLE", providerEmail: "shared@example.com" });

    const signIn = await app.inject({ method: "POST", url: "/auth/google", payload: { idToken: "shared-email" } });
    expect(signIn.statusCode).toBe(200);
    expect(signIn.json().user.id).toBe(account.userId);
    expect(signIn.json().business.id).toBe(account.businessId);
    const memberships = await prisma.businessMember.findMany({ where: { userId: account.userId } });
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.id).toBe(membershipBefore.id);
  });

  it("does not attach a Google subject linked to another user", async () => {
    const owner = await registerAccount(app, { email: "owner@example.com" });
    const other = await registerAccount(app, { email: "other@example.com" });
    const firstLink = await app.inject({
      method: "POST", url: "/auth/google/link", headers: authHeader(owner.accessToken), payload: { idToken: "valid-new" },
    });
    expect(firstLink.statusCode).toBe(200);
    const secondLink = await app.inject({
      method: "POST", url: "/auth/google/link", headers: authHeader(other.accessToken), payload: { idToken: "valid-new" },
    });
    expect(secondLink.statusCode).toBe(409);
    expect(secondLink.json().error.code).toBe("AUTH_IDENTITY_CONFLICT");
    expect(await prisma.authIdentity.count({ where: { providerSubject: "google-subject-1" } })).toBe(1);
  });

  it("does not let one user replace an already-linked Google identity", async () => {
    const account = await registerAccount(app);
    await app.inject({ method: "POST", url: "/auth/google/link", headers: authHeader(account.accessToken), payload: { idToken: "valid-new" } });
    const response = await app.inject({ method: "POST", url: "/auth/google/link", headers: authHeader(account.accessToken), payload: { idToken: "second-google" } });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("AUTH_PROVIDER_ALREADY_LINKED");
  });

  it("does not link a verified Google email owned by a different Chakusa user", async () => {
    await registerAccount(app, { email: "shared@example.com" });
    const other = await registerAccount(app, { email: "different@example.com" });
    const response = await app.inject({
      method: "POST", url: "/auth/google/link", headers: authHeader(other.accessToken), payload: { idToken: "shared-email" },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("AUTH_IDENTITY_CONFLICT");
    expect(await prisma.authIdentity.count()).toBe(0);
  });

  it("allows a new Google user to continue through business onboarding", async () => {
    const auth = await app.inject({ method: "POST", url: "/auth/google", payload: { idToken: "valid-new" } });
    expect(auth.json().business).toBeNull();
    const business = await app.inject({
      method: "POST", url: "/business", headers: authHeader(auth.json().accessToken), payload: { name: "Google Business", industry: "salon" },
    });
    expect(business.statusCode).toBe(201);
    const membership = await prisma.businessMember.findFirst({ where: { userId: auth.json().user.id } });
    expect(membership).toMatchObject({ businessId: business.json().id, role: "OWNER" });
  });

  it("deletes a provider-only account after fresh Google reauthentication", async () => {
    const auth = await app.inject({ method: "POST", url: "/auth/google", payload: { idToken: "valid-new" } });
    const response = await app.inject({
      method: "POST",
      url: "/auth/delete-account",
      headers: authHeader(auth.json().accessToken),
      payload: { googleIdToken: "valid-new" },
    });
    expect(response.statusCode).toBe(204);
    expect(await prisma.user.count({ where: { id: auth.json().user.id } })).toBe(0);
    expect(await prisma.authIdentity.count({ where: { providerSubject: "google-subject-1" } })).toBe(0);
  });

  it("preserves tenant isolation between Google users", async () => {
    const first = await app.inject({ method: "POST", url: "/auth/google", payload: { idToken: "valid-new" } });
    await app.inject({ method: "POST", url: "/business", headers: authHeader(first.json().accessToken), payload: { name: "First" } });
    const customer = await app.inject({ method: "POST", url: "/customers", headers: authHeader(first.json().accessToken), payload: { name: "Private Customer" } });

    const second = await app.inject({ method: "POST", url: "/auth/google", payload: { idToken: "second-google" } });
    await app.inject({ method: "POST", url: "/business", headers: authHeader(second.json().accessToken), payload: { name: "Second" } });
    const forbidden = await app.inject({ method: "GET", url: `/customers/${customer.json().id}`, headers: authHeader(second.json().accessToken) });
    expect(forbidden.statusCode).toBe(404);
  });
});
