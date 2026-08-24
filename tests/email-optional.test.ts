import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createTestApp, resetDatabase, registerAccount, authHeader, setPlan, setSubscriptionStatus } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { config } from "../src/lib/config.js";
import { acceptTeamInvitation } from "../src/modules/team/teamInvitations.service.js";
import { createSession } from "../src/modules/auth/auth.service.js";

/**
 * Production Infrastructure Phase 2.2 — route-level behavior with email
 * delivery unconfigured. The test process environment and vitest.config.ts
 * never sets RESEND_API_KEY/EMAIL_FROM, so every test in this file already
 * runs under "email disabled" conditions exactly as a production deployment
 * with EMAIL_ENABLED=false would — no mocking or env manipulation needed to
 * prove this path, which is itself useful evidence that the whole existing
 * suite already exercises the disabled-email path on every run.
 */
describe("Email delivery optional: password reset and team invitations without Resend", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("confirms this environment has no Resend credentials configured (sanity check for the rest of this file)", () => {
    expect(config.RESEND_API_KEY).toBeUndefined();
    expect(config.EMAIL_FROM).toBeUndefined();
  });

  // -------------------------------------------------------------------
  // Password reset
  // -------------------------------------------------------------------

  it("4/5. password reset returns the same safe response for an existing and a non-existent account, with email disabled", async () => {
    const existing = await registerAccount(app, { email: "email-optional-reset-1@example.com" });
    void existing;

    const existingResponse = await app.inject({ method: "POST", url: "/auth/forgot-password", payload: { email: "email-optional-reset-1@example.com" } });
    const missingResponse = await app.inject({ method: "POST", url: "/auth/forgot-password", payload: { email: "email-optional-reset-nobody@example.com" } });

    expect(existingResponse.statusCode).toBe(202);
    expect(missingResponse.statusCode).toBe(202);
    expect(existingResponse.json()).toEqual(missingResponse.json());
    expect(existingResponse.json()).toEqual({ message: "If an account exists, password reset instructions have been sent." });
  });

  it("password reset does not crash or 500 with email disabled", async () => {
    await registerAccount(app, { email: "email-optional-reset-2@example.com" });
    const response = await app.inject({ method: "POST", url: "/auth/forgot-password", payload: { email: "email-optional-reset-2@example.com" } });
    expect(response.statusCode).toBe(202);
  });

  // -------------------------------------------------------------------
  // Team invitations
  // -------------------------------------------------------------------

  async function businessOwner(email: string) {
    const owner = await registerAccount(app, { email });
    await setPlan(owner.businessId, "BUSINESS");
    await setSubscriptionStatus(owner.businessId, "ACTIVE");
    return owner;
  }

  it("6/7/8. team invitation creation succeeds with emailSent=false, the invitation remains valid, and the manual token is returned once", async () => {
    const owner = await businessOwner("email-optional-owner-1@example.com");
    const response = await app.inject({
      method: "POST",
      url: "/team/invitations",
      headers: authHeader(owner.token),
      payload: { email: "email-optional-invitee-1@example.com", role: "STAFF" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().emailSent).toBe(false);
    expect(response.json().token).toBeTypeOf("string");
    expect(response.json().token.length).toBeGreaterThan(10);

    const stored = await prisma.teamInvitation.findFirstOrThrow({ where: { id: response.json().id } });
    expect(stored.status).toBe("PENDING");

    const user = await prisma.user.create({ data: { email: "email-optional-invitee-1@example.com", normalizedEmail: "email-optional-invitee-1@example.com", fullName: "Invitee", passwordHash: null } });
    const { session } = await createSession(user.id, prisma);
    void session;
    const outcome = await acceptTeamInvitation(response.json().token, user.id);
    expect(outcome.outcome).toBe("accepted");
  });

  it("team invitation creation never returns 500 solely because email delivery is disabled", async () => {
    const owner = await businessOwner("email-optional-owner-2@example.com");
    const response = await app.inject({
      method: "POST",
      url: "/team/invitations",
      headers: authHeader(owner.token),
      payload: { email: "email-optional-invitee-2@example.com", role: "ADMIN" },
    });
    expect(response.statusCode).toBe(201);
  });

  // -------------------------------------------------------------------
  // No raw token leakage
  // -------------------------------------------------------------------

  it("9. neither email sender's source ever interpolates the raw token/secret into a log call", () => {
    const passwordResetSource = readFileSync(fileURLToPath(new URL("../src/modules/auth/passwordResetEmail.ts", import.meta.url)), "utf8");
    const teamInviteEmailSource = readFileSync(fileURLToPath(new URL("../src/modules/team/teamInvitationEmail.ts", import.meta.url)), "utf8");
    const authRoutesSource = readFileSync(fileURLToPath(new URL("../src/modules/auth/auth.routes.ts", import.meta.url)), "utf8");
    const teamRoutesSource = readFileSync(fileURLToPath(new URL("../src/modules/team/team.routes.ts", import.meta.url)), "utf8");

    for (const source of [passwordResetSource, teamInviteEmailSource, authRoutesSource, teamRoutesSource]) {
      expect(source).not.toMatch(/log\.(warn|error|info)\([^)]*token/i);
      expect(source).not.toMatch(/log\.(warn|error|info)\([^)]*RESEND_API_KEY/);
      expect(source).not.toMatch(/console\.(log|warn|error)\([^)]*token/i);
    }
  });
});
