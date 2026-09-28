import { createRemoteJWKSet, jwtVerify } from "jose";
import { config } from "./config.js";

/**
 * Cloudflare Access verification - the second, independent auth layer in
 * front of the admin console (see src/plugins/adminAuth.ts's authenticateAdmin,
 * which calls this before trusting the app's own session JWT). Once a
 * visitor clears the Access application in front of the console's domain,
 * Cloudflare's edge attaches a short-lived, RS256-signed JWT to every
 * request it proxies - the Cf-Access-Jwt-Assertion header (a CF_Authorization
 * cookie carries the same token for regular page navigations). Verifying it
 * here, not just trusting the header is present, is what makes this a real
 * second layer: a request that skips Cloudflare's edge entirely (hits the
 * API directly) or carries a forged/expired token is rejected the same as
 * one with no token at all.
 *
 * The signing keys are Cloudflare's own, published per-team and rotated on
 * their schedule, not ours - createRemoteJWKSet fetches and caches them
 * lazily, matched by the token's `kid`, refetching once if none match (e.g.
 * a rotation), consistent with how this codebase's own JWT verification
 * (src/lib/authTokens.js) leaves signing entirely server-side.
 */

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksTeamDomain: string | null = null;

function certsUrl(teamDomain: string) {
  return new URL(`https://${teamDomain}.cloudflareaccess.com/cdn-cgi/access/certs`);
}

function getJwks(teamDomain: string) {
  if (!jwks || jwksTeamDomain !== teamDomain) {
    jwks = createRemoteJWKSet(certsUrl(teamDomain));
    jwksTeamDomain = teamDomain;
  }
  return jwks;
}

export class CloudflareAccessError extends Error {}

export interface CloudflareAccessIdentity {
  email: string;
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return undefined;
}

/** Extracts the Access assertion from either the header or the cookie Cloudflare sets - whichever the request carries. */
export function extractCloudflareAccessToken(request: { headers: Record<string, string | string[] | undefined> }): string | null {
  const header = request.headers["cf-access-jwt-assertion"];
  if (typeof header === "string" && header) return header;
  if (Array.isArray(header) && header[0]) return header[0];
  const rawCookie = request.headers.cookie;
  const cookieHeader = typeof rawCookie === "string" ? rawCookie : undefined;
  return cookieValue(cookieHeader, "CF_Authorization") ?? null;
}

/** Throws CloudflareAccessError on a missing, expired, wrongly-signed, or wrong-audience token. Never call without first checking config.CF_ACCESS_ENABLED. */
export async function verifyCloudflareAccessToken(token: string | null): Promise<CloudflareAccessIdentity> {
  if (!token) throw new CloudflareAccessError("Missing Cloudflare Access assertion");
  if (!config.CF_ACCESS_TEAM_DOMAIN || !config.CF_ACCESS_AUD) throw new CloudflareAccessError("Cloudflare Access is not configured");
  try {
    const { payload } = await jwtVerify(token, getJwks(config.CF_ACCESS_TEAM_DOMAIN), {
      issuer: `https://${config.CF_ACCESS_TEAM_DOMAIN}.cloudflareaccess.com`,
      audience: config.CF_ACCESS_AUD,
    });
    const email = typeof payload.email === "string" ? payload.email : null;
    if (!email) throw new CloudflareAccessError("Cloudflare Access assertion has no email claim");
    return { email };
  } catch (error) {
    if (error instanceof CloudflareAccessError) throw error;
    throw new CloudflareAccessError(error instanceof Error ? error.message : "Invalid Cloudflare Access assertion");
  }
}
