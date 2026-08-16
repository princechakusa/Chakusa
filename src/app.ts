import Fastify from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import rateLimit from "@fastify/rate-limit";
import { config, corsAllowedOrigins } from "./lib/config.js";
import { prisma } from "./lib/prisma.js";
import { attachFastifySentry } from "./lib/sentry.js";
import authPlugin from "./plugins/auth.js";
import tenantPlugin from "./plugins/tenant.js";
import errorHandlerPlugin from "./plugins/errorHandler.js";
import authRoutes from "./modules/auth/auth.routes.js";
import businessRoutes from "./modules/business/business.routes.js";
import customerRoutes from "./modules/customers/customers.routes.js";
import leadRoutes from "./modules/leads/leads.routes.js";
import templateRoutes from "./modules/templates/templates.routes.js";
import reviewRequestRoutes from "./modules/reviews/reviews.routes.js";
import feedbackRoutes from "./modules/feedback/feedback.routes.js";
import reminderRoutes from "./modules/reminders/reminders.routes.js";
import dashboardRoutes from "./modules/dashboard/dashboard.routes.js";
import deviceRoutes from "./modules/devices/devices.routes.js";
import messageRoutes from "./modules/messages/messages.routes.js";
import automationRoutes from "./modules/automation/automation.routes.js";
import subscriptionRoutes from "./modules/subscription/subscription.routes.js";
import publicReviewRoutes from "./modules/public/public.routes.js";
import webhookRoutes from "./modules/webhooks/webhooks.routes.js";
import teamRoutes from "./modules/team/team.routes.js";
import type { TeamInvitationEmailSender } from "./modules/team/teamInvitationEmail.js";
import publicTeamInviteRoutes from "./modules/team/publicTeamInvites.routes.js";
import type { GoogleTokenVerifier } from "./modules/auth/googleVerifier.js";
import type { AppleCodeExchanger, AppleCredentialRevoker, AppleTokenVerifier } from "./modules/auth/appleAuth.js";
import type { AppleStoreClient } from "./lib/billing/appleAppStoreClient.js";
import type { GooglePlayClient } from "./lib/billing/googlePlayClient.js";
import { assertValidAppleRootCertificates } from "./lib/billing/jws.js";

export interface BuildAppOptions {
  googleTokenVerifier?: GoogleTokenVerifier;
  appleTokenVerifier?: AppleTokenVerifier;
  appleCodeExchanger?: AppleCodeExchanger;
  appleCredentialRevoker?: AppleCredentialRevoker;
  /** Test-only injection — see subscription.routes.ts's SubscriptionRoutesOptions. */
  appleStoreClient?: AppleStoreClient;
  googlePlayClient?: GooglePlayClient;
  /** Test-only injection — see team.routes.ts's TeamRoutesOptions. */
  teamInvitationEmailSender?: TeamInvitationEmailSender;
  /**
   * Rate limiting is skipped by default in NODE_ENV=test so ordinary test
   * suites (which reuse one app instance across many requests in a single
   * describe block) don't trip auth rate limits incidentally. Tests that
   * specifically want to prove a rate limit is enforced pass this as true.
   */
  enableRateLimit?: boolean;
}

