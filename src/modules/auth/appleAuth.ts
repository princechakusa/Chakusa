import { createHash } from "node:crypto";
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from "jose";
import { config } from "../../lib/config.js";
import { ApiError } from "../../lib/errors.js";

const APPLE_ISSUER = "https://appleid.apple.com";
const appleKeys = createRemoteJWKSet(new URL(`${APPLE_ISSUER}/auth/keys`));

export interface VerifiedAppleIdentity {
  providerSubject: string;
  email: string;
  emailVerified: true;
  nonce: string;
  issuedAt: number;
}

export interface AppleTokenSet { refreshToken: string; identityToken: string; }
export type AppleTokenVerifier = (identityToken: string, expectedNonce: string) => Promise<VerifiedAppleIdentity>;
export type AppleCodeExchanger = (authorizationCode: string) => Promise<AppleTokenSet>;
export type AppleCredentialRevoker = (refreshToken: string) => Promise<void>;

export function requireAppleConfig() {
  const { APPLE_AUTH_ENABLED, APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY_BASE64 } = config;
  // APPLE_AUTH_ENABLED is the authoritative switch: even if credentials are
  // present (e.g. left over from a prior configuration), the provider must
  // stay disabled until the flag is explicitly turned on.
  if (!APPLE_AUTH_ENABLED || !APPLE_CLIENT_ID || !APPLE_TEAM_ID || !APPLE_KEY_ID || !APPLE_PRIVATE_KEY_BASE64) {
    throw ApiError.auth(503, "APPLE_AUTH_NOT_CONFIGURED", "Apple authentication is not configured");
  }
  return { clientId: APPLE_CLIENT_ID, teamId: APPLE_TEAM_ID, keyId: APPLE_KEY_ID, privateKey: Buffer.from(APPLE_PRIVATE_KEY_BASE64, "base64").toString("utf8") };
}

async function clientSecret() {
  const apple = requireAppleConfig();
  const key = await importPKCS8(apple.privateKey, "ES256");
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: apple.keyId })
    .setIssuer(apple.teamId)
    .setSubject(apple.clientId)
    .setAudience(APPLE_ISSUER)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key);
}

export async function verifyAppleIdentityToken(identityToken: string, expectedNonce: string): Promise<VerifiedAppleIdentity> {
  const apple = requireAppleConfig();
  try {
    const { payload } = await jwtVerify(identityToken, appleKeys, {
      issuer: APPLE_ISSUER,
      audience: apple.clientId,
      algorithms: ["RS256"],
    });
    const verified = payload.email_verified === true || payload.email_verified === "true";
    if (!payload.sub || typeof payload.email !== "string" || !verified || payload.nonce !== expectedNonce || !payload.iat) {
      throw new Error("Required Apple identity claims are missing or invalid");
    }
    return { providerSubject: payload.sub, email: payload.email, emailVerified: true, nonce: expectedNonce, issuedAt: payload.iat };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw ApiError.auth(401, "APPLE_TOKEN_INVALID", "Apple identity token is invalid");
  }
}

async function appleTokenRequest(path: "token" | "revoke", body: URLSearchParams) {
  const response = await fetch(`${APPLE_ISSUER}/auth/${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  return response;
}

export async function exchangeAppleAuthorizationCode(authorizationCode: string): Promise<AppleTokenSet> {
  const apple = requireAppleConfig();
  const response = await appleTokenRequest("token", new URLSearchParams({
    client_id: apple.clientId,
    client_secret: await clientSecret(),
    code: authorizationCode,
    grant_type: "authorization_code",
  }));
  if (!response.ok) throw ApiError.auth(401, "APPLE_CODE_INVALID", "Apple authorization code is invalid or expired");
  const body = await response.json() as { refresh_token?: unknown; id_token?: unknown };
  if (typeof body.refresh_token !== "string" || !body.refresh_token || typeof body.id_token !== "string" || !body.id_token) {
    throw ApiError.auth(401, "APPLE_CODE_INVALID", "Apple did not issue a refresh credential");
  }
  return { refreshToken: body.refresh_token, identityToken: body.id_token };
}

export async function revokeAppleCredential(refreshToken: string) {
  const apple = requireAppleConfig();
  const response = await appleTokenRequest("revoke", new URLSearchParams({
    client_id: apple.clientId,
    client_secret: await clientSecret(),
    token: refreshToken,
    token_type_hint: "refresh_token",
  }));
  if (!response.ok) throw ApiError.auth(502, "APPLE_REVOCATION_FAILED", "Apple credential revocation failed");
}

export const appleChallengeHash = (value: string) => createHash("sha256").update(value).digest("hex");
