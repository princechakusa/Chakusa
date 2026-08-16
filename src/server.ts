import { buildApp } from "./app.js";
import { config } from "./lib/config.js";
import { prisma } from "./lib/prisma.js";
import { initSentry, captureUnexpectedError, flushSentry } from "./lib/sentry.js";

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
  console.error("[uncaughtException]", error);
  void flushSentry().finally(() => process.exit(1));
});
process.on("unhandledRejection", (reason) => {
  captureUnexpectedError(reason);
  console.error("[unhandledRejection]", reason);
});

async function main() {
  let app;
  try {
    app = await buildApp();
  } catch (err) {
    captureUnexpectedError(err);
    console.error(err);
    await flushSentry();
    process.exit(1);
  }

  try {
    await app.listen({ port: config.PORT, host: "0.0.0.0" });
  } catch (err) {
    app.log.error(err);
    captureUnexpectedError(err);
    await flushSentry();
    process.exit(1);
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
    app
      .close()
      .then(() => prisma.$disconnect())
      .then(() => process.exit(0))
      .catch((err) => {
        app.log.error(err);
        process.exit(1);
      });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main();
