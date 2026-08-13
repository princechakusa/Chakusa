import Fastify from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import rateLimit from "@fastify/rate-limit";
import { config } from "./lib/config.js";
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
import type { GoogleTokenVerifier } from "./modules/auth/googleVerifier.js";
import type { AppleCodeExchanger, AppleCredentialRevoker, AppleTokenVerifier } from "./modules/auth/appleAuth.js";

export interface BuildAppOptions {
  googleTokenVerifier?: GoogleTokenVerifier;
  appleTokenVerifier?: AppleTokenVerifier;
  appleCodeExchanger?: AppleCodeExchanger;
  appleCredentialRevoker?: AppleCredentialRevoker;
  /**
   * Rate limiting is skipped by default in NODE_ENV=test so ordinary test
   * suites (which reuse one app instance across many requests in a single
   * describe block) don't trip auth rate limits incidentally. Tests that
   * specifically want to prove a rate limit is enforced pass this as true.
   */
  enableRateLimit?: boolean;
}

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger:
      config.NODE_ENV === "development"
        ? { transport: { target: "pino-pretty" } }
        : config.NODE_ENV === "test"
          ? false
          : true,
  });

  await app.register(sensible);
  await app.register(cors, { origin: true });
  const rateLimitEnabled = config.NODE_ENV !== "test" || options.enableRateLimit === true;
  if (rateLimitEnabled) {
    await app.register(rateLimit, { max: 200, timeWindow: "1 minute" });
  }
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin);
  await app.register(tenantPlugin);

  app.get("/health", async () => ({ status: "ok" }));

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

  return app;
}
