import type { FastifyInstance } from "fastify";
import type { Response } from "light-my-request";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { config } from "../src/lib/config.js";
import { prisma } from "../src/lib/prisma.js";
import { recordAdminAudit } from "../src/modules/admin/adminAudit.service.js";
import { createTestApp, registerAccount, resetDatabase } from "./helpers.js";

describe("admin security foundation", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    config.ADMIN_CONSOLE_ENABLED = true;
    config.ADMIN_CONSOLE_ORIGIN = "http://localhost:5173";
    app = await createTestApp();
  });

  beforeEach(resetDatabase);

  afterAll(async () => {
    config.ADMIN_CONSOLE_ENABLED = false;
    config.ADMIN_CONSOLE_ORIGIN = undefined;
    await app.close();
  });

  async function adminAccount(role: "SUPER_ADMIN" | "READ_ONLY" = "SUPER_ADMIN") {
    const email = `admin-${Date.now()}-${Math.random()}@example.com`;
    const account = await registerAccount(app, { email, password: "admin-password-123" });
    const membership = await prisma.adminMembership.create({ data: { userId: account.userId, role } });
    return { ...account, email, membership };
  }

  async function login(email: string, password = "admin-password-123") {
    return app.inject({ method: "POST", url: "/admin/auth/login", payload: { email, password }, headers: { origin: "http://localhost:5173", "user-agent": "vitest-admin-browser" } });
  }

  function refreshCookie(response: Response) {
    const header = response.headers["set-cookie"];
    return (Array.isArray(header) ? header[0] : header)!.split(";")[0];
  }

  it("rejects ordinary product users at the admin login boundary", async () => {
    const account = await registerAccount(app, { email: "ordinary@example.com", password: "admin-password-123" });
    const response = await login("ordinary@example.com");
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("AUTH_INVALID_CREDENTIALS");

    const productTokenAttempt = await app.inject({ method: "GET", url: "/admin/auth/me", headers: { authorization: `Bearer ${account.accessToken}` } });
    expect(productTokenAttempt.statusCode).toBe(401);
  });

  it("creates an explicitly scoped admin session without exposing its refresh credential", async () => {
    const account = await adminAccount("READ_ONLY");
    const response = await login(account.email);
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.refreshToken).toBeUndefined();
    expect(body.csrfToken).toEqual(expect.any(String));
    expect(body.admin.role).toBe("READ_ONLY");
    expect(body.admin.permissions).toContain("business.read");
    expect(response.headers["set-cookie"]).toContain("HttpOnly");
    expect(response.headers["set-cookie"]).toContain("SameSite=Strict");

    const me = await app.inject({ method: "GET", url: "/admin/auth/me", headers: { authorization: `Bearer ${body.accessToken}` } });
    expect(me.statusCode).toBe(200);
    expect(me.headers["cache-control"]).toBe("no-store");

    const sessions = await app.inject({ method: "GET", url: "/admin/auth/sessions", headers: { authorization: `Bearer ${body.accessToken}` } });
    expect(Object.keys(sessions.json().items[0]).sort()).toEqual([
      "createdAt", "expiresAt", "id", "ipAddress", "lastUsedAt", "status", "userAgent",
    ].sort());

    const productEndpoint = await app.inject({ method: "GET", url: "/auth/me", headers: { authorization: `Bearer ${body.accessToken}` } });
    expect(productEndpoint.statusCode).toBe(401);
  });

  it("requires a session-bound CSRF token to rotate the HttpOnly refresh cookie", async () => {
    const account = await adminAccount();
    const signedIn = await login(account.email);
    const cookie = refreshCookie(signedIn);

    const denied = await app.inject({ method: "POST", url: "/admin/auth/refresh", headers: { cookie, "x-csrf-token": "x".repeat(40) } });
    expect(denied.statusCode).toBe(401);

    const refreshed = await app.inject({
      method: "POST",
      url: "/admin/auth/refresh",
      headers: { cookie, "x-csrf-token": signedIn.json().csrfToken },
    });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().accessToken).toEqual(expect.any(String));
    expect(refreshCookie(refreshed)).not.toBe(cookie);
  });

  it("records login and logout as immutable audit entries", async () => {
    const account = await adminAccount();
    const signedIn = await login(account.email);
    const logout = await app.inject({
      method: "POST",
      url: "/admin/auth/logout",
      headers: { origin: "http://localhost:5173", cookie: refreshCookie(signedIn), "x-csrf-token": signedIn.json().csrfToken },
    });
    expect(logout.statusCode).toBe(204);

    const actions = await prisma.adminAuditLog.findMany({ orderBy: { createdAt: "asc" }, select: { action: true, ipAddress: true, userAgent: true } });
    expect(actions.map((entry) => entry.action)).toEqual(["ADMIN_LOGIN", "ADMIN_LOGOUT"]);
    expect(actions[0]).toMatchObject({ userAgent: "vitest-admin-browser" });

    await expect(prisma.adminAuditLog.update({ where: { id: (await prisma.adminAuditLog.findFirstOrThrow()).id }, data: { action: "TAMPERED" } })).rejects.toThrow();
  });

  it("redacts secret-like fields before persisting audit values", async () => {
    const account = await adminAccount();
    await recordAdminAudit({
      actor: { membershipId: account.membership.id, userId: account.userId, email: "admin@example.com", role: account.membership.role },
      action: "TEST_REDACTION",
      targetType: "test",
      newValue: { password: "never-store-me", nested: { accessToken: "also-secret", safe: "visible" } },
    });
    const entry = await prisma.adminAuditLog.findFirstOrThrow({ where: { action: "TEST_REDACTION" } });
    expect(entry.newValue).toEqual({ password: "[REDACTED]", nested: { accessToken: "[REDACTED]", safe: "visible" } });
  });
});
