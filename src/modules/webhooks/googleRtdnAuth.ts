import { OAuth2Client } from "google-auth-library";
import { config } from "../../lib/config.js";
import { ApiError } from "../../lib/errors.js";

const client = new OAuth2Client();

/**
 * Cloud Pub/Sub push subscriptions can be configured to authenticate every
 * push request with a Google-issued OIDC token (Authorization: Bearer
 * <token>), signed the same way a Google Sign-In identity token is — see
 * googleVerifier.ts, which this mirrors for a different token source. This
 * is what actually proves a request hit this webhook because Google's
 * Pub/Sub infrastructure sent it (using the specific service account this
 * deployment configured the push subscription with), not because someone
 * guessed the URL. There is deliberately no JWT/session auth on this route
 * (see webhooks.routes.ts) — this is the entire authentication story for
 * both this endpoint and the Apple webhook (which authenticates via its
 * own signed-payload verification instead).
 */
export async function verifyGoogleRtdnAuthorization(authorizationHeader: string | undefined): Promise<void> {
  const audience = config.GOOGLE_RTDN_AUDIENCE;
  const expectedEmail = config.GOOGLE_RTDN_SERVICE_ACCOUNT_EMAIL;
  if (!audience || !expectedEmail) {
    throw ApiError.auth(503, "GOOGLE_AUTH_NOT_CONFIGURED", "Google billing notifications are not configured on this server");
  }

  const token = authorizationHeader?.startsWith("Bearer ") ? authorizationHeader.slice("Bearer ".length) : undefined;
  if (!token) throw ApiError.unauthorized();

  try {
    const ticket = await client.verifyIdToken({ idToken: token, audience });
    const payload = ticket.getPayload();
    if (!payload || payload.email !== expectedEmail || payload.email_verified !== true) {
      throw ApiError.unauthorized();
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw ApiError.unauthorized();
  }
}
