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
    const isolatedApp = await createTestApp({ enableRateLimit: true });
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

  it("rate limits login attempts", async () => {
    const isolatedApp = await createTestApp({ enableRateLimit: true });
    await registerAccount(isolatedApp, { email: "rate-login@example.com", password: "password123" });
    const responses = [];
    for (let index = 0; index < 11; index += 1) {
      responses.push(await isolatedApp.inject({
        method: "POST", url: "/auth/login",
        payload: { email: "rate-login@example.com", password: "wrong-password" },
      }));
    }
    expect(responses.slice(0, 10).every((response) => response.statusCode === 401)).toBe(true);
    expect(responses[10]!.statusCode).toBe(429);
    expect(responses[10]!.json().error.code).toBe("RATE_LIMITED");
    await isolatedApp.close();
  });

  it("rate limits registration attempts", async () => {
    const isolatedApp = await createTestApp({ enableRateLimit: true });
    const responses = [];
    for (let index = 0; index < 21; index += 1) {
      responses.push(await isolatedApp.inject({
        method: "POST", url: "/auth/register",
        payload: {
          email: `rate-register-${index}@example.com`,
          password: "password123",
          fullName: "Rate Test",
          businessName: "Rate Test Co",
        },
      }));
    }
    expect(responses.slice(0, 20).every((response) => response.statusCode === 201)).toBe(true);
    expect(responses[20]!.statusCode).toBe(429);
    expect(responses[20]!.json().error.code).toBe("RATE_LIMITED");
    await isolatedApp.close();
  });

  it("rate limits refresh-token requests", async () => {
    const isolatedApp = await createTestApp({ enableRateLimit: true });
    const responses = [];
    for (let index = 0; index < 31; index += 1) {
      responses.push(await isolatedApp.inject({
        method: "POST", url: "/auth/refresh", payload: { refreshToken: "not-a-real-token" },
      }));
    }
    expect(responses.slice(0, 30).every((response) => response.statusCode === 401)).toBe(true);
    expect(responses[30]!.statusCode).toBe(429);
    expect(responses[30]!.json().error.code).toBe("RATE_LIMITED");
    await isolatedApp.close();
  });

  it("returns the identical error contract for a wrong password and a nonexistent email", async () => {
    await registerAccount(app, { email: "enum-check@example.com", password: "correct-password" });

    const wrongPassword = await app.inject({
      method: "POST", url: "/auth/login",
      payload: { email: "enum-check@example.com", password: "wrong-password" },
    });
    const nonexistentUser = await app.inject({
      method: "POST", url: "/auth/login",
      payload: { email: "does-not-exist@example.com", password: "wrong-password" },
    });

    expect(wrongPassword.statusCode).toBe(401);
    expect(nonexistentUser.statusCode).toBe(401);
    expect(wrongPassword.json()).toEqual(nonexistentUser.json());
    expect(wrongPassword.json().error.code).toBe("AUTH_INVALID_CREDENTIALS");
  });

  it("rejects login for a nonexistent user without a 500 and without an Argon2 verify shortcut", async () => {
    // Regression test for the timing side-channel fix: authenticateUser must
    // run verifyPasswordConstantTime even when no user row is found, rather
    // than short-circuiting past the hash comparison. We can't reliably
    // assert on timing in a normal test, so we assert on outcome/shape only:
    // a nonexistent user must produce the exact same error as a real user
    // with a wrong password (covered above), and must never 500.
    const response = await app.inject({
      method: "POST", url: "/auth/login",
      payload: { email: "never-registered@example.com", password: "irrelevant" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("AUTH_INVALID_CREDENTIALS");
  });

  it("rejects a malformed refresh token on /auth/refresh without a 500", async () => {
    const response = await app.inject({
      method: "POST", url: "/auth/refresh", payload: { refreshToken: "garbage-not-a-token" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("AUTH_TOKEN_INVALID");
  });

  it("rejects a refresh token with a well-formed id but wrong secret without a 500", async () => {
    const account = await registerAccount(app, { email: "wrong-secret@example.com" });
    const sessionId = account.refreshToken.split(".")[0];
    const response = await app.inject({
      method: "POST", url: "/auth/refresh",
      payload: { refreshToken: `${sessionId}.not-the-real-secret-portion-at-all` },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("AUTH_TOKEN_INVALID");
  });

  it("handles a malformed logout token safely (no error, no session revoked)", async () => {
    const account = await registerAccount(app, { email: "malformed-logout@example.com" });
    const response = await app.inject({
      method: "POST", url: "/auth/logout", payload: { refreshToken: "garbage-not-a-token" },
    });
    expect(response.statusCode).toBe(204);
    // The real session must still be alive — logout with an unrelated
    // garbage token must not revoke anything.
    const me = await app.inject({ method: "GET", url: "/auth/me", headers: authHeader(account.token) });
    expect(me.statusCode).toBe(200);
  });

  it("allows exactly one winner when two requests race to rotate the same refresh token", async () => {
    // This is safe to assert deterministically (not flaky) because the
    // correctness guarantee comes from a database-level atomic compare-and-
    // swap (`updateMany({ where: { rotatedAt: null, revokedAt: null } })`),
    // not from timing: Postgres row-level locking on the UPDATE means at
    // most one of two concurrent updateMany calls can match rotatedAt: null,
    // regardless of how the two requests happen to interleave. We don't
    // attempt to assert anything about relative timing, only about the
    // outcome: exactly one request must succeed and the other must observe
    // reuse (or a session already rotated by the winner).
    const account = await registerAccount(app, { email: "race-refresh@example.com" });

    const [first, second] = await Promise.all([
      app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshToken: account.refreshToken } }),
      app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshToken: account.refreshToken } }),
    ]);

    const statuses = [first.statusCode, second.statusCode].sort();
    // Exactly one 200 (the winner) and one 401 (the loser, reported as reuse
    // once the winner has already rotated the session).
    expect(statuses).toEqual([200, 401]);

    const loser = first.statusCode === 200 ? second : first;
    expect(loser.json().error.code).toBe("AUTH_REFRESH_REUSED");

    // The original session must now be rotated exactly once, not twice.
    const sessionId = account.refreshToken.split(".")[0]!;
    const original = await prisma.authSession.findUnique({ where: { id: sessionId } });
    expect(original?.rotatedAt).not.toBeNull();

    const sessionsInFamily = await prisma.authSession.count({ where: { familyId: original!.familyId } });
    // The original session plus exactly one replacement — the loser's
    // attempt must not have created a second replacement session.
    expect(sessionsInFamily).toBe(2);
  });

  it("rejects a naturally expired refresh token (not rotated, not revoked, just past its TTL)", async () => {
    const account = await registerAccount(app, { email: "naturally-expired@example.com" });
    const sessionId = account.refreshToken.split(".")[0]!;
    await prisma.authSession.update({
      where: { id: sessionId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    const response = await app.inject({
      method: "POST", url: "/auth/refresh", payload: { refreshToken: account.refreshToken },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("AUTH_SESSION_EXPIRED");
  });
});
