import { buildApp } from "./app.js";
import { config } from "./lib/config.js";
import { prisma } from "./lib/prisma.js";

async function main() {
  const app = await buildApp();

  try {
    await app.listen({ port: config.PORT, host: "0.0.0.0" });
  } catch (err) {
    app.log.error(err);
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
