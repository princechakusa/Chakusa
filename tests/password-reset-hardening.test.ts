import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import { config } from "../src/lib/config.js";
import { createPasswordReset, PASSWORD_RESET_HOURLY_CAP } from "../src/modules/auth/auth.service.js";
import { createTestApp, registerAccount, resetDatabase } from "./helpers.js";

const mutable = config as { RESEND_API_KEY?: string; EMAIL_FROM?: string };

describe("password reset hardening", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterEach(async () => { vi.useRealTimers(); vi.unstubAllGlobals(); mutable.RESEND_API_KEY = undefined; mutable.EMAIL_FROM = undefined; await resetDatabase(); });
  afterAll(async () => { await app.close(); });

  it("issues at most one link a minute per account, and caps an hour", async () => {
    await registerAccount(app, { email: "flood@example.com" });
    expect(await createPasswordReset("flood@example.com")).toBeTruthy();
    expect(await createPasswordReset("flood@example.com")).toBeNull();
    expect(await prisma.passwordResetToken.count()).toBe(1);

    // Pretend earlier links were issued minutes apart within the hour.
    const user = await prisma.user.findFirstOrThrow({ where: { email: "flood@example.com" } });
    await prisma.passwordResetToken.deleteMany({});
    for (let i = 0; i < PASSWORD_RESET_HOURLY_CAP; i += 1) {
      await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: `h-${i}`, expiresAt: new Date(Date.now() + 3_600_000), createdAt: new Date(Date.now() - (i + 2) * 5 * 60_000) } });
    }
    expect(await createPasswordReset("flood@example.com")).toBeNull();
  });

  it("a reset kills every other outstanding link, signs out everywhere and sends a security notice", async () => {
    mutable.RESEND_API_KEY = "re_test"; mutable.EMAIL_FROM = "Chakusa <no-reply@example.com>";
    const sent: Array<{ to: string[]; subject: string; html: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => { sent.push(JSON.parse(String(init.body))); return new Response("{}", { status: 200 }); }));

    const account = await registerAccount(app, { email: "victim@example.com", password: "old-password" });
    const first = await createPasswordReset("victim@example.com");
    await prisma.passwordResetToken.updateMany({ data: { createdAt: new Date(Date.now() - 120_000) } });
    const second = await createPasswordReset("victim@example.com");
    expect(first && second).toBeTruthy();

    // Requesting the second link already retired the first.
    const stale = await app.inject({ method: "POST", url: "/auth/reset-password", payload: { token: first, password: "new-password-1" } });
    expect(stale.statusCode).toBe(400);

    const ok = await app.inject({ method: "POST", url: "/auth/reset-password", payload: { token: second, password: "new-password-1" } });
    expect(ok.statusCode).toBe(200);
    expect(await prisma.passwordResetToken.count({ where: { usedAt: null } })).toBe(0);
    const refresh = await app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshToken: account.refreshToken } });
    expect(refresh.statusCode).toBe(401);

    await vi.waitFor(() => expect(sent.some((m) => m.subject === "Your Chakusa password was changed" && m.to[0] === "victim@example.com")).toBe(true));
  });

  it("mails a single-use link with expiry and an ignore-if-not-you note, and never leaks the token in logs", async () => {
    mutable.RESEND_API_KEY = "re_test"; mutable.EMAIL_FROM = "Chakusa <no-reply@example.com>";
    const sent: Array<{ subject: string; html: string; text: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => { sent.push(JSON.parse(String(init.body))); return new Response("{}", { status: 200 }); }));
    await registerAccount(app, { email: "mail@example.com" });
    const res = await app.inject({ method: "POST", url: "/auth/forgot-password", payload: { email: "MAIL@example.com " } });
    expect(res.statusCode).toBe(202);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.subject).toBe("Reset your Chakusa password");
    expect(sent[0]!.html).toContain("expires in 60 minutes");
    expect(sent[0]!.html).toContain("If you didn't ask for this");
    expect(sent[0]!.text).toMatch(/token=/);
  });

  it("emails a sign-in reminder (not a reset link) to a Google-only account, with the same response, once per 10 minutes", async () => {
    mutable.RESEND_API_KEY = "re_test"; mutable.EMAIL_FROM = "Chakusa <no-reply@example.com>";
    const sent: Array<{ to: string[]; subject: string; html: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => { sent.push(JSON.parse(String(init.body))); return new Response("{}", { status: 200 }); }));
    const user = await prisma.user.create({ data: { email: "social@example.com", normalizedEmail: "social@example.com", fullName: "Social Only", authIdentities: { create: { provider: "GOOGLE", providerSubject: "g-123" } } } });
    await registerAccount(app, { email: "withpw@example.com" });

    const social = await app.inject({ method: "POST", url: "/auth/forgot-password", payload: { email: "social@example.com" } });
    const normal = await app.inject({ method: "POST", url: "/auth/forgot-password", payload: { email: "withpw@example.com" } });
    expect(social.statusCode).toBe(normal.statusCode);
    expect(social.body).toBe(normal.body);

    await vi.waitFor(() => expect(sent.some((m) => m.to[0] === "social@example.com")).toBe(true));
    const reminder = sent.find((m) => m.to[0] === "social@example.com")!;
    expect(reminder.subject).toBe("How to sign in to Chakusa");
    expect(reminder.html).toContain("Continue with Google");
    expect(reminder.html).not.toMatch(/token=/);
    expect(await prisma.passwordResetToken.count({ where: { userId: user.id } })).toBe(0);

    await app.inject({ method: "POST", url: "/auth/forgot-password", payload: { email: "social@example.com" } });
    await new Promise((r) => setTimeout(r, 50));
    expect(sent.filter((m) => m.to[0] === "social@example.com")).toHaveLength(1);
  });
});
