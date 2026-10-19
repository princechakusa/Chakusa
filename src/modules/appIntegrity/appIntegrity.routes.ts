import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "../../lib/config.js";
import { attest, googleIntegrityDecoder, isValidAttestation, issueChallenge, type IntegrityDecoder } from "./appIntegrity.service.js";

export interface AppIntegrityRoutesOptions {
  /** Test-only injection; production uses Google's decodeIntegrityToken. */
  integrityDecoder?: IntegrityDecoder;
}

export const ATTESTATION_HEADER = "x-chakusa-attestation";

// Sign-in and session-renewal endpoints for both experiences. Everything else
// already requires a session, so gating these covers the whole API.
const GATED_ROUTES = new Set(
  ["/auth", "/customer/auth"].flatMap((prefix) => ["login", "register", "refresh", "google", "apple"].map((path) => `${prefix}/${path}`)),
);

// The app sends x-chakusa-client: android; OkHttp/Dalvik user agents are
// treated as Android too, so dropping the header alone doesn't bypass the gate.
function isAndroidClient(request: FastifyRequest): boolean {
  if (request.headers["x-chakusa-client"] === "android") return true;
  return /\b(okhttp|dalvik)\b/i.test(request.headers["user-agent"] ?? "");
}

/** Install on the root app so it covers the separately registered auth plugins. */
export function registerAppIntegrityGate(app: FastifyInstance) {
  app.addHook("preHandler", async (request, reply) => {
    if (config.PLAY_INTEGRITY_MODE === "off" || request.method !== "POST") return;
    if (!GATED_ROUTES.has(request.routeOptions.url ?? "") || !isAndroidClient(request)) return;
    const header = request.headers[ATTESTATION_HEADER];
    if (await isValidAttestation(typeof header === "string" ? header : undefined)) return;
    request.log.warn({ event: "app_integrity_unverified", route: request.routeOptions.url, mode: config.PLAY_INTEGRITY_MODE }, "android request without a valid Play Integrity attestation");
    if (config.PLAY_INTEGRITY_MODE === "enforce") {
      return reply.code(403).send({ error: { code: "APP_NOT_GENUINE", message: "This copy of Chakusa can't be verified. Please install it from Google Play." } });
    }
  });
}

export default async function appIntegrityRoutes(fastify: FastifyInstance, options: AppIntegrityRoutesOptions) {
  const decode = options.integrityDecoder ?? googleIntegrityDecoder();
  const limits = { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } };

  fastify.post("/challenge", limits, async (_request, reply) => {
    if (config.PLAY_INTEGRITY_MODE === "off") return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Not found" } });
    reply.header("Cache-Control", "no-store");
    return issueChallenge();
  });

  fastify.post<{ Body: { challenge?: unknown; integrityToken?: unknown } }>("/attest", {
    ...limits,
    schema: {
      body: {
        type: "object",
        required: ["challenge", "integrityToken"],
        additionalProperties: false,
        properties: { challenge: { type: "string", minLength: 1, maxLength: 2048 }, integrityToken: { type: "string", minLength: 1, maxLength: 16384 } },
      },
    },
  }, async (request, reply) => {
    if (config.PLAY_INTEGRITY_MODE === "off") return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Not found" } });
    reply.header("Cache-Control", "no-store");
    const result = await attest(request.body.challenge as string, request.body.integrityToken as string, decode);
    if ("rejected" in result) {
      request.log.warn({ event: "app_integrity_rejected", reasons: result.rejected }, "Play Integrity verdict rejected");
      return reply.code(403).send({ error: { code: "APP_NOT_GENUINE", message: "This copy of Chakusa can't be verified. Please install it from Google Play." } });
    }
    return result;
  });
}
