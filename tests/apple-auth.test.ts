import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { ApiError } from "../src/lib/errors.js";
import { config } from "../src/lib/config.js";
import { prisma } from "../src/lib/prisma.js";
import { requireAppleConfig, type AppleCodeExchanger, type AppleTokenVerifier, type VerifiedAppleIdentity } from "../src/modules/auth/appleAuth.js";
import { authHeader, createTestApp, registerAccount, resetDatabase } from "./helpers.js";

const identities: Record<string, Omit<VerifiedAppleIdentity, "nonce">> = {
  valid: { providerSubject: "apple-subject-1", email: "relay@privaterelay.appleid.com", emailVerified: true, issuedAt: Math.floor(Date.now() / 1000) },
  second: { providerSubject: "apple-subject-2", email: "second@example.com", emailVerified: true, issuedAt: Math.floor(Date.now() / 1000) },
  shared: { providerSubject: "apple-shared", email: "shared@example.com", emailVerified: true, issuedAt: Math.floor(Date.now() / 1000) },
};

const verifier: AppleTokenVerifier = async (token, nonce) => {
  if (token.startsWith("invalid") || !identities[token]) throw ApiError.auth(401, "APPLE_TOKEN_INVALID", "Apple identity token is invalid");
  return { ...identities[token], nonce } as VerifiedAppleIdentity;
};
const exchanger: AppleCodeExchanger = async (code) => {
  if (code === "invalid-code") throw ApiError.auth(401, "APPLE_CODE_INVALID", "Apple authorization code is invalid or expired");
  return { refreshToken: `apple-refresh-${code}`, identityToken: code.includes("shared") ? "shared" : code.includes("second") ? "second" : "valid" };
};

