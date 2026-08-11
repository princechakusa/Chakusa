import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import { createPasswordReset } from "../src/modules/auth/auth.service.js";
import { authHeader, createTestApp, registerAccount, resetDatabase } from "./helpers.js";

describe("authentication foundation", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterEach(resetDatabase);
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("issues short-lived access and refresh tokens on login", async () => {
    await registerAccount(app, { email: "login-session@example.com", password: "password123" });
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: " LOGIN-SESSION@EXAMPLE.COM ", password: "password123" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ expiresIn: 900, tokenType: "Bearer" });
    expect(response.json().accessToken).toBeTypeOf("string");
    expect(response.json().refreshToken).toBeTypeOf("string");
    const stored = await prisma.authSession.findUnique({ where: { id: response.json().refreshToken.split(".")[0] } });
    expect(stored?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored?.tokenHash).not.toBe(response.json().refreshToken);
  });

  it("rejects an expired access token", async () => {
    const account = await registerAccount(app);
    const sessionId = account.refreshToken.split(".")[0]!;
    const expired = app.jwt.sign(
      { userId: account.userId, sessionId, type: "access" },
      { expiresIn: -1 },
    );
    const response = await app.inject({ method: "GET", url: "/auth/me", headers: authHeader(expired) });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("AUTH_TOKEN_INVALID");
  });

  it("rotates refresh tokens and rejects replay by revoking the token family", async () => {
    const account = await registerAccount(app);
    const rotated = await app.inject({
      method: "POST", url: "/auth/refresh", payload: { refreshToken: account.refreshToken },
    });
    expect(rotated.statusCode).toBe(200);
    expect(rotated.json().refreshToken).not.toBe(account.refreshToken);

    const replay = await app.inject({
      method: "POST", url: "/auth/refresh", payload: { refreshToken: account.refreshToken },
    });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error.code).toBe("AUTH_REFRESH_REUSED");

    const revokedReplacement = await app.inject({
      method: "POST", url: "/auth/refresh", payload: { refreshToken: rotated.json().refreshToken },
    });
    expect(revokedReplacement.statusCode).toBe(401);
  });

  it("logs out one token family on the server", async () => {
    const account = await registerAccount(app);
    const response = await app.inject({
      method: "POST", url: "/auth/logout", payload: { refreshToken: account.refreshToken },
    });
    expect(response.statusCode).toBe(204);
    const me = await app.inject({ method: "GET", url: "/auth/me", headers: authHeader(account.token) });
    expect(me.statusCode).toBe(401);
    expect(me.json().error.code).toBe("AUTH_SESSION_EXPIRED");
  });

  it("logs out every session for the user", async () => {
    const account = await registerAccount(app, { email: "all@example.com" });
    const second = await app.inject({
      method: "POST", url: "/auth/login", payload: { email: "all@example.com", password: "password123" },
    });
    const response = await app.inject({
      method: "POST", url: "/auth/logout-all", headers: authHeader(account.token),
    });
    expect(response.statusCode).toBe(204);
    for (const token of [account.token, second.json().accessToken]) {
      const me = await app.inject({ method: "GET", url: "/auth/me", headers: authHeader(token) });
      expect(me.statusCode).toBe(401);
    }
  });

  it("returns the same forgot-password response for known and unknown emails", async () => {
    await registerAccount(app, { email: "forgot@example.com" });
    const known = await app.inject({ method: "POST", url: "/auth/forgot-password", payload: { email: "forgot@example.com" } });
    const unknown = await app.inject({ method: "POST", url: "/auth/forgot-password", payload: { email: "unknown@example.com" } });
    expect(known.statusCode).toBe(202);
    expect(unknown.statusCode).toBe(202);
    expect(known.body).toBe(unknown.body);
    expect(await prisma.passwordResetToken.count()).toBe(1);
  });

  it("rate limits forgot-password requests", async () => {
    const isolatedApp = await createTestApp();
    const responses = [];
    for (let index = 0; index < 6; index += 1) {
      responses.push(await isolatedApp.inject({
        method: "POST", url: "/auth/forgot-password", payload: { email: `rate-${index}@example.com` },
      }));
    }
    expect(responses.slice(0, 5).every((response) => response.statusCode === 202)).toBe(true);
    expect(responses[5]!.statusCode).toBe(429);
    expect(responses[5]!.json().error.code).toBe("RATE_LIMITED");
    await isolatedApp.close();
  });

  it("resets a password once and revokes all existing sessions", async () => {
    const account = await registerAccount(app, { email: "reset@example.com", password: "old-password" });
    const token = await createPasswordReset("reset@example.com");
    expect(token).toBeTruthy();
    const storedReset = await prisma.passwordResetToken.findUnique({ where: { id: token!.split(".")[0]! } });
    expect(storedReset?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(storedReset?.tokenHash).not.toBe(token);
    const reset = await app.inject({
      method: "POST", url: "/auth/reset-password", payload: { token, password: "new-password" },
    });
    expect(reset.statusCode).toBe(200);
    const oldSession = await app.inject({ method: "GET", url: "/auth/me", headers: authHeader(account.token) });
    expect(oldSession.statusCode).toBe(401);
    const login = await app.inject({
      method: "POST", url: "/auth/login", payload: { email: "reset@example.com", password: "new-password" },
    });
    expect(login.statusCode).toBe(200);

    const reused = await app.inject({
      method: "POST", url: "/auth/reset-password", payload: { token, password: "another-password" },
    });
    expect(reused.statusCode).toBe(400);
    expect(reused.json().error.code).toBe("AUTH_RESET_TOKEN_USED");
  });

  it("rejects an expired password reset token", async () => {
    await registerAccount(app, { email: "expired@example.com" });
    const token = await createPasswordReset("expired@example.com");
    await prisma.passwordResetToken.update({
      where: { id: token!.split(".")[0] }, data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    const response = await app.inject({
      method: "POST", url: "/auth/reset-password", payload: { token, password: "new-password" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("AUTH_RESET_TOKEN_EXPIRED");
  });

  it("deletes the account and its owned business after reauthentication", async () => {
    const account = await registerAccount(app, { password: "delete-password" });
    const wrong = await app.inject({
      method: "POST", url: "/auth/delete-account", headers: authHeader(account.token), payload: { password: "wrong" },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error.code).toBe("AUTH_REAUTHENTICATION_REQUIRED");
    const response = await app.inject({
      method: "POST", url: "/auth/delete-account", headers: authHeader(account.token), payload: { password: "delete-password" },
    });
    expect(response.statusCode).toBe(204);
    expect(await prisma.user.count({ where: { id: account.userId } })).toBe(0);
    expect(await prisma.business.count({ where: { id: account.businessId } })).toBe(0);
  });

  it("enforces unique normalized email addresses", async () => {
    await registerAccount(app, { email: "Case@Example.com" });
    const response = await app.inject({
      method: "POST", url: "/auth/register",
      payload: { email: " case@example.COM ", password: "password123", fullName: "Duplicate", businessName: "Duplicate" },
    });
    expect(response.statusCode).toBe(409);
  });

  it("enforces provider identity uniqueness and cross-user isolation", async () => {
    const first = await registerAccount(app, { email: "first@example.com" });
    const second = await registerAccount(app, { email: "second@example.com" });
    await prisma.authIdentity.create({
      data: { userId: first.userId, provider: "GOOGLE", providerSubject: "issuer-subject", providerEmailVerified: true },
    });
    await expect(prisma.authIdentity.create({
      data: { userId: second.userId, provider: "GOOGLE", providerSubject: "issuer-subject", providerEmailVerified: true },
    })).rejects.toMatchObject({ code: "P2002" });
    await expect(prisma.authIdentity.create({
      data: { userId: first.userId, provider: "GOOGLE", providerSubject: "different-subject" },
    })).rejects.toMatchObject({ code: "P2002" });
    expect(await prisma.authIdentity.count({ where: { userId: second.userId } })).toBe(0);

    const providerOnly = await prisma.user.create({
      data: { email: "provider@example.com", normalizedEmail: "provider@example.com", fullName: "Provider User" },
    });
    expect(providerOnly.passwordHash).toBeNull();
    await prisma.authIdentity.create({
      data: { userId: providerOnly.id, provider: "APPLE", providerSubject: "apple-stable-subject", providerEmailVerified: true },
    });
  });
});