export async function buildApp(options: BuildAppOptions = {}) {
  // Fail the deployment at boot, not at the first real purchase/webhook, if
  // Apple billing trust configuration is broken — see jws.ts's
  // assertValidAppleRootCertificates doc comment.
  if (config.APPLE_BILLING_ENABLED) {
    assertValidAppleRootCertificates();
  }

  const app = Fastify({
    logger:
      config.NODE_ENV === "development"
        ? { transport: { target: "pino-pretty" } }
        : config.NODE_ENV === "test"
          ? false
          : true,
    // See config.ts's TRUST_PROXY doc — off by default, must be explicitly
    // enabled once the deployment target's reverse proxy is confirmed to
    // set X-Forwarded-For correctly. Without this, IP-based rate limiting
    // behind Render/Railway/etc. sees only the proxy's IP for every
    // request.
    trustProxy: config.TRUST_PROXY,
    // Public review tokens (id.secret, ~101 chars) travel as a route param
    // in /public/reviews/:token — above find-my-way's default 100-char
    // maxParamLength, which otherwise 414s every request. Other opaque
    // tokens in this codebase go in the Authorization header and never hit
    // this limit.
    routerOptions: { maxParamLength: 200 },
  });

  await app.register(sensible);
  // corsAllowedOrigins is null (permissive `origin: true`) until
  // CORS_ALLOWED_ORIGINS is set — see config.ts for why that default is
  // safe for a mobile-only, bearer-token client with no browser-enforced
  // Origin header. Once a real web frontend domain exists, set
  // CORS_ALLOWED_ORIGINS and this becomes a real allowlist.
  await app.register(cors, { origin: corsAllowedOrigins ?? true });
  const rateLimitEnabled = config.NODE_ENV !== "test" || options.enableRateLimit === true;
  if (rateLimitEnabled) {
    await app.register(rateLimit, { max: 200, timeWindow: "1 minute" });
  }
  await app.register(errorHandlerPlugin);
  // Reports genuinely unexpected 5xx failures to Sentry — a plain onError
  // hook that runs alongside errorHandlerPlugin above, never altering its
  // response. No-ops entirely when Sentry isn't enabled — see
  // src/lib/sentry.ts's doc comments for why.
  attachFastifySentry(app);
  await app.register(authPlugin);
  await app.register(tenantPlugin);

  // Cheap, DB-free liveness — "the process is up and answering HTTP," not
  // "the app is fully functional." Deployment platforms (Render, etc.)
  // should probe this frequently; it must never do real work.
  app.get("/health", async () => ({ status: "ok" }));

  // Readiness — the same liveness guarantee PLUS "the database is
  // currently reachable," via the cheapest possible round-trip
  // (`SELECT 1`, no table access, no business data). Used for
  // deploy-time verification and (optionally) a platform's readiness
  // probe, kept separate from /health above so a slow/unreachable DB
  // doesn't make the process look dead to a liveness check that would
  // otherwise trigger an unnecessary restart.
  app.get("/health/ready", async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: "ok" };
    } catch {
      reply.code(503);
      return { status: "unavailable" };
    }
  });

  // Production Infrastructure Phase 4.2 — TEMPORARY, one-time-use route to
  // confirm a real unexpected error is captured by Sentry in the live
  // Render deployment. Unregistered entirely unless
  // DEBUG_SENTRY_ROUTE_ENABLED=true (defaults false, never set in
  // .env.example). No database access, no business data, no secret of any
  // kind — just a deliberate throw. MUST be removed (this block and the
  // config flag both) immediately after verification; see the Phase 4.2
  // report for the removal commit.
  if (config.DEBUG_SENTRY_ROUTE_ENABLED) {
    app.get("/internal/debug-sentry", async () => {
      throw new Error("Chakusa Sentry verification: controlled test error — safe to ignore");
    });
  }

  await app.register(authRoutes, {
    prefix: "/auth",
    googleTokenVerifier: options.googleTokenVerifier,
    appleTokenVerifier: options.appleTokenVerifier,
    appleCodeExchanger: options.appleCodeExchanger,
    appleCredentialRevoker: options.appleCredentialRevoker,
  });
  await app.register(businessRoutes, { prefix: "/business" });
  await app.register(customerRoutes, { prefix: "/customers" });
  await app.register(leadRoutes, { prefix: "/leads" });
  await app.register(templateRoutes, { prefix: "/message-templates" });
  await app.register(reviewRequestRoutes, { prefix: "/review-requests" });
  await app.register(feedbackRoutes, { prefix: "/feedback" });
  await app.register(reminderRoutes, { prefix: "/reminders" });
  await app.register(dashboardRoutes, { prefix: "/dashboard" });
  await app.register(deviceRoutes, { prefix: "/devices" });
  await app.register(messageRoutes, { prefix: "/messages" });
  await app.register(automationRoutes, { prefix: "/automation" });
  await app.register(subscriptionRoutes, {
    prefix: "/subscription",
    appleStoreClient: options.appleStoreClient,
    googlePlayClient: options.googlePlayClient,
  });
  await app.register(teamRoutes, { prefix: "/team", emailSender: options.teamInvitationEmailSender });
  // No fastify.authenticate/requireBusiness hooks here — see
  // public.routes.ts's top-level doc comment.
  await app.register(publicReviewRoutes, { prefix: "/public/reviews" });
  // GET is unauthenticated; POST /:token/accept applies fastify.authenticate
  // per-route — see publicTeamInviteRoutes's top-level doc comment.
  await app.register(publicTeamInviteRoutes, { prefix: "/public/team-invites" });
  // Provider-to-server callbacks — see webhooks.routes.ts's top-level doc
  // comment for why these also have no fastify.authenticate hook and
  // authenticate themselves per-provider instead.
  await app.register(webhookRoutes, {
    prefix: "/webhooks",
    appleStoreClient: options.appleStoreClient,
    googlePlayClient: options.googlePlayClient,
  });

  return app;
}
