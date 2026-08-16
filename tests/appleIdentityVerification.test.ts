import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { config, envSchema } from "../src/lib/config.js";
import { verifyAppleIdentityToken } from "../src/modules/auth/appleAuth.js";

/**
 * Chakusa Sign in with Apple — production readiness audit, Section 3/13.
 *
 * The existing tests/apple-auth.test.ts suite DI-injects a fake
 * AppleTokenVerifier at the route level (see its own `verifier` mock) — a
 * deliberate, correct choice for testing route/business-logic behavior
 * without a real network call, but it means the REAL
 * verifyAppleIdentityToken() implementation (appleAuth.ts's actual
 * jose-based signature/issuer/audience/expiry check against Apple's JWKS)
 * was never itself exercised by any test. This file closes that gap by
 * calling verifyAppleIdentityToken() directly with real, locally-signed
 * JWTs — mocking only the network fetch to Apple's public-keys endpoint
 * (https://appleid.apple.com/auth/keys), never Apple's verification logic
 * itself. No real Apple network call is made anywhere in this file.
 */

const APPLE_ISSUER = "https://appleid.apple.com";
const JWKS_URL = `${APPLE_ISSUER}/auth/keys`;
const CLIENT_ID = "com.chakusa.mobile";
const KID = "test-apple-signing-key-1";

let signingKeyPair: Awaited<ReturnType<typeof generateKeyPair>>;
let otherKeyPair: Awaited<ReturnType<typeof generateKeyPair>>;
let signingJwk: Record<string, unknown>;
const originalFetch = globalThis.fetch;

async function sign(claims: Record<string, unknown>, { key = signingKeyPair.privateKey, kid = KID, expiresIn = "5m" }: { key?: typeof signingKeyPair.privateKey; kid?: string; expiresIn?: string } = {}) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key);
}

function validClaims(overrides: Record<string, unknown> = {}) {
  return {
    iss: APPLE_ISSUER,
    aud: CLIENT_ID,
    sub: "apple-real-verification-subject",
    email: "real-verify@privaterelay.appleid.com",
    email_verified: true,
    ...overrides,
  };
}