describe("Apple authentication", () => {
  let app: FastifyInstance;
  const revoked: string[] = [];

  beforeAll(async () => {
    // These tests simulate a fully working, enabled Apple integration via
    // DI overrides (fake verifier/exchanger/revoker); the provider-enabled
    // flag itself has no DI hook (see createAppleChallenge), so it must be
    // turned on directly for the duration of this suite.
    config.APPLE_AUTH_ENABLED = true;
    app = await createTestApp({ appleTokenVerifier: verifier, appleCodeExchanger: exchanger, appleCredentialRevoker: async token => { revoked.push(token); } });
  });
  afterEach(async () => { revoked.length = 0; await resetDatabase(); });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); config.APPLE_AUTH_ENABLED = false; });

  async function challenge(path = "/auth/apple/challenge", token?: string) {
    const response = await app.inject({ method: "POST", url: path, headers: token ? authHeader(token) : undefined });
    expect(response.statusCode).toBe(200);
    return response.json();
  }

  async function credential(token = "valid", path = "/auth/apple/challenge", accessToken?: string, code = "code-1") {
    const issued = await challenge(path, accessToken);
    return { ...issued, identityToken: token, authorizationCode: code, givenName: "Apple", familyName: "Person" };
  }

  it("creates an Apple-only user, preserves relay email, and uses Chakusa sessions", async () => {
    const payload = await credential();
    const response = await app.inject({ method: "POST", url: "/auth/apple", payload });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ isNewUser: true, business: null, user: { email: "relay@privaterelay.appleid.com", fullName: "Apple Person", hasPassword: false, authProviders: ["APPLE"] } });
    const identity = await prisma.authIdentity.findFirstOrThrow({ where: { provider: "APPLE" } });
    expect(identity.encryptedRefreshToken).toBeTruthy();
    expect(identity.encryptedRefreshToken).not.toContain("apple-refresh-code-1");
    expect(await prisma.authSession.count({ where: { userId: identity.userId } })).toBe(1);
  });

  it("signs in the same Apple subject without replacing its first-use name", async () => {
    const firstPayload = await credential();
    const first = await app.inject({ method: "POST", url: "/auth/apple", payload: firstPayload });
    const secondPayload = { ...await credential(), givenName: "Changed", familyName: "Name" };
    const second = await app.inject({ method: "POST", url: "/auth/apple", payload: secondPayload });
    expect(second.statusCode).toBe(200);
    expect(second.json().user.id).toBe(first.json().user.id);
    expect(second.json().user.fullName).toBe("Apple Person");
    expect(await prisma.user.count()).toBe(1);
  });

  it.each(["invalid-signature", "invalid-issuer", "invalid-audience", "invalid-expired", "invalid-nonce", "invalid-unverified-email"])("rejects invalid Apple identity evidence: %s", async identityToken => {
    const response = await app.inject({ method: "POST", url: "/auth/apple", payload: await credential(identityToken) });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("APPLE_TOKEN_INVALID");
    expect(await prisma.user.count()).toBe(0);
  });

  it("rejects an invalid authorization code without consuming the identity", async () => {
    const response = await app.inject({ method: "POST", url: "/auth/apple", payload: await credential("valid", "/auth/apple/challenge", undefined, "invalid-code") });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("APPLE_CODE_INVALID");
    expect(await prisma.authIdentity.count()).toBe(0);
  });

  it("rejects an authorization code issued for a different Apple subject", async () => {
    const response = await app.inject({ method: "POST", url: "/auth/apple", payload: await credential("valid", "/auth/apple/challenge", undefined, "second-code") });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("APPLE_CODE_INVALID");
    expect(await prisma.authIdentity.count()).toBe(0);
  });

  it("rejects altered, expired, and reused server challenges", async () => {
    const altered = await credential();
    expect((await app.inject({ method: "POST", url: "/auth/apple", payload: { ...altered, state: `${altered.state}x` } })).json().error.code).toBe("APPLE_CHALLENGE_INVALID");

    const expired = await credential();
    await prisma.authChallenge.update({ where: { id: expired.challengeId }, data: { expiresAt: new Date(0) } });
    expect((await app.inject({ method: "POST", url: "/auth/apple", payload: expired })).json().error.code).toBe("APPLE_CHALLENGE_EXPIRED");

    const used = await credential();
    expect((await app.inject({ method: "POST", url: "/auth/apple", payload: used })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/auth/apple", payload: used })).json().error.code).toBe("APPLE_CHALLENGE_USED");
  });

  it("requires explicit linking when verified Apple email already exists", async () => {
    await registerAccount(app, { email: "shared@example.com" });
    const response = await app.inject({ method: "POST", url: "/auth/apple", payload: await credential("shared", "/auth/apple/challenge", undefined, "shared-code") });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("ACCOUNT_LINK_REQUIRED");
    expect(await prisma.authIdentity.count()).toBe(0);
  });

  it("links Apple explicitly while preserving business membership", async () => {
    const account = await registerAccount(app, { email: "shared@example.com" });
    const payload = await credential("shared", "/auth/apple/link/challenge", account.accessToken, "shared-code");
    const linked = await app.inject({ method: "POST", url: "/auth/apple/link", headers: authHeader(account.accessToken), payload });
    expect(linked.statusCode).toBe(200);
    const signIn = await app.inject({ method: "POST", url: "/auth/apple", payload: await credential("shared", "/auth/apple/challenge", undefined, "shared-code") });
    expect(signIn.json().user.id).toBe(account.userId);
    expect(signIn.json().business.id).toBe(account.businessId);
    expect(await prisma.businessMember.count({ where: { userId: account.userId } })).toBe(1);
  });

  it("lets a new Apple user continue through the existing business onboarding API", async () => {
    const auth = await app.inject({ method: "POST", url: "/auth/apple", payload: await credential() });
    expect(auth.json().business).toBeNull();
    const business = await app.inject({ method: "POST", url: "/business", headers: authHeader(auth.json().accessToken), payload: { name: "Apple Business", industry: "salon" } });
    expect(business.statusCode).toBe(201);
    expect(await prisma.businessMember.findFirst({ where: { userId: auth.json().user.id } })).toMatchObject({ businessId: business.json().id, role: "OWNER" });
  });

  it("prevents cross-user Apple identity attachment", async () => {
    const first = await registerAccount(app, { email: "first@example.com" });
    const second = await registerAccount(app, { email: "other@example.com" });
    const firstPayload = await credential("valid", "/auth/apple/link/challenge", first.accessToken);
    expect((await app.inject({ method: "POST", url: "/auth/apple/link", headers: authHeader(first.accessToken), payload: firstPayload })).statusCode).toBe(200);
    const secondPayload = await credential("valid", "/auth/apple/link/challenge", second.accessToken);
    const conflict = await app.inject({ method: "POST", url: "/auth/apple/link", headers: authHeader(second.accessToken), payload: secondPayload });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("AUTH_IDENTITY_CONFLICT");
  });

  it("preserves tenant isolation between Apple users", async () => {
    const first = await app.inject({ method: "POST", url: "/auth/apple", payload: await credential() });
    await app.inject({ method: "POST", url: "/business", headers: authHeader(first.json().accessToken), payload: { name: "First Apple Business" } });
    const customer = await app.inject({ method: "POST", url: "/customers", headers: authHeader(first.json().accessToken), payload: { name: "Private Customer" } });

    const second = await app.inject({ method: "POST", url: "/auth/apple", payload: await credential("second", "/auth/apple/challenge", undefined, "second-code") });
    await app.inject({ method: "POST", url: "/business", headers: authHeader(second.json().accessToken), payload: { name: "Second Apple Business" } });
    const forbidden = await app.inject({ method: "GET", url: `/customers/${customer.json().id}`, headers: authHeader(second.json().accessToken) });
    expect(forbidden.statusCode).toBe(404);
  });

  it("revokes Apple credentials before deleting account data and sessions", async () => {
    const auth = await app.inject({ method: "POST", url: "/auth/apple", payload: await credential() });
    const payload = await credential("valid", "/auth/apple/delete/challenge", auth.json().accessToken, "delete-code");
    const response = await app.inject({ method: "POST", url: "/auth/delete-account", headers: authHeader(auth.json().accessToken), payload: { apple: payload } });
    expect(response.statusCode).toBe(204);
    expect(revoked.sort()).toEqual(["apple-refresh-code-1", "apple-refresh-delete-code"].sort());
    expect(await prisma.user.count({ where: { id: auth.json().user.id } })).toBe(0);
    expect(await prisma.authSession.count({ where: { userId: auth.json().user.id } })).toBe(0);
  });

  it("does not delete when Apple credential revocation fails", async () => {
    const failing = await createTestApp({ appleTokenVerifier: verifier, appleCodeExchanger: exchanger, appleCredentialRevoker: async () => { throw ApiError.auth(502, "APPLE_REVOCATION_FAILED", "failed"); } });
    const signInChallenge = (await failing.inject({ method: "POST", url: "/auth/apple/challenge" })).json();
    const auth = await failing.inject({ method: "POST", url: "/auth/apple", payload: { ...signInChallenge, identityToken: "valid", authorizationCode: "code-1" } });
    const deleteChallenge = (await failing.inject({ method: "POST", url: "/auth/apple/delete/challenge", headers: authHeader(auth.json().accessToken) })).json();
    const response = await failing.inject({ method: "POST", url: "/auth/delete-account", headers: authHeader(auth.json().accessToken), payload: { apple: { ...deleteChallenge, identityToken: "valid", authorizationCode: "delete-code" } } });
    expect(response.statusCode).toBe(502);
    expect(await prisma.user.count({ where: { id: auth.json().user.id } })).toBe(1);
    await failing.close();
  });
});

