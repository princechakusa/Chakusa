import type { AdminRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { config } from "../src/lib/config.js";
import { prisma } from "../src/lib/prisma.js";
import { normalizeAppConfigValue } from "../src/modules/appConfig/appConfig.service.js";
import { createTestApp, registerAccount, resetDatabase } from "./helpers.js";

describe("runtime app config", () => {
  let app: FastifyInstance;
  beforeAll(async () => { config.ADMIN_CONSOLE_ENABLED = true; config.ADMIN_CONSOLE_ORIGIN = "http://localhost:5173"; app = await createTestApp(); });
  beforeEach(resetDatabase);
  afterAll(async () => { config.ADMIN_CONSOLE_ENABLED = false; config.ADMIN_CONSOLE_ORIGIN = undefined; await app.close(); });

  async function admin(role: AdminRole = "SUPER_ADMIN") {
    const email = `appcfg-${role.toLowerCase()}-${Date.now()}@example.com`;
    const account = await registerAccount(app, { email, password: "admin-password-123", businessName: `${role} Console` });
    await prisma.adminMembership.create({ data: { userId: account.userId, role } });
    const res = await app.inject({ method: "POST", url: "/admin/auth/login", headers: { origin: "http://localhost:5173" }, payload: { email, password: "admin-password-123" } });
    expect(res.statusCode).toBe(200);
    return { email, token: res.json().accessToken as string, csrf: res.json().csrfToken as string };
  }
  const headers = (token: string, csrf?: string) => ({ origin: "http://localhost:5173", authorization: `Bearer ${token}`, ...(csrf ? { "x-csrf-token": csrf } : {}) });

  it("serves production-equivalent defaults publicly, with no auth and a short cache", async () => {
    const res = await app.inject({ method: "GET", url: "/app-config" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toContain("max-age=60");
    const fromSite = await app.inject({ method: "GET", url: "/app-config", headers: { origin: "https://chakusarecovery.com" } });
    expect(fromSite.headers["access-control-allow-origin"]).toBeTruthy();
    const body = res.json();
    expect(body.schemaVersion).toBe(1);
    // Matches today's production builds: automation hidden, email auth off.
    expect(body.features).toEqual({ automation: false, billing: true, emailAuth: false, googleSignIn: true, appleSignIn: true });
    expect(body.links.privacyUrl).toBe("https://chakusarecovery.com/privacy");
    expect(body.app).toEqual({ minSupportedVersion: null, notice: null, maintenance: false });
    expect(body.company).toMatchObject({ copyrightHolder: "Chakusa", copyrightStartYear: 2026, legalName: null });
    expect(body.social).toEqual({ whatsappNumber: null, instagramUrl: null, facebookUrl: null, tiktokUrl: null, linkedinUrl: null });
  });

  it("lets a settings manager change a value, audited in the same transaction, and the apps see it", async () => {
    const a = await admin("SUPER_ADMIN");
    const res = await app.inject({ method: "PATCH", url: "/admin/app-config", headers: headers(a.token, a.csrf), payload: { key: "app.automation_enabled", value: true } });
    expect(res.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/app-config" })).json().features.automation).toBe(true);
    const audit = await prisma.adminAuditLog.findFirst({ where: { action: "APP_CONFIG_UPDATED", targetId: "app.automation_enabled" } });
    expect(audit).toMatchObject({ adminEmail: a.email, oldValue: { value: false }, newValue: { value: true, reset: false } });
  });

  it("resets a value to its default with null", async () => {
    const a = await admin();
    await app.inject({ method: "PATCH", url: "/admin/app-config", headers: headers(a.token, a.csrf), payload: { key: "app.notice", value: "Scheduled maintenance tonight" } });
    expect((await app.inject({ method: "GET", url: "/app-config" })).json().app.notice).toBe("Scheduled maintenance tonight");
    const reset = await app.inject({ method: "PATCH", url: "/admin/app-config", headers: headers(a.token, a.csrf), payload: { key: "app.notice", value: null } });
    expect(reset.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/app-config" })).json().app.notice).toBeNull();
    expect(await prisma.platformSetting.findUnique({ where: { key: "app.notice" } })).toBeNull();
  });

  it("requires CSRF and the manage permission; read-only admins can only view", async () => {
    const reader = await admin("READ_ONLY");
    const list = await app.inject({ method: "GET", url: "/admin/app-config", headers: headers(reader.token) });
    expect(list.statusCode).toBe(200);
    expect(list.json().items.map((i: { key: string }) => i.key)).toContain("app.min_supported_version");
    const denied = await app.inject({ method: "PATCH", url: "/admin/app-config", headers: headers(reader.token, reader.csrf), payload: { key: "app.billing_enabled", value: false } });
    expect(denied.statusCode).toBe(403);
    const manager = await admin("SUPER_ADMIN");
    const noCsrf = await app.inject({ method: "PATCH", url: "/admin/app-config", headers: headers(manager.token), payload: { key: "app.billing_enabled", value: false } });
    expect(noCsrf.statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/app-config" })).json().features.billing).toBe(true);
  });

  it("rejects off-domain links, bad versions, unknown keys, and a product session", async () => {
    const a = await admin();
    const bad = async (key: string, value: unknown) => (await app.inject({ method: "PATCH", url: "/admin/app-config", headers: headers(a.token, a.csrf), payload: { key, value } })).statusCode;
    expect(await bad("app.privacy_url", "https://evil.example.com/privacy")).toBe(400);
    expect(await bad("app.privacy_url", "http://chakusarecovery.com/privacy")).toBe(400);
    expect(await bad("app.support_email", "help@gmail.com")).toBe(400);
    expect(await bad("app.min_supported_version", "latest")).toBe(400);
    expect(await bad("app.not_a_key", true)).toBe(400);
    expect(await bad("app.ios_store_url", "https://chakusarecovery.com/app")).toBe(400);
    expect(await bad("app.instagram_url", "https://evil.com/chakusa")).toBe(400);
    expect(await bad("app.whatsapp_number", "0771234567")).toBe(400);
    expect(await bad("app.copyright_start_year", "26")).toBe(400);
    expect(await bad("app.whatsapp_number", "+263 77 123 4567")).toBe(200);
    expect(await bad("app.instagram_url", "https://www.instagram.com/chakusa")).toBe(200);
    expect(await bad("app.ios_store_url", "https://apps.apple.com/app/id123456789")).toBe(200);
    expect(await bad("app.billing_enabled", "yes")).toBe(400);
    const owner = await registerAccount(app, { email: "owner-appcfg@example.com" });
    const product = await app.inject({ method: "GET", url: "/admin/app-config", headers: { origin: "http://localhost:5173", authorization: `Bearer ${owner.token}` } });
    expect([401, 403]).toContain(product.statusCode);
  });

  it("falls back to the default when a stored value is invalid", async () => {
    await prisma.platformSetting.create({ data: { key: "app.terms_url", value: "javascript:alert(1)" } });
    expect((await app.inject({ method: "GET", url: "/app-config" })).json().links.termsUrl).toBe("https://chakusarecovery.com/terms");
  });

  it("normalizes values", () => {
    expect(normalizeAppConfigValue("app.support_email", " Support@ChakusaRecovery.com ")).toBe("support@chakusarecovery.com");
    expect(normalizeAppConfigValue("app.support_url", "https://www.chakusarecovery.com/help")).toBe("https://www.chakusarecovery.com/help");
    expect(normalizeAppConfigValue("app.notice", "  Hello   there  ")).toBe("Hello there");
    expect(() => normalizeAppConfigValue("app.notice", "x".repeat(161))).toThrow();
  });
});
