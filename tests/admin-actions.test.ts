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

  it("identifies the current admin session and guards selected-session revocation", async () => {
    const first = await admin();
    const secondLogin = await app.inject({ method: "POST", url: "/admin/auth/login", headers: { origin: "http://localhost:5173" }, payload: { email: first.email, password: "admin-password-123" } });
    const secondToken = secondLogin.json().accessToken as string;
    const secondCsrf = secondLogin.json().csrfToken as string;
    const listed = await app.inject({ method: "GET", url: "/admin/auth/sessions", headers: headers(secondToken) });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items.filter((session: { current: boolean }) => session.current)).toHaveLength(1);
    const other = listed.json().items.find((session: { current: boolean }) => !session.current);

    const missingCsrf = await app.inject({ method: "DELETE", url: `/admin/auth/sessions/${other.id}`, headers: headers(secondToken), payload: { confirmation: "REVOKE" } });
    expect(missingCsrf.statusCode).toBe(400);
    const wrongConfirmation = await app.inject({ method: "DELETE", url: `/admin/auth/sessions/${other.id}`, headers: headers(secondToken, secondCsrf), payload: { confirmation: "wrong" } });
    expect(wrongConfirmation.statusCode).toBe(400);
    const revoked = await app.inject({ method: "DELETE", url: `/admin/auth/sessions/${other.id}`, headers: headers(secondToken, secondCsrf), payload: { confirmation: "REVOKE" } });
    expect(revoked.statusCode).toBe(204);
    expect(await prisma.adminAuditLog.findFirst({ where: { action: "ADMIN_SESSION_REVOKED" } })).not.toBeNull();
  });

  it("requires the exact admin email before securely logging out everywhere", async () => {
    const current = await admin();
    const wrong = await app.inject({ method: "POST", url: "/admin/auth/logout-all", headers: headers(current.token, current.csrf), payload: { confirmation: "wrong@example.com" } });
    expect(wrong.statusCode).toBe(400);
    expect(await prisma.authSession.count({ where: { userId: current.account.userId, scope: "ADMIN", revokedAt: null } })).toBe(1);
    const response = await app.inject({ method: "POST", url: "/admin/auth/logout-all", headers: headers(current.token, current.csrf), payload: { confirmation: current.email } });
    expect(response.statusCode).toBe(204);
    expect(await prisma.authSession.count({ where: { userId: current.account.userId, scope: "ADMIN", revokedAt: null } })).toBe(0);
    expect(await prisma.adminAuditLog.findFirst({ where: { action: "ADMIN_LOGOUT_ALL", targetId: current.account.userId } })).not.toBeNull();
  });

  it("lets only a Super Admin grant administration access through the audited user flow", async () => {
    const superAdmin = await admin("SUPER_ADMIN");
    const targetEmail = "new-support-admin@example.com";
    const target = await registerAccount(app, { email: targetEmail, password: "support-password-123" });

    const response = await app.inject({
      method: "POST",
      url: `/admin/users/${target.userId}/admin-access`,
      headers: headers(superAdmin.token, superAdmin.csrf),
      payload: { role: "SUPPORT_AGENT", confirmation: targetEmail },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ userId: target.userId, role: "SUPPORT_AGENT", status: "ACTIVE" });
    expect(await prisma.adminAuditLog.findFirst({ where: { action: "ADMIN_ACCESS_GRANTED", targetId: response.json().id } })).toMatchObject({
      adminEmail: superAdmin.email,
      newValue: { userId: target.userId, email: targetEmail, role: "SUPPORT_AGENT", status: "ACTIVE" },
    });

    const platformAdmin = await admin("PLATFORM_ADMIN");
    const deniedTarget = await registerAccount(app, { email: "denied-admin@example.com" });
    const denied = await app.inject({
      method: "POST",
      url: `/admin/users/${deniedTarget.userId}/admin-access`,
      headers: headers(platformAdmin.token, platformAdmin.csrf),
      payload: { role: "READ_ONLY", confirmation: "denied-admin@example.com" },
    });
    expect(denied.statusCode).toBe(403);
    expect(await prisma.adminMembership.findUnique({ where: { userId: deniedTarget.userId } })).toBeNull();
  });

  it("updates and revokes target admin access while invalidating only target admin sessions", async () => {
    const superAdmin = await admin("SUPER_ADMIN");
    const targetEmail = "managed-admin@example.com";
    const target = await registerAccount(app, { email: targetEmail, password: "managed-password-123" });
    await prisma.adminMembership.create({ data: { userId: target.userId, role: "OPERATIONS" } });
    const targetLogin = await app.inject({ method: "POST", url: "/admin/auth/login", headers: { origin: "http://localhost:5173" }, payload: { email: targetEmail, password: "managed-password-123" } });
    expect(targetLogin.statusCode).toBe(200);

    const updated = await app.inject({
      method: "PATCH",
      url: `/admin/users/${target.userId}/admin-access`,
      headers: headers(superAdmin.token, superAdmin.csrf),
      payload: { role: "READ_ONLY", status: "SUSPENDED", confirmation: targetEmail },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ role: "READ_ONLY", status: "SUSPENDED" });
    expect(await prisma.authSession.count({ where: { userId: target.userId, scope: "ADMIN", revokedAt: null } })).toBe(0);
    expect(await prisma.authSession.count({ where: { userId: target.userId, scope: "PRODUCT", revokedAt: null } })).toBe(1);
    expect(await prisma.adminAuditLog.findFirst({ where: { action: "ADMIN_ACCESS_UPDATED", targetId: updated.json().id } })).toMatchObject({
      oldValue: { role: "OPERATIONS", status: "ACTIVE" },
      newValue: { role: "READ_ONLY", status: "SUSPENDED", revokedSessionCount: 1 },
    });

    const revoked = await app.inject({
      method: "DELETE",
      url: `/admin/users/${target.userId}/admin-access`,
      headers: headers(superAdmin.token, superAdmin.csrf),
      payload: { confirmation: targetEmail },
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toEqual({ userId: target.userId, revoked: true });
    expect(await prisma.adminMembership.findUnique({ where: { userId: target.userId } })).toBeNull();
    expect(await prisma.adminAuditLog.findFirst({ where: { action: "ADMIN_ACCESS_REVOKED" } })).not.toBeNull();
  });

  it("prevents a Super Admin from changing or revoking their own access", async () => {
    const current = await admin("SUPER_ADMIN");
    const update = await app.inject({
      method: "PATCH",
      url: `/admin/users/${current.account.userId}/admin-access`,
      headers: headers(current.token, current.csrf),
      payload: { role: "READ_ONLY", confirmation: current.email },
    });
    const revoke = await app.inject({
      method: "DELETE",
      url: `/admin/users/${current.account.userId}/admin-access`,
      headers: headers(current.token, current.csrf),
      payload: { confirmation: current.email },
    });
    expect(update.statusCode).toBe(409);
    expect(revoke.statusCode).toBe(409);
    expect(await prisma.adminMembership.findUnique({ where: { userId: current.account.userId } })).toMatchObject({ role: "SUPER_ADMIN", status: "ACTIVE" });
  });

  it("audits and enforces the business lifecycle", async () => {
    const operations = await admin("OPERATIONS");
    const name = "OPERATIONS Console";
    const verified = await app.inject({ method: "POST", url: `/admin/businesses/${operations.account.businessId}/verify`, headers: headers(operations.token, operations.csrf), payload: { confirmation: name } });
    expect(verified.statusCode).toBe(200);
    expect((await prisma.business.findUniqueOrThrow({ where: { id: operations.account.businessId } })).verifiedAt).not.toBeNull();
    expect(await prisma.adminAuditLog.findFirst({ where: { action: "BUSINESS_VERIFIED", targetId: operations.account.businessId } })).not.toBeNull();
    const suspended = await app.inject({ method: "POST", url: `/admin/businesses/${operations.account.businessId}/suspend`, headers: headers(operations.token, operations.csrf), payload: { confirmation: name, reason: "Operational review requires temporary access pause" } });
    expect(suspended.statusCode).toBe(200);
    expect((await prisma.business.findUniqueOrThrow({ where: { id: operations.account.businessId } })).platformStatus).toBe("SUSPENDED");
    const productAccess = await app.inject({ method: "GET", url: "/business", headers: { authorization: `Bearer ${operations.account.accessToken}` } });
    expect(productAccess.statusCode).toBe(403);
    const reactivated = await app.inject({ method: "POST", url: `/admin/businesses/${operations.account.businessId}/reactivate`, headers: headers(operations.token, operations.csrf), payload: { confirmation: name } });
    expect(reactivated.statusCode).toBe(200);
    expect((await prisma.business.findUniqueOrThrow({ where: { id: operations.account.businessId } })).platformStatus).toBe("ACTIVE");
    expect(await prisma.adminAuditLog.count({ where: { action: { in: ["BUSINESS_VERIFIED", "BUSINESS_SUSPENDED", "BUSINESS_REACTIVATED"] }, targetId: operations.account.businessId } })).toBe(3);
  });

  it("only permits permanent deletion of suspended businesses and preserves the audit ledger", async () => {
    const superAdmin = await admin("SUPER_ADMIN");
    const target = await registerAccount(app, { email: "delete-target@example.com", businessName: "Delete Target" });
    const activeDelete = await app.inject({ method: "DELETE", url: `/admin/businesses/${target.businessId}`, headers: headers(superAdmin.token, superAdmin.csrf), payload: { confirmation: "Delete Target", reason: "Permanent removal requested after account closure" } });
    expect(activeDelete.statusCode).toBe(409);
    const suspended = await app.inject({ method: "POST", url: `/admin/businesses/${target.businessId}/suspend`, headers: headers(superAdmin.token, superAdmin.csrf), payload: { confirmation: "Delete Target", reason: "Permanent removal requested after account closure" } });
    expect(suspended.statusCode).toBe(200);
    const deleted = await app.inject({ method: "DELETE", url: `/admin/businesses/${target.businessId}`, headers: headers(superAdmin.token, superAdmin.csrf), payload: { confirmation: "Delete Target", reason: "Permanent removal requested after account closure" } });
    expect(deleted.statusCode).toBe(200);
    expect(await prisma.business.findUnique({ where: { id: target.businessId } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { id: target.userId } })).not.toBeNull();
    expect(await prisma.adminAuditLog.findFirst({ where: { action: "BUSINESS_DELETED", targetId: target.businessId } })).not.toBeNull();
  });
});
