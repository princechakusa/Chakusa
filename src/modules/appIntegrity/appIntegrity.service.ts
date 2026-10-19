import { createHmac, randomBytes } from "node:crypto";
import { GoogleAuth } from "google-auth-library";
import { SignJWT, jwtVerify } from "jose";
import { config } from "../../lib/config.js";

// Google Play Integrity for the Android app. The server issues a single-purpose
// nonce, the app asks Google Play for an integrity token bound to it, and the
// server has Google decode that token. Only a genuine, Play-recognized build
// signed with our app-signing key on a real device earns a short attestation,
// which the app then sends with its sign-in requests.

const CHALLENGE_TTL_SECONDS = 5 * 60;
const ATTESTATION_TTL_SECONDS = 12 * 60 * 60;
const MAX_TOKEN_AGE_MS = 10 * 60 * 1000;

/** The decoded `tokenPayloadExternal` from decodeIntegrityToken (fields we use). */
export interface IntegrityPayload {
  requestDetails?: { requestPackageName?: string; nonce?: string; timestampMillis?: string };
  appIntegrity?: { appRecognitionVerdict?: string; packageName?: string; certificateSha256Digest?: string[] };
  deviceIntegrity?: { deviceRecognitionVerdict?: string[] };
}

export type IntegrityDecoder = (integrityToken: string) => Promise<IntegrityPayload>;

const signingKey = () => createHmac("sha256", config.JWT_SECRET).update("chakusa-app-integrity-v1").digest();

export async function issueChallenge(): Promise<{ challenge: string; nonce: string }> {
  // Play Integrity requires a URL-safe base64 nonce of 16-500 characters.
  const nonce = randomBytes(32).toString("base64url");
  const challenge = await new SignJWT({ purpose: "play-integrity-challenge", nonce })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${CHALLENGE_TTL_SECONDS}s`)
    .sign(signingKey());
  return { challenge, nonce };
}

async function challengeNonce(challenge: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(challenge, signingKey(), { algorithms: ["HS256"] });
    return payload.purpose === "play-integrity-challenge" && typeof payload.nonce === "string" ? payload.nonce : null;
  } catch {
    return null;
  }
}

const allowedCertificates = () =>
  new Set((config.PLAY_INTEGRITY_CERT_SHA256 ?? "").split(",").map((value) => value.trim()).filter(Boolean));

/** Every reason a payload is not acceptable; empty means genuine. */
export function integrityRejections(payload: IntegrityPayload, expectedNonce: string, now = Date.now()): string[] {
  const reasons: string[] = [];
  const request = payload.requestDetails ?? {};
  const app = payload.appIntegrity ?? {};
  const device = payload.deviceIntegrity?.deviceRecognitionVerdict ?? [];
  if (request.requestPackageName !== config.PLAY_INTEGRITY_PACKAGE_NAME) reasons.push("package_mismatch");
  if (request.nonce !== expectedNonce) reasons.push("nonce_mismatch");
  const timestamp = Number(request.timestampMillis);
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > MAX_TOKEN_AGE_MS) reasons.push("stale_token");
  if (app.appRecognitionVerdict !== "PLAY_RECOGNIZED") reasons.push("app_not_play_recognized");
  if (app.packageName !== config.PLAY_INTEGRITY_PACKAGE_NAME) reasons.push("app_package_mismatch");
  const allowed = allowedCertificates();
  if (!(app.certificateSha256Digest ?? []).some((digest) => allowed.has(digest))) reasons.push("signing_certificate_mismatch");
  if (!device.includes("MEETS_DEVICE_INTEGRITY")) reasons.push("device_integrity_failed");
  return reasons;
}

export async function attest(challenge: string, integrityToken: string, decode: IntegrityDecoder): Promise<{ attestation: string } | { rejected: string[] }> {
  const nonce = await challengeNonce(challenge);
  if (!nonce) return { rejected: ["invalid_challenge"] };
  let payload: IntegrityPayload;
  try {
    payload = await decode(integrityToken);
  } catch {
    return { rejected: ["token_not_decodable"] };
  }
  const reasons = integrityRejections(payload, nonce);
  if (reasons.length) return { rejected: reasons };
  const attestation = await new SignJWT({ purpose: "app-attestation", platform: "android" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ATTESTATION_TTL_SECONDS}s`)
    .sign(signingKey());
  return { attestation };
}

export async function isValidAttestation(attestation: string | undefined): Promise<boolean> {
  if (!attestation) return false;
  try {
    const { payload } = await jwtVerify(attestation, signingKey(), { algorithms: ["HS256"] });
    return payload.purpose === "app-attestation";
  } catch {
    return false;
  }
}

/** Decodes tokens with Google's Play Integrity API using the configured service account. */
export function googleIntegrityDecoder(): IntegrityDecoder {
  let auth: GoogleAuth | undefined;
  return async (integrityToken) => {
    if (!config.PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON_BASE64) throw new Error("Play Integrity is not configured");
    auth ??= new GoogleAuth({
      credentials: JSON.parse(Buffer.from(config.PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON_BASE64, "base64").toString("utf8")),
      scopes: ["https://www.googleapis.com/auth/playintegrity"],
    });
    const client = await auth.getClient();
    const response = await client.request<{ tokenPayloadExternal: IntegrityPayload }>({
      url: `https://playintegrity.googleapis.com/v1/${encodeURIComponent(config.PLAY_INTEGRITY_PACKAGE_NAME)}:decodeIntegrityToken`,
      method: "POST",
      data: { integrity_token: integrityToken },
      timeout: 10_000,
    });
    return response.data.tokenPayloadExternal;
  };
}
