import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import { config } from "../src/lib/config.js";
import { verifyCloudflareAccessToken } from "../src/lib/cloudflareAccess.js";

const { resolveJwks } = vi.hoisted(() => ({ resolveJwks: vi.fn() }));
vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  return { ...actual, createRemoteJWKSet: () => resolveJwks };
});

describe("Cloudflare Access signed assertion verification", () => {
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const issuer = "https://security-test-team.cloudflareaccess.com";
  const audience = "synthetic-admin-audience";
  const previous = { team: config.CF_ACCESS_TEAM_DOMAIN, audience: config.CF_ACCESS_AUD };
  beforeAll(() => {
    config.CF_ACCESS_TEAM_DOMAIN = "security-test-team";
    config.CF_ACCESS_AUD = audience;
    resolveJwks.mockResolvedValue(keys.publicKey);
  });
  afterAll(() => {
    config.CF_ACCESS_TEAM_DOMAIN = previous.team;
    config.CF_ACCESS_AUD = previous.audience;
  });
  async function token(options: { issuer?: string; audience?: string; expiry?: number | null; algorithm?: string; key?: KeyObject; email?: string | null } = {}) {
    let builder = new SignJWT(options.email === null ? {} : { email: options.email ?? "admin@security.example.test" })
      .setProtectedHeader({ alg: options.algorithm ?? "RS256" })
      .setSubject("synthetic-admin")
      .setIssuedAt()
      .setIssuer(options.issuer ?? issuer)
      .setAudience(options.audience ?? audience);
    if (options.expiry !== null) builder = builder.setExpirationTime(options.expiry ?? Math.floor(Date.now() / 1000) + 300);
    return builder.sign(options.key ?? keys.privateKey);
  }
  it("accepts a valid signed human identity", async () => {
    await expect(verifyCloudflareAccessToken(await token())).resolves.toEqual({ email: "admin@security.example.test" });
  });
  it("requires an expiration claim", async () => {
    await expect(verifyCloudflareAccessToken(await token({ expiry: null }))).rejects.toThrow();
  });
  it("rejects algorithms outside the Access RS256 contract", async () => {
    await expect(verifyCloudflareAccessToken(await token({ algorithm: "RS384" }))).rejects.toThrow();
  });
  it("rejects expired assertions", async () => {
    await expect(verifyCloudflareAccessToken(await token({ expiry: Math.floor(Date.now() / 1000) - 60 }))).rejects.toThrow();
  });
  it("rejects the wrong issuer", async () => {
    await expect(verifyCloudflareAccessToken(await token({ issuer: "https://other.cloudflareaccess.com" }))).rejects.toThrow();
  });
  it("rejects the wrong application audience", async () => {
    await expect(verifyCloudflareAccessToken(await token({ audience: "other-audience" }))).rejects.toThrow();
  });
  it("rejects a signature from a different key", async () => {
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    await expect(verifyCloudflareAccessToken(await token({ key: other.privateKey }))).rejects.toThrow();
  });
  it("rejects a token without a human email identity", async () => {
    await expect(verifyCloudflareAccessToken(await token({ email: null }))).rejects.toThrow();
  });
  it("rejects a missing assertion", async () => {
    await expect(verifyCloudflareAccessToken(null)).rejects.toThrow();
  });
});
