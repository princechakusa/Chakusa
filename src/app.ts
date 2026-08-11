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

export async function buildApp() {
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
  await app.register(rateLimit, { max: 200, timeWindow: "1 minute" });
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin);
  await app.register(tenantPlugin);

  app.get("/health", async () => ({ status: "ok" }));

  await app.register(authRoutes, { prefix: "/auth" });
  await app.register(businessRoutes, { prefix: "/business" });
  await app.register(customerRoutes, { prefix: "/customers" });
  await app.register(leadRoutes, { prefix: "/leads" });
  await app.register(templateRoutes, { prefix: "/message-templates" });
  await app.register(reviewRequestRoutes, { prefix: "/review-requests" });
  await app.register(feedbackRoutes, { prefix: "/feedback" });
  await app.register(reminderRoutes, { prefix: "/reminders" });
  await app.register(dashboardRoutes, { prefix: "/dashboard" });

  return app;
}
