import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, registerAccount, resetDatabase } from "./helpers.js";
import { isValidTimeZone } from "../src/modules/business/business.schemas.js";

describe("business time zone validation", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterEach(async () => { await resetDatabase(); });
  afterAll(async () => { await app.close(); });

  it("accepts today's official IANA names that Intl.supportedValuesOf omits", () => {
    for (const zone of ["Africa/Harare", "Asia/Kolkata", "Europe/Kyiv", "Asia/Ho_Chi_Minh", "Asia/Kathmandu", "UTC"]) expect(isValidTimeZone(zone)).toBe(true);
    for (const zone of ["Mars/Olympus", "../etc", "", "Africa Harare"]) expect(isValidTimeZone(zone)).toBe(false);
  });

  it("saves a business time zone picked from the app's dropdown", async () => {
    const owner = await registerAccount(app);
    const headers = { authorization: `Bearer ${owner.accessToken}` };
    const ok = await app.inject({ method: "PATCH", url: "/business", headers, payload: { timezone: "Asia/Kolkata", currency: "ZWG" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().timezone ?? ok.json().business?.timezone).toBe("Asia/Kolkata");
    const bad = await app.inject({ method: "PATCH", url: "/business", headers, payload: { timezone: "Mars/Olympus" } });
    expect(bad.statusCode).toBe(400);
  });
});
