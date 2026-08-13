/**
 * Automation worker process entrypoint — separate from src/server.ts on
 * purpose. Run it explicitly:
 *
 *   npm run worker
 *
 * The HTTP API (src/server.ts) never starts this; a business's manual
 * Free/Pro workflow (leads, customers, review requests, manual SMS send,
 * etc.) works identically whether or not this process is running anywhere.
 * Only scheduled AutomationRun rows sit PENDING, unexecuted, until this
 * process (or another instance of it) is running to claim and act on them.
 */
import { startAutomationWorker } from "./worker/automationWorker.js";

console.log("[automation-worker] starting");

const handle = startAutomationWorker({
  onError: (error) => console.error("[automation-worker] poll cycle failed", error),
});

function shutdown(signal: string) {
  console.log(`[automation-worker] received ${signal}, stopping`);
  handle.stop();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
