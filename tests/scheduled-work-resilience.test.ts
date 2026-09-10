import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import { createTestApp, resetDatabase } from "./helpers.js";

// #23 — if the kill-switch / maintenance state cannot be read, the cycle must
// fail safe (do no automation work) yet still record a heartbeat, so a
// transient DB blip does not read as a dead worker and trigger a restart loop.
vi.mock("../src/modules/automation/automationFoundation.js", () => ({
  getAutomationFoundationStatus: vi.fn().mockRejectedValue(new Error("injected foundation-status DB failure")),
}));
const { runTriggeredScheduledWork } = await import("../src/worker/scheduledWorkTrigger.js");

describe("scheduled-work fails safe when the flag store is unreachable (#23)", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterEach(resetDatabase);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it("skips the work cycle but still heartbeats", async () => {
    const before = await prisma.workerHeartbeat.findUnique({ where: { id: "automation-worker" } });
    const result = await runTriggeredScheduledWork();

    expect(result.skipped).toBe(true);
    expect(result.failedSteps).toBeGreaterThanOrEqual(1);
    // no work was attempted
    expect(result.outboxPublished).toBe(0);
    expect(result.customerMessagesSent).toBe(0);

    const after = await prisma.workerHeartbeat.findUniqueOrThrow({ where: { id: "automation-worker" } });
    expect(after.lastSuccessAt).not.toBeNull();
    if (before) expect(after.lastSuccessAt.getTime()).toBeGreaterThanOrEqual(before.lastSuccessAt.getTime());
  });
});
