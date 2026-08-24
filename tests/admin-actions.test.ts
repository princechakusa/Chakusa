import type { AdminRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { config } from "../src/lib/config.js";
import { prisma } from "../src/lib/prisma.js";
import { createTestApp, registerAccount, resetDatabase } from "./helpers.js";

describe("admin guarded actions", () => {
  let app: FastifyInstance;
  beforeAll(async () => { config.ADMIN_CONSOLE_ENABLED = true; config.ADMIN_CONSOLE_ORIGIN = "http://localhost:5173"; app = await createTestApp(); });
  beforeEach(resetDatabase);
  afterAll(async () => { config.ADMIN_CONSOLE_ENABLED = false; config.ADMIN_CONSOLE_ORIGIN = undefined; await app.close(); });

  async function admin(role: AdminRole = "SUPER_ADMIN") {
    const email = `actions-${role.toLowerCase()}-${Date.now()}@example.com`;
    const account = await registerAccount(app, { email, password: "admin-password-123", businessName: `${role} Console` });
    await prisma.adminMembership.create({ data: { userId: account.userId, role } });
    const response = await app.inject({ method: "POST", url: "/admin/auth/login", headers: { origin: "http://localhost:5173" }, payload: { email, password: "admin-password-123" } });
    expect(response.statusCode).toBe(200);
    return { account, email, token: response.json().accessToken as string, csrf: response.json().csrfToken as string };
  }

  function headers(token: string, csrf?: string) {
    return { origin: "http://localhost:5173", authorization: `Bearer ${token}`, ...(csrf ? { "x-csrf-token": csrf } : {}) };
  }

  it("requires permission, CSRF, and the exact business name before resetting onboarding", async () => {
    const privileged = await admin("OPERATIONS");
    await prisma.business.update({ where: { id: privileged.account.businessId }, data: { onboardingCompletedAt: new Date("2026-01-02T03:04:05.000Z") } });

    const missingCsrf = await app.inject({ method: "POST", url: `/admin/businesses/${privileged.account.businessId}/reset-onboarding`, headers: headers(privileged.token), payload: { confirmation: "OPERATIONS Console" } });
    expect(missingCsrf.statusCode).toBe(400);
    const wrongConfirmation = await app.inject({ method: "POST", url: `/admin/businesses/${privileged.account.businessId}/reset-onboarding`, headers: headers(privileged.token, privileged.csrf), payload: { confirmation: "wrong" } });
    expect(wrongConfirmation.statusCode).toBe(400);
    expect((await prisma.business.findUniqueOrThrow({ where: { id: privileged.account.businessId } })).onboardingCompletedAt).not.toBeNull();

    const response = await app.inject({ method: "POST", url: `/admin/businesses/${privileged.account.businessId}/reset-onboarding`, headers: headers(privileged.token, privileged.csrf), payload: { confirmation: "OPERATIONS Console" } });
    expect(response.statusCode).toBe(200);
    expect(response.json().onboardingCompletedAt).toBeNull();
    expect(await prisma.adminAuditLog.findFirst({ where: { action: "BUSINESS_ONBOARDING_RESET", targetId: privileged.account.businessId } })).toMatchObject({ adminEmail: privileged.email, oldValue: { onboardingCompletedAt: "2026-01-02T03:04:05.000Z" }, newValue: { onboardingCompletedAt: null } });
  });

  it("revokes all target sessions atomically and records the count without exposing credentials", async () => {
    const privileged = await admin("SUPPORT_AGENT");
    const targetEmail = "session-target@example.com";
    const target = await registerAccount(app, { email: targetEmail });
    const response = await app.inject({ method: "POST", url: `/admin/users/${target.userId}/revoke-sessions`, headers: headers(privileged.token, privileged.csrf), payload: { confirmation: targetEmail } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ userId: target.userId, revokedSessionCount: 1 });
    expect(await prisma.authSession.count({ where: { userId: target.userId, revokedAt: null } })).toBe(0);
    expect(await prisma.authSession.count({ where: { userId: privileged.account.userId, revokedAt: null, scope: "ADMIN" } })).toBe(1);
    const audit = await prisma.adminAuditLog.findFirstOrThrow({ where: { action: "USER_SESSIONS_REVOKED", targetId: target.userId } });
    expect(audit).toMatchObject({ oldValue: { activeSessionCount: 1 }, newValue: { activeSessionCount: 0 } });
    expect(JSON.stringify(audit)).not.toContain("tokenHash");
  });

  it("denies read-only administrators before executing either action", async () => {
    const readOnly = await admin("READ_ONLY");
    const onboarding = await app.inject({ method: "POST", url: `/admin/businesses/${readOnly.account.businessId}/reset-onboarding`, headers: headers(readOnly.token, readOnly.csrf), payload: { confirmation: "READ_ONLY Console" } });
    const sessions = await app.inject({ method: "POST", url: `/admin/users/${readOnly.account.userId}/revoke-sessions`, headers: headers(readOnly.token, readOnly.csrf), payload: { confirmation: readOnly.email } });
    expect(onboarding.statusCode).toBe(403);
    expect(sessions.statusCode).toBe(403);
    expect(await prisma.adminAuditLog.count({ where: { action: { in: ["BUSINESS_ONBOARDING_RESET", "USER_SESSIONS_REVOKED"] } } })).toBe(0);
  });
});
