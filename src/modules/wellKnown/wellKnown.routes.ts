import type { FastifyInstance } from "fastify";
import { config } from "../../lib/config.js";

// #21 Booking Distribution — Universal Links (iOS) / App Links (Android)
// readiness. These well-known documents let a tapped booking / review link
// open the native app instead of the browser. Everything is config-driven:
// when the relevant env is unset the route 404s and links stay plain web
// URLs — no behaviour changes until the owner supplies the app identifiers
// (see docs/OWNER_ACTIONS.md).
//
// Registered at the API root with NO prefix and no auth. The paths are fixed
// by the OS spec and must be served from the same origin as the links.

const APPLINK_PATHS = ["/book/*", "/r/*"] as const;

export default async function wellKnownRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/.well-known/apple-app-site-association",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (_request, reply) => {
      const appId = config.IOS_UNIVERSAL_LINK_APP_ID;
      if (!appId) return reply.code(404).send({ message: "Not configured" });
      // Apple requires application/json (no .json extension on the path).
      reply.type("application/json").send({
        applinks: {
          apps: [],
          details: [{ appID: appId, paths: [...APPLINK_PATHS] }],
        },
      });
    },
  );

  fastify.get(
    "/.well-known/assetlinks.json",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (_request, reply) => {
      const packageName = config.GOOGLE_PLAY_PACKAGE_NAME;
      const fingerprints = (config.ANDROID_APP_LINK_SHA256 ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      if (!packageName || fingerprints.length === 0) return reply.code(404).send({ message: "Not configured" });
      reply.type("application/json").send([
        {
          relation: ["delegate_permission/common.handle_all_urls"],
          target: { namespace: "android_app", package_name: packageName, sha256_cert_fingerprints: fingerprints },
        },
      ]);
    },
  );
}
