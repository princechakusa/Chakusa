import { X509Certificate } from "node:crypto";
import { compactVerify, decodeProtectedHeader, type ProtectedHeaderParameters } from "jose";
import { config } from "../config.js";

// A real Apple x5c chain is leaf + one intermediate (2 entries). Bounding
// this well above that (rather than trusting whatever length an attacker
// sends) is a cheap guard against a payload trying to make chain
// verification expensive by supplying an enormous certificate array.
const MAX_CHAIN_LENGTH = 5;

/**
 * Apple's App Store Server Library / App Store Server Notifications both
 * sign payloads as a JWS whose protected header carries the signing
 * certificate chain (`x5c`) instead of a fetchable JWKS URL (unlike Sign in
 * with Apple's identity tokens — see appleAuth.ts's createRemoteJWKSet,
 * which doesn't apply here). Trust is established by walking that chain up
 * to a certificate this deployment has been explicitly told to trust, not
 * by trusting whatever `x5c` claims about itself.
 *
 * DEPLOYMENT REQUIREMENT: `APPLE_ROOT_CERTIFICATES_BASE64` must be set to
 * one or more base64-DER-encoded Apple root certificates (comma-separated),
 * downloaded from Apple's published PKI
 * (https://www.apple.com/certificateauthority/) at deploy time — "Apple
 * Root CA - G3" is the root that actually signs the App Store Server API's
 * certificate chain today. Multiple roots are supported (comma-separated)
 * specifically so a future Apple root rotation can be handled by adding
 * the new root alongside the old one, then removing the old one later,
 * without a deploy-time gap where verification breaks.
 *
 * This backend deliberately does NOT embed a hardcoded copy of Apple's
 * root certificate: Apple rotates/adds roots over time, and shipping a
 * guessed-from-memory or stale certificate would be worse than an explicit
 * configuration requirement — it would either silently fail to verify
 * anything (safe but broken) or, far worse, create false confidence in a
 * verification path that was never actually checked against Apple's real
 * PKI. See the Phase report's "store-console configuration still required"
 * section.
 */
function trustedAppleRootCertificates(): X509Certificate[] {
  const raw = config.APPLE_ROOT_CERTIFICATES_BASE64;
  if (!raw) return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => new X509Certificate(Buffer.from(value, "base64")));
}

/**
 * Startup validation (Phase 1.1 hardening): parses every configured root
 * certificate eagerly and throws a clear, specific error if any of them is
 * malformed — called from app.ts's buildApp() when APPLE_BILLING_ENABLED is
 * true, so a broken trust configuration fails the deployment at boot
 * instead of silently failing every real purchase/notification at runtime
 * (which would otherwise only surface as a stream of "certificate chain is
 * not trusted" errors with no obvious cause). Also rejects the
 * enabled-but-empty case, since verifyCertificateChain trivially returns
 * false for zero configured roots and would produce the exact same
 * confusing runtime symptom.
 */
export function assertValidAppleRootCertificates(): void {
  const raw = config.APPLE_ROOT_CERTIFICATES_BASE64;
  if (!raw) {
    throw new Error("APPLE_ROOT_CERTIFICATES_BASE64 is required when APPLE_BILLING_ENABLED=true");
  }
  const entries = raw.split(",").map((value) => value.trim()).filter(Boolean);
  if (entries.length === 0) {
    throw new Error("APPLE_ROOT_CERTIFICATES_BASE64 is set but contains no certificates");
  }
  for (const [index, entry] of entries.entries()) {
    try {
      const parsed = new X509Certificate(Buffer.from(entry, "base64"));
      void parsed;
    } catch (error) {
      throw new Error(`APPLE_ROOT_CERTIFICATES_BASE64 entry ${index + 1} is not a valid DER certificate: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function withinValidity(cert: X509Certificate, now: Date): boolean {
  return new Date(cert.validFrom) <= now && now <= new Date(cert.validTo);
}

/**
 * Verifies that `chain` (leaf-first, as delivered in a JWS header's `x5c`)
 * is a structurally and cryptographically valid path from the leaf
 * certificate up to one of `roots` — every certificate must be currently
 * valid, every non-leaf certificate must actually be a CA (BasicConstraints
 * CA=true — a leaf certificate being used to "sign" a fabricated
 * intermediate would otherwise structurally look like a valid link), and
 * each certificate in the chain must actually be signed by the next one's
 * key (not merely claim the right issuer name).
 */
export function verifyCertificateChain(chain: X509Certificate[], roots: X509Certificate[], now: Date = new Date()): boolean {
  if (chain.length === 0 || chain.length > MAX_CHAIN_LENGTH || roots.length === 0) return false;
  for (const cert of chain) {
    if (!withinValidity(cert, now)) return false;
  }

  for (let index = 0; index < chain.length - 1; index += 1) {
    const subject = chain[index]!;
    const issuer = chain[index + 1]!;
    if (!issuer.ca) return false;
    if (!subject.checkIssued(issuer) || !subject.verify(issuer.publicKey)) return false;
  }

  const top = chain[chain.length - 1]!;
  return roots.some((root) => root.ca && withinValidity(root, now) && top.checkIssued(root) && top.verify(root.publicKey));
}

export interface VerifiedJwsPayload<T> {
  payload: T;
  header: ProtectedHeaderParameters;
}

/**
 * Verifies a compact JWS whose protected header carries an `x5c` certificate
 * chain (Apple's signed transaction/renewal info and Server Notifications
 * V2 payloads all use this shape) and returns its decoded JSON payload.
 * Never returns anything for a JWS that doesn't chain to a trusted Apple
 * root — callers must never fall back to trusting an unverified payload.
 */
export async function verifyAppleSignedPayload<T>(jws: string): Promise<VerifiedJwsPayload<T>> {
  const header = decodeProtectedHeader(jws);
  const x5c = header.x5c;
  if (!Array.isArray(x5c) || x5c.length === 0 || x5c.length > MAX_CHAIN_LENGTH) {
    throw new Error("Signed payload is missing its certificate chain");
  }

  let chain: X509Certificate[];
  try {
    chain = x5c.map((cert) => new X509Certificate(Buffer.from(cert as string, "base64")));
  } catch {
    throw new Error("Signed payload's certificate chain could not be parsed");
  }

  const roots = trustedAppleRootCertificates();
  if (!verifyCertificateChain(chain, roots)) {
    throw new Error("Signed payload's certificate chain is not trusted");
  }

  const leafKey = chain[0]!.publicKey;
  const { payload } = await compactVerify(jws, leafKey, { algorithms: ["ES256"] });
  const decoded = JSON.parse(Buffer.from(payload).toString("utf8")) as T;
  return { payload: decoded, header };
}
