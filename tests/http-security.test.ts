import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp } from "./helpers.js";

describe("HTTP security boundaries", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp({ enableRateLimit: true }); });
  afterAll(async () => { await app.close(); });

  it.each(["/health", "/auth/me", "/missing-security-probe"])("protects response headers on %s", async (url) => {
    const response = await app.inject({ method: "GET", url });
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(response.headers["cache-control"]).toContain("no-store");
  });

  it.each([
    '{"email":"probe@example.test","password":"invalid-password","__proto__":{"admin":true}}',
    '{"email":"probe@example.test","password":"invalid-password","constructor":{"prototype":{"admin":true}}}',
  ])("rejects prototype poisoning before handling JSON", async (payload) => {
    const response = await app.inject({ method: "POST", url: "/auth/login", headers: { "content-type": "application/json" }, payload });
    expect(response.statusCode).toBe(400);
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
  });

  it("rate limits invalid authentication attempts even with spoofed forwarded IPs", async () => {
    const statuses: number[] = [];
    for (let index = 0; index < 11; index++) {
      const response = await app.inject({ method: "POST", url: "/auth/login", remoteAddress: "192.0.2.12", headers: { "x-forwarded-for": `198.51.100.${index + 1}` }, payload: {} });
      statuses.push(response.statusCode);
    }
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(400));
    expect(statuses[10]).toBe(429);
  });
});
