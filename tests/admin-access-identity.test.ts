import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/lib/config.js";
import * as access from "../src/lib/cloudflareAccess.js";
import { prisma } from "../src/lib/prisma.js";
import { createTestApp, registerAccount, resetDatabase } from "./helpers.js";

describe("Cloudflare identity binding at every admin authentication boundary", () => {
  let app: FastifyInstance;
  const email = "identity-admin@example.com";
  const headers = { origin: "http://localhost:5173", "cf-access-jwt-assertion": "synthetic-assertion" };
  const verifier = vi.spyOn(access, "verifyCloudflareAccessToken");
  const previous = { enabled: config.ADMIN_CONSOLE_ENABLED, origin: config.ADMIN_CONSOLE_ORIGIN, access: config.CF_ACCESS_ENABLED };

  beforeAll(async () => {
    config.ADMIN_CONSOLE_ENABLED = true;
    config.ADMIN_CONSOLE_ORIGIN = headers.origin;
    config.CF_ACCESS_ENABLED = false;
    app = await createTestApp();
  });
  beforeEach(async () => {
    config.CF_ACCESS_ENABLED = false;
    verifier.mockReset();
    await resetDatabase();
    const user = await registerAccount(app, { email, password: "admin-password-123" });
    await prisma.adminMembership.create({ data: { userId: user.userId, role: "SUPER_ADMIN" } });
  });
  afterAll(async () => {
    config.ADMIN_CONSOLE_ENABLED = previous.enabled;
    config.ADMIN_CONSOLE_ORIGIN = previous.origin;
    config.CF_ACCESS_ENABLED = previous.access;
    verifier.mockRestore();
    await app.close();
  });
  const login = () => app.inject({ method: "POST", url: "/admin/auth/login", headers, payload: { email, password: "admin-password-123" } });

  it("does not create a session when the Access assertion is invalid", async () => {
    config.CF_ACCESS_ENABLED = true;
    verifier.mockRejectedValue(new Error("invalid assertion"));
    expect((await login()).statusCode).toBe(401);
    expect(await prisma.authSession.count({ where: { scope: "ADMIN" } })).toBe(0);
    expect(verifier).toHaveBeenCalledWith("synthetic-assertion");
  });
  it("does not combine another Access identity with the admin password", async () => {
    config.CF_ACCESS_ENABLED = true;
    verifier.mockResolvedValue({ email: "other-admin@example.com" });
    expect((await login()).statusCode).toBe(401);
    expect(await prisma.authSession.count({ where: { scope: "ADMIN" } })).toBe(0);
  });
  it("accepts the matching verified identity with case normalization", async () => {
    config.CF_ACCESS_ENABLED = true;
    verifier.mockResolvedValue({ email: email.toUpperCase() });
    const signedIn = await login();
    expect(signedIn.statusCode).toBe(200);
    const response = await app.inject({ method: "GET", url: "/admin/auth/me", headers: { ...headers, authorization: `Bearer ${signedIn.json().accessToken}` } });
    expect(response.statusCode).toBe(200);
    expect(verifier).toHaveBeenCalledTimes(2);
  });
  it("rejects mixed identities for an existing access session", async () => {
    const signedIn = await login();
    config.CF_ACCESS_ENABLED = true;
    verifier.mockResolvedValue({ email: "other-admin@example.com" });
    expect((await app.inject({ method: "GET", url: "/admin/auth/me", headers: { ...headers, authorization: `Bearer ${signedIn.json().accessToken}` } })).statusCode).toBe(401);
  });
  it("rotates and authorizes the matching verified identity", async () => {
    config.CF_ACCESS_ENABLED = true;
    verifier.mockResolvedValue({ email: email.toUpperCase() });
    const signedIn = await login();
    const cookieHeader = signedIn.headers["set-cookie"];
    const cookie = (Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader)!.split(";")[0];
    const refreshed = await app.inject({ method: "POST", url: "/admin/auth/refresh", headers: { ...headers, cookie, "x-csrf-token": signedIn.json().csrfToken } });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.headers["set-cookie"]).not.toBe(signedIn.headers["set-cookie"]);
    expect(await prisma.authSession.count({ where: { scope: "ADMIN" } })).toBe(2);
    expect((await app.inject({ method: "GET", url: "/admin/auth/me", headers: { ...headers, authorization: `Bearer ${refreshed.json().accessToken}` } })).statusCode).toBe(200);
    expect(verifier).toHaveBeenCalledTimes(3);
  });
  it.each(["invalid", "different"])("does not rotate refresh credentials with %s Access evidence", async (mode) => {
    const signedIn = await login();
    const cookieHeader = signedIn.headers["set-cookie"];
    const cookie = (Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader)!.split(";")[0];
    config.CF_ACCESS_ENABLED = true;
    if (mode === "invalid") verifier.mockRejectedValue(new Error("invalid assertion"));
    else verifier.mockResolvedValue({ email: "other-admin@example.com" });
    const response = await app.inject({ method: "POST", url: "/admin/auth/refresh", headers: { ...headers, cookie, "x-csrf-token": signedIn.json().csrfToken } });
    expect(response.statusCode).toBe(401);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(await prisma.authSession.count({ where: { scope: "ADMIN" } })).toBe(1);
  });
});
