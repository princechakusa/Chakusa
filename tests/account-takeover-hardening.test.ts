import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import { config } from "../src/lib/config.js";
import { createPasswordReset } from "../src/modules/auth/auth.service.js";
import { requestPasswordReset } from "../src/modules/auth/passwordResetEmail.js";
import { createTestApp, registerAccount, resetDatabase } from "./helpers.js";

const mutable = config as { RESEND_API_KEY?: string; EMAIL_FROM?: string };
const log = { warn: () => undefined, info: () => undefined };

describe("account takeover hardening", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterEach(async () => { vi.unstubAllGlobals(); mutable.RESEND_API_KEY = undefined; mutable.EMAIL_FROM = undefined; await resetDatabase(); });
  afterAll(async () => { await app.close(); });

  it("stops password guessing on one account after 10 failures, even for the right password, without revealing whether it exists", async () => {
    await registerAccount(app, { email: "target@example.com", password: "Correct-horse-9" });
    for (let i = 0; i < 10; i += 1) {
      const wrong = await app.inject({ method: "POST", url: "/auth/login", payload: { email: "target@example.com", password: `guess-${i}-xx` } });
      expect(wrong.statusCode).toBe(401);
    }
    const locked = await app.inject({ method: "POST", url: "/auth/login", payload: { email: "Target@Example.com", password: "Correct-horse-9" } });
    expect(locked.statusCode).toBe(429);
    expect(locked.json().code ?? locked.json().error?.code).toBe("AUTH_TOO_MANY_ATTEMPTS");

    for (let i = 0; i < 10; i += 1) await app.inject({ method: "POST", url: "/auth/login", payload: { email: "nobody@example.com", password: `guess-${i}-xx` } });
    const ghost = await app.inject({ method: "POST", url: "/auth/login", payload: { email: "nobody@example.com", password: "anything-123" } });
    expect(ghost.statusCode).toBe(429);
  });

  it("a completed reset clears the lock and marks the email verified", async () => {
    await registerAccount(app, { email: "locked@example.com", password: "Old-password-77" });
    await prisma.user.update({ where: { normalizedEmail: "locked@example.com" }, data: { emailVerifiedAt: null } });
    for (let i = 0; i < 10; i += 1) await app.inject({ method: "POST", url: "/auth/login", payload: { email: "locked@example.com", password: `guess-${i}-xx` } });
    const token = await createPasswordReset("locked@example.com");
    const reset = await app.inject({ method: "POST", url: "/auth/reset-password", payload: { token, password: "Brand-new-pass-42" } });
    expect(reset.statusCode).toBe(200);
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email: "locked@example.com", password: "Brand-new-pass-42" } });
    expect(login.statusCode).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { normalizedEmail: "locked@example.com" } })).emailVerifiedAt).not.toBeNull();
  });

  it("refuses common and oversized new passwords on reset, and oversized sign-in passwords", async () => {
    await registerAccount(app, { email: "weak@example.com" });
    const token = await createPasswordReset("weak@example.com");
    const common = await app.inject({ method: "POST", url: "/auth/reset-password", payload: { token, password: "Password123" } });
    expect(common.statusCode).toBe(400);
    const huge = await app.inject({ method: "POST", url: "/customer/auth/reset-password", payload: { token, password: "a".repeat(129) } });
    expect(huge.statusCode).toBe(400);
    const hugeLogin = await app.inject({ method: "POST", url: "/auth/login", payload: { email: "weak@example.com", password: "a".repeat(1025) } });
    expect(hugeLogin.statusCode).toBe(400);
    // The link survives rejected attempts and still works with a good password.
    const ok = await app.inject({ method: "POST", url: "/auth/reset-password", payload: { token, password: "Sturdy-choice-31" } });
    expect(ok.statusCode).toBe(200);
  });

  it("mails the reset link to the address on the account, not the text typed", async () => {
    mutable.RESEND_API_KEY = "re_test"; mutable.EMAIL_FROM = "Chakusa <no-reply@example.com>";
    const sent: Array<{ to: string[] }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => { sent.push(JSON.parse(String(init.body))); return new Response("{}", { status: 200 }); }));
    await registerAccount(app, { email: "Owner.Name@Example.com" });
    await requestPasswordReset("  OWNER.NAME@example.COM ", log);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.to).toEqual([(await prisma.user.findUniqueOrThrow({ where: { normalizedEmail: "owner.name@example.com" } })).email]);
  });

  it("email footer uses the admin company settings, escaped, and omits an unset address", async () => {
    mutable.RESEND_API_KEY = "re_test"; mutable.EMAIL_FROM = "Chakusa <no-reply@example.com>";
    const sent: Array<{ html: string; text: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => { sent.push(JSON.parse(String(init.body))); return new Response("{}", { status: 200 }); }));
    await registerAccount(app, { email: "footer@example.com" });

    await requestPasswordReset("footer@example.com", log);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.html).toContain("chakusarecovery.com");
    expect(sent[0]!.html).not.toContain("<!--chakusa-footer-->");
    expect(sent[0]!.text).not.toMatch(/Harare/);

    await prisma.platformSetting.create({ data: { key: "app.company_address", value: "Joina City, Harare <b>Zimbabwe</b>" } });
    await prisma.passwordResetToken.deleteMany();
    await requestPasswordReset("footer@example.com", log);
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]!.html).toContain("Joina City, Harare &lt;b&gt;Zimbabwe&lt;/b&gt;");
    expect(sent[1]!.text).toContain("Joina City, Harare <b>Zimbabwe</b>");
  });
});

