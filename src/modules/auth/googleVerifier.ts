import { OAuth2Client, type TokenPayload } from "google-auth-library";
import { ApiError } from "../../lib/errors.js";
import { config, googleOAuthClientIds } from "../../lib/config.js";
import { normalizeEmail } from "../../lib/email.js";

const googleClient = new OAuth2Client();
const validIssuers = new Set(["accounts.google.com", "https://accounts.google.com"]);

export interface VerifiedGoogleIdentity {
  providerSubject: string;
  email: string;
  fullName: string;
  issuedAt: number;
}

export type GoogleTokenVerifier = (idToken: string) => Promise<VerifiedGoogleIdentity>;

function invalidGoogleToken(): never {
  throw ApiError.auth(401, "GOOGLE_TOKEN_INVALID", "Google identity token is invalid or expired");
}

export function validateGooglePayload(
  payload: TokenPayload,
  audiences: readonly string[],
  nowSeconds = Math.floor(Date.now() / 1000),
): VerifiedGoogleIdentity {
  if (!payload.sub || !payload.iss || !validIssuers.has(payload.iss)) invalidGoogleToken();
  if (!payload.aud || !audiences.includes(payload.aud)) invalidGoogleToken();
  if (!payload.exp || payload.exp <= nowSeconds || !payload.iat || payload.iat > nowSeconds + 60) invalidGoogleToken();
  if (!payload.email || payload.email_verified !== true) invalidGoogleToken();

  const email = normalizeEmail(payload.email);
  return {
    providerSubject: payload.sub,
    email,
    fullName: payload.name?.trim() || email.split("@")[0] || "Chakusa user",
    issuedAt: payload.iat,
  };
}

export function requireFreshGoogleIdentity(identity: VerifiedGoogleIdentity, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (identity.issuedAt < nowSeconds - 300 || identity.issuedAt > nowSeconds + 60) {
    throw ApiError.auth(401, "GOOGLE_TOKEN_INVALID", "Fresh Google authentication is required to link this account");
  }
}

/**
 * GOOGLE_AUTH_ENABLED is the authoritative switch: even if credentials are
 * present (e.g. left over from a prior configuration), the provider must
 * stay disabled until the flag is explicitly turned on. Exported
 * separately so it can be unit-tested without exercising the network call
 * inside verifyGoogleIdToken.
 */
export function assertGoogleAuthEnabled() {
  if (!config.GOOGLE_AUTH_ENABLED || googleOAuthClientIds.length === 0) {
    throw ApiError.auth(503, "GOOGLE_AUTH_NOT_CONFIGURED", "Google Sign-In is not configured on this server");
  }
}

export const verifyGoogleIdToken: GoogleTokenVerifier = async (idToken) => {
  assertGoogleAuthEnabled();
  try {
    const ticket = await googleClient.verifyIdToken({ idToken, audience: googleOAuthClientIds });
    const payload = ticket.getPayload();
    if (!payload) invalidGoogleToken();
    return validateGooglePayload(payload, googleOAuthClientIds);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    invalidGoogleToken();
  }
};
