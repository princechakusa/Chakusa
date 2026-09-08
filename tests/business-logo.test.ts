import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import { authHeader, createTestApp, registerAccount, resetDatabase } from "./helpers.js";

// A 1x1 PNG data URI.
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("business logo", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterEach(resetDatabase);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it("stores and returns a small image data URI, and clears it with null", async () => {
    const account = await registerAccount(app);

    const set = await app.inject({
      method: "PATCH",
      url: "/business",
      headers: authHeader(account.token),
      payload: { logoDataUrl: PNG },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json().logoDataUrl).toBe(PNG);

    const fetched = await app.inject({ method: "GET", url: "/business", headers: authHeader(account.token) });
    expect(fetched.json().logoDataUrl).toBe(PNG);

    const cleared = await app.inject({
      method: "PATCH",
      url: "/business",
      headers: authHeader(account.token),
      payload: { logoDataUrl: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().logoDataUrl).toBeNull();
  });

  it("rejects a non-image data URI", async () => {
    const account = await registerAccount(app);
    const res = await app.inject({
      method: "PATCH",
      url: "/business",
      headers: authHeader(account.token),
      payload: { logoDataUrl: "data:text/plain;base64,aGVsbG8=" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an oversized image", async () => {
    const account = await registerAccount(app);
    const huge = `data:image/png;base64,${"A".repeat(400_001)}`;
    const res = await app.inject({
      method: "PATCH",
      url: "/business",
      headers: authHeader(account.token),
      payload: { logoDataUrl: huge },
    });
    expect(res.statusCode).toBe(400);
  });
});