describe("verifyAppleIdentityToken: real JWT verification against a mocked JWKS", () => {
  beforeAll(async () => {
    signingKeyPair = await generateKeyPair("RS256", { extractable: true });
    otherKeyPair = await generateKeyPair("RS256", { extractable: true });
    signingJwk = { ...(await exportJWK(signingKeyPair.publicKey)), kid: KID, alg: "RS256", use: "sig" };

    config.APPLE_CLIENT_ID = CLIENT_ID;
    // verifyAppleIdentityToken calls requireAppleConfig() first, which
    // fails closed unless the provider is explicitly enabled — restored in
    // afterAll, same pattern as tests/apple-auth.test.ts.
    config.APPLE_AUTH_ENABLED = true;

    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === JWKS_URL) {
        return new Response(JSON.stringify({ keys: [signingJwk] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return originalFetch(input, init);
    }) as typeof fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    config.APPLE_AUTH_ENABLED = false;
  });

  afterEach(() => {
    config.APPLE_CLIENT_ID = CLIENT_ID;
    config.APPLE_AUTH_ENABLED = true;
  });

  it("accepts a validly signed token with the correct issuer, audience, and matching nonce", async () => {
    const token = await sign(validClaims({ nonce: "expected-nonce" }));
    const identity = await verifyAppleIdentityToken(token, "expected-nonce");
    expect(identity.providerSubject).toBe("apple-real-verification-subject");
    expect(identity.email).toBe("real-verify@privaterelay.appleid.com");
    expect(identity.emailVerified).toBe(true);
  });

  it("rejects a token with the wrong issuer", async () => {
    const token = await sign(validClaims({ iss: "https://attacker.example.com", nonce: "n" }));
    await expect(verifyAppleIdentityToken(token, "n")).rejects.toMatchObject({ code: "APPLE_TOKEN_INVALID" });
  });

  it("rejects a token with the wrong audience (not com.chakusa.mobile)", async () => {
    const token = await sign(validClaims({ aud: "com.attacker.app", nonce: "n" }));
    await expect(verifyAppleIdentityToken(token, "n")).rejects.toMatchObject({ code: "APPLE_TOKEN_INVALID" });
  });

  it("rejects an expired token", async () => {
    const token = await sign(validClaims({ nonce: "n" }), { expiresIn: "-10s" });
    await expect(verifyAppleIdentityToken(token, "n")).rejects.toMatchObject({ code: "APPLE_TOKEN_INVALID" });
  });

  it("rejects a token signed by a key not present in Apple's (mocked) JWKS", async () => {
    const token = await sign(validClaims({ nonce: "n" }), { key: otherKeyPair.privateKey });
    await expect(verifyAppleIdentityToken(token, "n")).rejects.toMatchObject({ code: "APPLE_TOKEN_INVALID" });
  });

  it("rejects a tampered token (payload altered after signing)", async () => {
    const token = await sign(validClaims({ nonce: "n" }));
    const [header, payload, signature] = token.split(".");
    const tamperedPayload = Buffer.from(payload!, "base64url").toString("utf8").replace("apple-real-verification-subject", "someone-elses-subject");
    const tampered = `${header}.${Buffer.from(tamperedPayload).toString("base64url")}.${signature}`;
    await expect(verifyAppleIdentityToken(tampered, "n")).rejects.toMatchObject({ code: "APPLE_TOKEN_INVALID" });
  });

  it("rejects a token whose nonce does not match the server-issued challenge nonce", async () => {
    const token = await sign(validClaims({ nonce: "issued-nonce" }));
    await expect(verifyAppleIdentityToken(token, "different-nonce")).rejects.toMatchObject({ code: "APPLE_TOKEN_INVALID" });
  });

  it("rejects a token with email_verified: false", async () => {
    const token = await sign(validClaims({ nonce: "n", email_verified: false }));
    await expect(verifyAppleIdentityToken(token, "n")).rejects.toMatchObject({ code: "APPLE_TOKEN_INVALID" });
  });

  it("rejects a token missing the sub claim", async () => {
    const claims = validClaims({ nonce: "n" });
    delete (claims as Record<string, unknown>).sub;
    const token = await sign(claims);
    await expect(verifyAppleIdentityToken(token, "n")).rejects.toMatchObject({ code: "APPLE_TOKEN_INVALID" });
  });
});

describe("config.ts: APPLE_AUTH_ENABLED=true fails safely in production without full Apple config", () => {
  function baseProductionEnv(overrides: Record<string, string> = {}) {
    return {
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/chakusa_test?schema=public",
      JWT_SECRET: "a-fake-but-long-enough-test-jwt-secret",
      NODE_ENV: "production",
      PUBLIC_REVIEW_BASE_URL: "https://chakusa.example.com",
      ...overrides,
    };
  }

  it("production boots with APPLE_AUTH_ENABLED=false and no Apple config", () => {
    const result = envSchema.safeParse(baseProductionEnv({ APPLE_AUTH_ENABLED: "false" }));
    expect(result.success).toBe(true);
  });

  it("APPLE_AUTH_ENABLED=true without any Apple credentials fails closed", () => {
    const result = envSchema.safeParse(baseProductionEnv({ APPLE_AUTH_ENABLED: "true" }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors.APPLE_CLIENT_ID).toBeDefined();
  });

  it("APPLE_AUTH_ENABLED=true requires PROVIDER_TOKEN_ENCRYPTION_KEY even when the other four Apple values are present", () => {
    const result = envSchema.safeParse(baseProductionEnv({
      APPLE_AUTH_ENABLED: "true",
      APPLE_CLIENT_ID: "com.chakusa.mobile",
      APPLE_TEAM_ID: "N5DSK22C62",
      APPLE_KEY_ID: "2G96HS3R93",
      APPLE_PRIVATE_KEY_BASE64: Buffer.from("not-a-real-key").toString("base64"),
    }));
    expect(result.success).toBe(false);
  });

  it("APPLE_AUTH_ENABLED=true with the full real-shaped Apple config boots successfully", () => {
    const result = envSchema.safeParse(baseProductionEnv({
      APPLE_AUTH_ENABLED: "true",
      APPLE_CLIENT_ID: "com.chakusa.mobile",
      APPLE_TEAM_ID: "N5DSK22C62",
      APPLE_KEY_ID: "2G96HS3R93",
      APPLE_PRIVATE_KEY_BASE64: Buffer.from("not-a-real-key").toString("base64"),
      PROVIDER_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    }));
    expect(result.success).toBe(true);
  });
});
