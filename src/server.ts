import { buildApp } from "./app.js";
import { config } from "./lib/config.js";
import { prisma } from "./lib/prisma.js";
import { initSentry, captureUnexpectedError, flushSentry } from "./lib/sentry.js";
import { ensureDefaultLegalDocuments } from "./modules/legal/defaultLegalDocuments.js";
import { ensureBootstrapAIModel, ensureCustomerAgentPlatformFlag } from "./lib/ai/bootstrapModel.js";
import { ensurePlatformPrompts } from "./lib/ai/platformPrompts.js";
import { startAutomationWorker, type AutomationWorkerHandle } from "./worker/automationWorker.js";
import { applyComplimentaryPlans } from "./lib/billing/complimentaryPlans.js";
import { serializeErrorForLog } from "./lib/requestLogging.js";

// Initialized before anything else so a failure during buildApp() itself
// (e.g. assertValidAppleRootCertificates throwing at boot) is still
// reportable — see the catch block below.
initSentry();

// Node considers process state undefined after an uncaughtException — the
// only safe response is to report it, log it, and exit so the platform
// (Render) restarts a clean process. An unhandledRejection is treated as
// non-fatal here (captured and logged, not a crash): a single stray
// unmonitored promise rejection elsewhere in a dependency is common enough
// that crashing the whole API on every one of them would be a worse
// production outcome than the rejection itself — but it's still always
// worth knowing about, hence still captured.
process.on("uncaughtException", (error) => {
  captureUnexpectedError(error);
  console.error("[uncaughtException]", serializeErrorForLog(error));
  void flushSentry().finally(() => process.exit(1));
});
process.on("unhandledRejection", (reason) => {
  captureUnexpectedError(reason);
  console.error("[unhandledRejection]", serializeErrorForLog(reason));
});

async function main() {
  let app;
  try {
    app = await buildApp();
  } catch (err) {
    captureUnexpectedError(err);
    console.error("[startup] initialization failed", serializeErrorForLog(err));
    await flushSentry();
    process.exit(1);
  }

  try {
    await app.listen({ port: config.PORT, host: config.API_BIND_HOST });
  } catch (err) {
    app.log.error({ err }, "API listener failed");
    captureUnexpectedError(err);
    await flushSentry();
    process.exit(1);
  }

  // Publish v1 of any Legal Platform document that has no version yet, so the
  // apps never show "not published". Never edits an existing version, and a
  // failure here is logged rather than taking the API down.
  try {
    const published = await ensureDefaultLegalDocuments(prisma);
    if (published.length) app.log.info({ published }, "published default legal documents");
  } catch (err) {
    app.log.error(err, "could not ensure default legal documents");
    captureUnexpectedError(err);
  }

  // Env-only AI setup: register OPENAI_DEFAULT_MODEL when no model is active yet.
  try {
    const model = await ensureBootstrapAIModel();
    if (model) app.log.info(model, "registered bootstrap AI model");
  } catch (err) {
    app.log.error(err, "could not register bootstrap AI model");
    captureUnexpectedError(err);
  }

  // AI receptionist prerequisites: the published platform prompts routeAI
  // requires, and the env-driven platform switch (AI_CUSTOMER_AGENT_ENABLED).
  try {
    const prompts = await ensurePlatformPrompts(prisma);
    if (prompts.length) app.log.info({ prompts }, "published platform AI prompts");
    if (await ensureCustomerAgentPlatformFlag()) app.log.info("enabled platform AI customer agent flag");
  } catch (err) {
    app.log.error(err, "could not ensure AI receptionist prerequisites");
    captureUnexpectedError(err);
  }

  // Owner-granted complimentary plans (COMPLIMENTARY_PLAN_GRANTS).
  try {
    const applied = await applyComplimentaryPlans(config.COMPLIMENTARY_PLAN_GRANTS);
    if (applied.length) app.log.info({ applied }, "applied complimentary plans");
  } catch (err) {
    app.log.error(err, "could not apply complimentary plans");
    captureUnexpectedError(err);
  }

  // Single-instance deployments with no separate worker service run the
  // automation worker loop in this process (RUN_WORKER_IN_API). Without a
  // worker nothing scheduled ever sends: missed-call follow-ups, reminders,
  // review requests, queued AI replies.
  let worker: AutomationWorkerHandle | null = null;
  if (config.RUN_WORKER_IN_API) {
    worker = startAutomationWorker({ onError: (error) => { app.log.error(error, "in-process automation worker cycle failed"); captureUnexpectedError(error); } });
    app.log.info("started in-process automation worker");
  }

  // Deployment platforms (Render, etc.) send SIGTERM before killing a
  // process on redeploy/scale-down — without this, in-flight requests are
  // cut off mid-response instead of being allowed to finish. app.close()
  // stops accepting new connections and waits for existing ones to drain
  // before resolving; the Prisma disconnect afterward is a clean-shutdown
  // nicety (the pool would otherwise just be killed with the process),
  // not something in-flight requests depend on.
  const shutdown = (signal: string) => {
    app.log.info(`received ${signal}, shutting down`);
    Promise.resolve(worker?.stop())
      .then(() => app.close())
      .then(() => prisma.$disconnect())
      .then(() => process.exit(0))
      .catch((err) => {
        app.log.error({ err }, "API shutdown failed");
        process.exit(1);
      });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main();
