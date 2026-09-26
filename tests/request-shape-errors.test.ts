import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import { createTestApp, registerAccount, resetDatabase } from "./helpers.js";

// A malformed request is the client's fault: 4xx, never a disguised 500.
describe("request-shape errors", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterAll(async () => { await resetDatabase(); await app.close(); await prisma.$disconnect(); });

  it("treats an empty body sent with a JSON content-type as no body (bodyless DELETE works)", async () => {
    const owner = await registerAccount(app, { businessName: "Shape Co" });
    const headers = { authorization: `Bearer ${owner.accessToken}` };
    const empty = await app.inject({ method: "DELETE", url: "/appointments/00000000-0000-0000-0000-000000000000/location-share", headers: { ...headers, "content-type": "application/json" } });
    // Previously a 500. The appointment does not exist, so a clean 4xx (not found) or success - never a server fault.
    expect(empty.statusCode).toBeLessThan(500);
    const bodyless = await app.inject({ method: "DELETE", url: "/appointments/00000000-0000-0000-0000-000000000000/location-share", headers });
    expect(bodyless.statusCode).toBeLessThan(500);
  });

  it("answers malformed JSON with 400", async () => {
    const res = await app.inject({ method: "POST", url: "/auth/login", headers: { "content-type": "application/json" }, payload: "{not json" });
    expect(res.statusCode).toBe(400);
  });
});