describe("Apple authentication — provider-enabled flag", () => {
  afterEach(resetDatabase);

  it("stays disabled when APPLE_AUTH_ENABLED=false even with credentials configured", async () => {
    // The test environment always has full Apple credentials set (see
    // vitest.config.ts) so this proves the *flag*, not credential absence,
    // is what gates the provider. Uses a plain app with no Apple DI
    // overrides so the real requireAppleConfig gate runs.
    expect(config.APPLE_AUTH_ENABLED).toBe(false);
    const unconfiguredApp = await createTestApp();

    const challenge = await unconfiguredApp.inject({ method: "POST", url: "/auth/apple/challenge" });
    expect(challenge.statusCode).toBe(503);
    expect(challenge.json().error.code).toBe("APPLE_AUTH_NOT_CONFIGURED");

    const account = await registerAccount(unconfiguredApp, { email: "apple-disabled-link@example.com" });
    const linkChallenge = await unconfiguredApp.inject({
      method: "POST",
      url: "/auth/apple/link/challenge",
      headers: authHeader(account.accessToken),
    });
    expect(linkChallenge.statusCode).toBe(503);
    expect(linkChallenge.json().error.code).toBe("APPLE_AUTH_NOT_CONFIGURED");

    await unconfiguredApp.close();
  });

  it("passes the config gate once APPLE_AUTH_ENABLED=true and credentials are present", () => {
    expect(config.APPLE_AUTH_ENABLED).toBe(false);
    expect(() => requireAppleConfig()).toThrowError(
      expect.objectContaining({ code: "APPLE_AUTH_NOT_CONFIGURED" }),
    );

    config.APPLE_AUTH_ENABLED = true;
    try {
      expect(() => requireAppleConfig()).not.toThrow();
    } finally {
      config.APPLE_AUTH_ENABLED = false;
    }
  });
});
