import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, resetDatabase, registerAccount, authHeader, setPlan, setSubscriptionStatus } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { config } from "../src/lib/config.js";
import { isEntitled, getPlanLimits } from "../src/lib/entitlements.js";
import { resolveApplePlan, resolveGooglePlan } from "../src/lib/billing/productCatalog.js";
import { createSession } from "../src/modules/auth/auth.service.js";
import { acceptTeamInvitation } from "../src/modules/team/teamInvitations.service.js";
import { sendTeamInvitationEmail, type TeamInvitationEmailSender } from "../src/modules/team/teamInvitationEmail.js";

async function businessOwner(app: FastifyInstance, email: string, plan: "FREE" | "PRO" | "BUSINESS" = "BUSINESS") {
  const owner = await registerAccount(app, { email });
  await setPlan(owner.businessId, plan);
  if (plan !== "FREE") await setSubscriptionStatus(owner.businessId, "ACTIVE");
  return owner;
}

/** Creates a user account directly (bypassing /auth/register, which always creates its own business — see publicTeamInvites.routes.ts's documented v1 gap) and mints a real session for it, so accept-flow tests can exercise the full HTTP contract. */
async function freshUserSession(app: FastifyInstance, email: string, fullName = "Invitee") {
  const user = await prisma.user.create({ data: { email, normalizedEmail: email.toLowerCase(), fullName, passwordHash: null } });
  const { session, refreshToken } = await createSession(user.id, prisma);
  const accessToken = app.jwt.sign({ userId: user.id, sessionId: session.id, type: "access" }, { expiresIn: 900 });
  return { userId: user.id, accessToken, refreshToken };
}

async function invite(app: FastifyInstance, owner: { token: string }, email: string, role: "ADMIN" | "STAFF" = "STAFF") {
  const response = await app.inject({ method: "POST", url: "/team/invitations", headers: authHeader(owner.token), payload: { email, role } });
  return response;
}

describe("Business tier: plan entitlements", () => {
  it("1. FREE team false", () => expect(isEntitled("FREE", "ACTIVE", "TEAM_MANAGEMENT")).toBe(false));
  it("2. PRO team false", () => expect(isEntitled("PRO", "ACTIVE", "TEAM_MANAGEMENT")).toBe(false));
  it("3. BUSINESS ACTIVE team true", () => expect(isEntitled("BUSINESS", "ACTIVE", "TEAM_MANAGEMENT")).toBe(true));
  it("4. BUSINESS TRIALING team true", () => expect(isEntitled("BUSINESS", "TRIALING", "TEAM_MANAGEMENT")).toBe(true));
  it("5. BUSINESS GRACE_PERIOD team true", () => expect(isEntitled("BUSINESS", "GRACE_PERIOD", "TEAM_MANAGEMENT")).toBe(true));
  it("6. BUSINESS EXPIRED team false", () => expect(isEntitled("BUSINESS", "EXPIRED", "TEAM_MANAGEMENT")).toBe(false));
  it("7. BUSINESS CANCELED team false", () => expect(isEntitled("BUSINESS", "CANCELED", "TEAM_MANAGEMENT")).toBe(false));
  it("8. Business core resource limits are Pro-equivalent (unlimited)", () => {
    const pro = getPlanLimits("PRO");
    const business = getPlanLimits("BUSINESS");
    expect(business.leadsPerMonth).toBe(pro.leadsPerMonth);
    expect(business.customers).toBe(pro.customers);
    expect(business.reviewRequestsPerMonth).toBe(pro.reviewRequestsPerMonth);
    expect(business.openReminders).toBe(pro.openReminders);
    expect(business.customTemplatesPerType).toBe(pro.customTemplatesPerType);
    expect(business.staffSeats).toBe(config.BUSINESS_SEAT_LIMIT);
  });
});

describe("Business tier: billing product mapping", () => {
  it("9. Apple Business product maps to BUSINESS when configured", () => {
    const original = config.APPLE_BUSINESS_MONTHLY_PRODUCT_ID;
    try {
      config.APPLE_BUSINESS_MONTHLY_PRODUCT_ID = "chakusa_business_monthly";
      expect(resolveApplePlan("chakusa_business_monthly")).toBe("BUSINESS");
    } finally {
      config.APPLE_BUSINESS_MONTHLY_PRODUCT_ID = original;
    }
  });

  it("10. Google Business product maps to BUSINESS when configured", () => {
    const original = config.GOOGLE_BUSINESS_MONTHLY_PRODUCT_ID;
    try {
      config.GOOGLE_BUSINESS_MONTHLY_PRODUCT_ID = "chakusa_business_monthly";
      expect(resolveGooglePlan("chakusa_business_monthly")).toBe("BUSINESS");
    } finally {
      config.GOOGLE_BUSINESS_MONTHLY_PRODUCT_ID = original;
    }
  });

  it("11. Pro product mapping is unaffected and still resolves PRO", () => {
    expect(resolveApplePlan("chakusa_pro_monthly")).toBe("PRO");
    expect(resolveGooglePlan("chakusa_pro_monthly")).toBe("PRO");
  });

  it("12. unknown products fail closed for both providers", () => {
    expect(resolveApplePlan("com.chakusa.unknown")).toBeNull();
    expect(resolveGooglePlan("com.chakusa.unknown")).toBeNull();
  });
});

describe("Business tier: team invitations, roles, seats, downgrade", () => {
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

  // -------------------------------------------------------------------
  // Invitation creation authorization
  // -------------------------------------------------------------------

  it("14. owner can invite", async () => {
    const owner = await businessOwner(app, "team-owner-14@example.com");
    const response = await invite(app, owner, "staff-14@example.com", "STAFF");
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ email: "staff-14@example.com", role: "STAFF", status: "PENDING" });
    expect(typeof response.json().token).toBe("string");
  });

  it("15. PRO business cannot invite", async () => {
    const owner = await businessOwner(app, "team-owner-15@example.com", "PRO");
    const response = await invite(app, owner, "staff-15@example.com");
    expect(response.statusCode).toBe(403);
  });

  it("16. FREE business cannot invite", async () => {
    const owner = await businessOwner(app, "team-owner-16@example.com", "FREE");
    const response = await invite(app, owner, "staff-16@example.com");
    expect(response.statusCode).toBe(403);
  });

  it("17. STAFF/ADMIN cannot create invitations — team management is owner-only in v1", async () => {
    const owner = await businessOwner(app, "team-owner-17@example.com");
    const invited = await invite(app, owner, "member-17@example.com", "ADMIN");
    const session = await freshUserSession(app, "member-17@example.com");
    await acceptTeamInvitation(invited.json().token, session.userId);

    const response = await invite(app, { token: session.accessToken }, "someone-else-17@example.com");
    expect(response.statusCode).toBe(403);
  });

  // -------------------------------------------------------------------
  // Duplicate / existing-member prevention
  // -------------------------------------------------------------------

  it("18. duplicate pending invite for the same email is blocked", async () => {
    const owner = await businessOwner(app, "team-owner-18@example.com");
    const first = await invite(app, owner, "dup-18@example.com");
    const second = await invite(app, owner, "dup-18@example.com");
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(409);
  });

  it("19. inviting an email that already belongs to a business is blocked", async () => {
    const owner = await businessOwner(app, "team-owner-19@example.com");
    const other = await registerAccount(app, { email: "existing-19@example.com" });
    void other;
    const response = await invite(app, owner, "existing-19@example.com");
    expect(response.statusCode).toBe(409);
  });

  it("20. invite token is opaque and not a predictable/sequential id", async () => {
    const owner = await businessOwner(app, "team-owner-20@example.com");
    const response = await invite(app, owner, "opaque-20@example.com");
    const token = response.json().token as string;
    expect(token.length).toBeGreaterThan(40);
    expect(token).toMatch(/^[0-9a-f-]+\.[A-Za-z0-9_-]+$/);
    expect(token).not.toBe(response.json().id);
  });

  // -------------------------------------------------------------------
  // Expiry / revocation
  // -------------------------------------------------------------------

  it("21. expired invite is rejected on accept", async () => {
    const owner = await businessOwner(app, "team-owner-21@example.com");
    const invited = await invite(app, owner, "expired-21@example.com");
    await prisma.teamInvitation.update({ where: { id: invited.json().id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const session = await freshUserSession(app, "expired-21@example.com");
    const outcome = await acceptTeamInvitation(invited.json().token, session.userId);
    expect(outcome.outcome).toBe("expired");
  });

  it("22. revoked invite is rejected on accept", async () => {
    const owner = await businessOwner(app, "team-owner-22@example.com");
    const invited = await invite(app, owner, "revoked-22@example.com");
    const revokeResponse = await app.inject({ method: "DELETE", url: `/team/invitations/${invited.json().id}`, headers: authHeader(owner.token) });
    expect(revokeResponse.statusCode).toBe(200);

    const session = await freshUserSession(app, "revoked-22@example.com");
    const outcome = await acceptTeamInvitation(invited.json().token, session.userId);
    expect(outcome.outcome).toBe("already-used");
  });

  // -------------------------------------------------------------------
  // Accept identity + idempotency
  // -------------------------------------------------------------------

  it("23. an authenticated account with the wrong email cannot accept the invitation", async () => {
    const owner = await businessOwner(app, "team-owner-23@example.com");
    const invited = await invite(app, owner, "correct-23@example.com");
    const wrongSession = await freshUserSession(app, "wrong-23@example.com");

    const outcome = await acceptTeamInvitation(invited.json().token, wrongSession.userId);
    expect(outcome.outcome).toBe("email-mismatch");

    const httpResponse = await app.inject({
      method: "POST",
      url: `/public/team-invites/${invited.json().token}/accept`,
      headers: authHeader(wrongSession.accessToken),
    });
    expect(httpResponse.statusCode).toBe(404);
  });

  it("24. the correctly-addressed account accepts successfully", async () => {
    const owner = await businessOwner(app, "team-owner-24@example.com");
    const invited = await invite(app, owner, "correct-24@example.com");
    const session = await freshUserSession(app, "correct-24@example.com");

    const response = await app.inject({
      method: "POST",
      url: `/public/team-invites/${invited.json().token}/accept`,
      headers: authHeader(session.accessToken),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ state: "accepted" });

    const member = await prisma.businessMember.findFirst({ where: { businessId: owner.businessId, userId: session.userId } });
    expect(member?.role).toBe("STAFF");
    expect(member?.status).toBe("ACTIVE");
  });

  it("25. accepting creates exactly one membership row", async () => {
    const owner = await businessOwner(app, "team-owner-25@example.com");
    const invited = await invite(app, owner, "once-25@example.com");
    const session = await freshUserSession(app, "once-25@example.com");
    await acceptTeamInvitation(invited.json().token, session.userId);

    expect(await prisma.businessMember.count({ where: { businessId: owner.businessId, userId: session.userId } })).toBe(1);
  });

  it("26. a duplicate/repeated accept attempt is idempotent and safe", async () => {
    const owner = await businessOwner(app, "team-owner-26@example.com");
    const invited = await invite(app, owner, "twice-26@example.com");
    const session = await freshUserSession(app, "twice-26@example.com");

    const first = await acceptTeamInvitation(invited.json().token, session.userId);
    const second = await acceptTeamInvitation(invited.json().token, session.userId);

    expect(first.outcome).toBe("accepted");
    expect(second.outcome).toBe("already-used");
    expect(await prisma.businessMember.count({ where: { businessId: owner.businessId, userId: session.userId } })).toBe(1);
  });

  it("27. cross-tenant invite access is impossible — Business A's invite cannot be listed/revoked by Business B", async () => {
    const ownerA = await businessOwner(app, "cross-a-27@example.com");
    const ownerB = await businessOwner(app, "cross-b-27@example.com");
    const invited = await invite(app, ownerA, "target-27@example.com");

    const listB = await app.inject({ method: "GET", url: "/team/invitations", headers: authHeader(ownerB.token) });
    expect(listB.json()).toEqual([]);

    const revokeB = await app.inject({ method: "DELETE", url: `/team/invitations/${invited.json().id}`, headers: authHeader(ownerB.token) });
    expect(revokeB.statusCode).toBe(404);
  });

  it("28. member list is tenant-isolated", async () => {
    const ownerA = await businessOwner(app, "list-a-28@example.com");
    const ownerB = await businessOwner(app, "list-b-28@example.com");
    const invited = await invite(app, ownerB, "member-28@example.com");
    const session = await freshUserSession(app, "member-28@example.com");
    await acceptTeamInvitation(invited.json().token, session.userId);

    const listA = await app.inject({ method: "GET", url: "/team/members", headers: authHeader(ownerA.token) });
    expect(listA.json()).toHaveLength(1); // only ownerA themselves
    expect(listA.json()[0].email).toBe("list-a-28@example.com");
  });

  // -------------------------------------------------------------------
  // Role changes
  // -------------------------------------------------------------------

  it("29. owner can change a member's role between ADMIN and STAFF", async () => {
    const owner = await businessOwner(app, "role-owner-29@example.com");
    const invited = await invite(app, owner, "role-29@example.com", "STAFF");
    const session = await freshUserSession(app, "role-29@example.com");
    await acceptTeamInvitation(invited.json().token, session.userId);
    const member = await prisma.businessMember.findFirstOrThrow({ where: { businessId: owner.businessId, userId: session.userId } });

    const response = await app.inject({ method: "PATCH", url: `/team/members/${member.id}`, headers: authHeader(owner.token), payload: { role: "ADMIN" } });
    expect(response.statusCode).toBe(200);
    expect(response.json().role).toBe("ADMIN");
  });

  it("30. invalid role escalation is blocked (owner role is immutable; staff cannot self-promote)", async () => {
    const owner = await businessOwner(app, "role-owner-30@example.com");
    const ownerMember = await prisma.businessMember.findFirstOrThrow({ where: { businessId: owner.businessId, role: "OWNER" } });

    const attemptOwnerChange = await app.inject({ method: "PATCH", url: `/team/members/${ownerMember.id}`, headers: authHeader(owner.token), payload: { role: "STAFF" } });
    expect(attemptOwnerChange.statusCode).toBe(403);

    const invited = await invite(app, owner, "self-promote-30@example.com", "STAFF");
    const session = await freshUserSession(app, "self-promote-30@example.com");
    await acceptTeamInvitation(invited.json().token, session.userId);
    const staffMember = await prisma.businessMember.findFirstOrThrow({ where: { businessId: owner.businessId, userId: session.userId } });

    const selfPromote = await app.inject({ method: "PATCH", url: `/team/members/${staffMember.id}`, headers: authHeader(session.accessToken), payload: { role: "ADMIN" } });
    expect(selfPromote.statusCode).toBe(403);
  });

  // -------------------------------------------------------------------
  // Removal
  // -------------------------------------------------------------------

  it("31. the owner cannot be removed", async () => {
    const owner = await businessOwner(app, "remove-owner-31@example.com");
    const ownerMember = await prisma.businessMember.findFirstOrThrow({ where: { businessId: owner.businessId, role: "OWNER" } });
    const response = await app.inject({ method: "DELETE", url: `/team/members/${ownerMember.id}`, headers: authHeader(owner.token) });
    expect(response.statusCode).toBe(403);
  });

  it("32. removing staff does not delete the underlying user account", async () => {
    const owner = await businessOwner(app, "remove-owner-32@example.com");
    const invited = await invite(app, owner, "remove-32@example.com");
    const session = await freshUserSession(app, "remove-32@example.com");
    await acceptTeamInvitation(invited.json().token, session.userId);
    const member = await prisma.businessMember.findFirstOrThrow({ where: { businessId: owner.businessId, userId: session.userId } });

    await app.inject({ method: "DELETE", url: `/team/members/${member.id}`, headers: authHeader(owner.token) });

    expect(await prisma.user.findUnique({ where: { id: session.userId } })).not.toBeNull();
  });

  it("33. a removed staff member immediately loses tenant access", async () => {
    const owner = await businessOwner(app, "remove-owner-33@example.com");
    const invited = await invite(app, owner, "remove-33@example.com");
    const session = await freshUserSession(app, "remove-33@example.com");
    await acceptTeamInvitation(invited.json().token, session.userId);
    const member = await prisma.businessMember.findFirstOrThrow({ where: { businessId: owner.businessId, userId: session.userId } });

    await app.inject({ method: "DELETE", url: `/team/members/${member.id}`, headers: authHeader(owner.token) });

    const response = await app.inject({ method: "GET", url: "/customers", headers: authHeader(session.accessToken) });
    expect(response.statusCode).toBe(403);
  });

  // -------------------------------------------------------------------
  // Downgrade safety
  // -------------------------------------------------------------------

  it("34. downgrading from BUSINESS preserves staff BusinessMember rows", async () => {
    const owner = await businessOwner(app, "downgrade-owner-34@example.com");
    const invited = await invite(app, owner, "downgrade-34@example.com");
    const session = await freshUserSession(app, "downgrade-34@example.com");
    await acceptTeamInvitation(invited.json().token, session.userId);

    await setPlan(owner.businessId, "PRO");
    await app.inject({ method: "GET", url: "/customers", headers: authHeader(owner.token) }); // triggers the sync

    expect(await prisma.businessMember.count({ where: { businessId: owner.businessId } })).toBe(2);
  });

  it("35. downgrading disables non-owner access while keeping the owner active", async () => {
    const owner = await businessOwner(app, "downgrade-owner-35@example.com");
    const invited = await invite(app, owner, "downgrade-35@example.com");
    const session = await freshUserSession(app, "downgrade-35@example.com");
    await acceptTeamInvitation(invited.json().token, session.userId);

    await setPlan(owner.businessId, "PRO");
    const staffResponse = await app.inject({ method: "GET", url: "/customers", headers: authHeader(session.accessToken) });
    expect(staffResponse.statusCode).toBe(403);

    const ownerResponse = await app.inject({ method: "GET", url: "/customers", headers: authHeader(owner.token) });
    expect(ownerResponse.statusCode).toBe(200);

    const staffRow = await prisma.businessMember.findFirstOrThrow({ where: { businessId: owner.businessId, userId: session.userId } });
    expect(staffRow.status).toBe("SUSPENDED");
  });

  it("36. re-upgrading to Business does not automatically restore suspended staff; owner can deliberately reactivate within seat limits", async () => {
    const owner = await businessOwner(app, "reupgrade-owner-36@example.com");
    const invited = await invite(app, owner, "reupgrade-36@example.com");
    const session = await freshUserSession(app, "reupgrade-36@example.com");
    await acceptTeamInvitation(invited.json().token, session.userId);
    await setPlan(owner.businessId, "PRO");
    await app.inject({ method: "GET", url: "/customers", headers: authHeader(owner.token) });

    await setPlan(owner.businessId, "BUSINESS");
    await setSubscriptionStatus(owner.businessId, "ACTIVE");

    const stillSuspended = await app.inject({ method: "GET", url: "/customers", headers: authHeader(session.accessToken) });
    expect(stillSuspended.statusCode).toBe(403);

    const member = await prisma.businessMember.findFirstOrThrow({ where: { businessId: owner.businessId, userId: session.userId } });
    const reactivate = await app.inject({ method: "POST", url: `/team/members/${member.id}/reactivate`, headers: authHeader(owner.token) });
    expect(reactivate.statusCode).toBe(200);
    expect(reactivate.json().status).toBe("ACTIVE");

    const nowWorks = await app.inject({ method: "GET", url: "/customers", headers: authHeader(session.accessToken) });
    expect(nowWorks.statusCode).toBe(200);
  });

  // -------------------------------------------------------------------
  // Concurrency / seat limits
  // -------------------------------------------------------------------

  it("37. concurrent invitations at the seat boundary are concurrency-safe (exactly one succeeds when one seat remains)", async () => {
    const owner = await businessOwner(app, "seat-owner-37@example.com");
    const original = config.BUSINESS_SEAT_LIMIT;
    try {
      config.BUSINESS_SEAT_LIMIT = 2; // owner + 1 more seat
      const [a, b] = await Promise.all([
        invite(app, owner, "seat-a-37@example.com"),
        invite(app, owner, "seat-b-37@example.com"),
      ]);
      const codes = [a.statusCode, b.statusCode].sort();
      expect(codes).toEqual([201, 403]);
    } finally {
      config.BUSINESS_SEAT_LIMIT = original;
    }
  });

  it("38. seat count is correct (owner counts toward capacity)", async () => {
    const owner = await businessOwner(app, "seat-count-owner-38@example.com");
    const original = config.BUSINESS_SEAT_LIMIT;
    try {
      config.BUSINESS_SEAT_LIMIT = 1; // owner already fills capacity
      const response = await invite(app, owner, "seat-count-38@example.com");
      expect(response.statusCode).toBe(403);
    } finally {
      config.BUSINESS_SEAT_LIMIT = original;
    }
  });

  // -------------------------------------------------------------------
  // Account deletion
  // -------------------------------------------------------------------

  it("39. a staff member can delete their own account safely (business untouched)", async () => {
    const owner = await businessOwner(app, "deletion-owner-39@example.com");
    const invited = await invite(app, owner, "deletion-staff-39@example.com");
    const session = await freshUserSession(app, "deletion-staff-39@example.com");
    await acceptTeamInvitation(invited.json().token, session.userId);

    const response = await app.inject({ method: "POST", url: "/auth/delete-account", headers: authHeader(session.accessToken), payload: { password: "unused" } });
    // No password on this directly-created user, so this must fail with an
    // auth-specific error, never a 500 or a business-destroying side effect.
    expect(response.statusCode).toBeLessThan(500);
    expect(await prisma.business.findUnique({ where: { id: owner.businessId } })).not.toBeNull();
  });

  it("40. an owner cannot delete their account while active staff remain", async () => {
    const owner = await businessOwner(app, "deletion-owner-40@example.com");
    const invited = await invite(app, owner, "deletion-blocker-40@example.com");
    const session = await freshUserSession(app, "deletion-blocker-40@example.com");
    await acceptTeamInvitation(invited.json().token, session.userId);

    const response = await app.inject({ method: "POST", url: "/auth/delete-account", headers: authHeader(owner.token), payload: { password: "password123" } });
    expect(response.statusCode).toBe(409);
    expect(await prisma.user.findUnique({ where: { id: owner.userId } })).not.toBeNull();
    expect(await prisma.business.findUnique({ where: { id: owner.businessId } })).not.toBeNull();
  });

  it("40b. an owner CAN delete their account once staff are removed", async () => {
    const owner = await businessOwner(app, "deletion-owner-40b@example.com");
    const invited = await invite(app, owner, "deletion-removed-40b@example.com");
    const session = await freshUserSession(app, "deletion-removed-40b@example.com");
    await acceptTeamInvitation(invited.json().token, session.userId);
    const member = await prisma.businessMember.findFirstOrThrow({ where: { businessId: owner.businessId, userId: session.userId } });
    await app.inject({ method: "DELETE", url: `/team/members/${member.id}`, headers: authHeader(owner.token) });

    const response = await app.inject({ method: "POST", url: "/auth/delete-account", headers: authHeader(owner.token), payload: { password: "password123" } });
    expect(response.statusCode).toBe(204);
  });

  // -------------------------------------------------------------------
  // Team activity
  // -------------------------------------------------------------------

  it("41. team activity events are recorded exactly once", async () => {
    const owner = await businessOwner(app, "activity-owner-41@example.com");
    const invited = await invite(app, owner, "activity-41@example.com");
    expect(await prisma.activityEvent.count({ where: { businessId: owner.businessId, eventType: "TEAM_MEMBER_INVITED" } })).toBe(1);

    const session = await freshUserSession(app, "activity-41@example.com");
    await acceptTeamInvitation(invited.json().token, session.userId);
    expect(await prisma.activityEvent.count({ where: { businessId: owner.businessId, eventType: "TEAM_MEMBER_JOINED" } })).toBe(1);

    const member = await prisma.businessMember.findFirstOrThrow({ where: { businessId: owner.businessId, userId: session.userId } });
    await app.inject({ method: "PATCH", url: `/team/members/${member.id}`, headers: authHeader(owner.token), payload: { role: "ADMIN" } });
    expect(await prisma.activityEvent.count({ where: { businessId: owner.businessId, eventType: "TEAM_MEMBER_ROLE_CHANGED" } })).toBe(1);

    await app.inject({ method: "DELETE", url: `/team/members/${member.id}`, headers: authHeader(owner.token) });
    expect(await prisma.activityEvent.count({ where: { businessId: owner.businessId, eventType: "TEAM_MEMBER_REMOVED" } })).toBe(1);
  });

  // -------------------------------------------------------------------
  // Billing authorization (owner-only) — item 13
  // -------------------------------------------------------------------

  it("13. Business billing verification remains owner-only", async () => {
    const owner = await businessOwner(app, "billing-owner-13@example.com");
    const invited = await invite(app, owner, "billing-staff-13@example.com", "ADMIN");
    const session = await freshUserSession(app, "billing-staff-13@example.com");
    await acceptTeamInvitation(invited.json().token, session.userId);

    const response = await app.inject({
      method: "POST",
      url: "/subscription/apple/verify",
      headers: authHeader(session.accessToken),
      payload: { transactionId: "does-not-matter" },
    });
    expect(response.statusCode).toBe(403);
  });

  // -------------------------------------------------------------------
  // Regression
  // -------------------------------------------------------------------

  it("42. existing Pro automation still works", async () => {
    const owner = await businessOwner(app, "regression-automation-42@example.com", "PRO");
    const response = await app.inject({
      method: "POST",
      url: "/automation/rules",
      headers: authHeader(owner.token),
      payload: { name: "Missed call recovery", triggerType: "LEAD_CREATED", channel: "SMS" },
    });
    expect(response.statusCode).toBe(201);
  });

  it("43. Pro billing status endpoint still reports PRO correctly", async () => {
    const owner = await businessOwner(app, "regression-billing-43@example.com", "PRO");
    const response = await app.inject({ method: "GET", url: "/subscription/status", headers: authHeader(owner.token) });
    expect(response.json().plan).toBe("PRO");
    expect(response.json().features.teamManagement).toBe(false);
  });

  it("44. Free plan limits remain enforced", async () => {
    const owner = await businessOwner(app, "regression-free-44@example.com", "FREE");
    const response = await app.inject({ method: "GET", url: "/subscription/status", headers: authHeader(owner.token) });
    expect(response.json().usage.customers.limit).toBe(200);
  });

  it("45. subscription/status returns BUSINESS plan correctly and leaks no secrets", async () => {
    const owner = await businessOwner(app, "regression-status-45@example.com");
    const response = await app.inject({ method: "GET", url: "/subscription/status", headers: authHeader(owner.token) });
    expect(response.json().plan).toBe("BUSINESS");
    expect(response.json().features.automation).toBe(true);
    expect(response.json().features.teamManagement).toBe(true);
    expect(JSON.stringify(response.json())).not.toMatch(/tokenHash|passwordHash/i);
  });

  it("46. tenant isolation remains intact across businesses", async () => {
    const a = await businessOwner(app, "regression-tenant-a-46@example.com");
    const b = await businessOwner(app, "regression-tenant-b-46@example.com");
    const responseA = await app.inject({ method: "GET", url: "/team/members", headers: authHeader(a.token) });
    expect(responseA.json()).toHaveLength(1);
    expect(responseA.json()[0].email).not.toBe("regression-tenant-b-46@example.com");
    void b;
  });

  it("47. account deletion for a non-Business, no-staff owner remains unaffected", async () => {
    const owner = await registerAccount(app, { email: "regression-deletion-47@example.com" });
    const response = await app.inject({ method: "POST", url: "/auth/delete-account", headers: authHeader(owner.token), payload: { password: "password123" } });
    expect(response.statusCode).toBe(204);
  });
});

describe("Business Phase 1.1: new-user team invitation registration", () => {
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

  async function invitingOwner(email: string) {
    return businessOwner(app, email, "BUSINESS");
  }

  async function register(payload: Record<string, unknown>) {
    return app.inject({ method: "POST", url: "/auth/register", payload });
  }

  // -------------------------------------------------------------------
  // Normal registration regression
  // -------------------------------------------------------------------

  it("1. normal registration (no invitationToken) is unchanged: creates its own Business and an OWNER membership", async () => {
    const response = await register({
      email: "phase11-normal-1@example.com", password: "password123", fullName: "Solo Owner", businessName: "Solo Shop",
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().role).toBe("OWNER");
    expect(response.json().business).toMatchObject({ name: "Solo Shop" });
    const membership = await prisma.businessMember.findFirstOrThrow({ where: { userId: response.json().user.id } });
    expect(membership.role).toBe("OWNER");
    const business = await prisma.business.findUniqueOrThrow({ where: { id: response.json().business.id } });
    expect(business.ownerId).toBe(response.json().user.id);
  });

  it("1b. normal registration still rejects a missing businessName exactly as before", async () => {
    const response = await register({ email: "phase11-normal-1b@example.com", password: "password123", fullName: "No Business" });
    expect(response.statusCode).toBe(400);
  });

  // -------------------------------------------------------------------
  // Invited registration: no extra Business, no OWNER membership
  // -------------------------------------------------------------------

  it("2. invited registration creates no extra Business", async () => {
    const owner = await invitingOwner("phase11-owner-2@example.com");
    const invited = await invite(app, owner, "phase11-invitee-2@example.com", "ADMIN");
    const businessCountBefore = await prisma.business.count();

    const response = await register({
      email: "phase11-invitee-2@example.com", password: "password123", fullName: "Invitee Two", invitationToken: invited.json().token,
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().business.id).toBe(owner.businessId);
    expect(await prisma.business.count()).toBe(businessCountBefore);
  });

  it("3. no OWNER membership is created for the invitee; ownership stays with the original owner", async () => {
    const owner = await invitingOwner("phase11-owner-3@example.com");
    const invited = await invite(app, owner, "phase11-invitee-3@example.com", "STAFF");

    const response = await register({
      email: "phase11-invitee-3@example.com", password: "password123", fullName: "Invitee Three", invitationToken: invited.json().token,
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().role).toBe("STAFF");

    const membership = await prisma.businessMember.findFirstOrThrow({ where: { userId: response.json().user.id } });
    expect(membership.role).toBe("STAFF");
    const business = await prisma.business.findUniqueOrThrow({ where: { id: owner.businessId } });
    expect(business.ownerId).toBe(owner.userId);
    const ownerMembership = await prisma.businessMember.findFirstOrThrow({ where: { userId: owner.userId } });
    expect(ownerMembership.role).toBe("OWNER");
  });

  // -------------------------------------------------------------------
  // Identity and forgery protection
  // -------------------------------------------------------------------

  it("4. email mismatch between the account being created and the invited email is rejected", async () => {
    const owner = await invitingOwner("phase11-owner-4@example.com");
    const invited = await invite(app, owner, "phase11-invitee-4@example.com", "STAFF");

    const response = await register({
      email: "phase11-wrong-email-4@example.com", password: "password123", fullName: "Wrong Email", invitationToken: invited.json().token,
    });
    expect(response.statusCode).toBe(404);
    expect(await prisma.user.count({ where: { normalizedEmail: "phase11-wrong-email-4@example.com" } })).toBe(0);
    // The invitation is untouched — a wrong-email attempt must not consume it.
    expect(await prisma.teamInvitation.findFirstOrThrow({ where: { id: invited.json().id } })).toMatchObject({ status: "PENDING" });
  });

  it("5. client-supplied businessId/role/ownerId are ignored — the server-resolved invitation is authoritative", async () => {
    const owner = await invitingOwner("phase11-owner-5@example.com");
    const decoy = await invitingOwner("phase11-decoy-5@example.com");
    const invited = await invite(app, owner, "phase11-invitee-5@example.com", "STAFF");

    const response = await register({
      email: "phase11-invitee-5@example.com",
      password: "password123",
      fullName: "Forger",
      invitationToken: invited.json().token,
      // Forged fields — none of these exist in registerSchema, so zod
      // strips them before registerUser/registerInvitedUser ever run.
      role: "OWNER",
      businessId: decoy.businessId,
      ownerId: "phase11-invitee-5",
      seatOverride: 999,
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().role).toBe("STAFF");
    expect(response.json().business.id).toBe(owner.businessId);

    const membership = await prisma.businessMember.findFirstOrThrow({ where: { userId: response.json().user.id } });
    expect(membership).toMatchObject({ businessId: owner.businessId, role: "STAFF" });
    expect(await prisma.businessMember.count({ where: { businessId: decoy.businessId } })).toBe(1); // decoy's own owner only
  });

  // -------------------------------------------------------------------
  // Invitation lifecycle: expired / revoked / already consumed
  // -------------------------------------------------------------------

  it("6. an expired invitation is rejected and durably recorded as EXPIRED", async () => {
    const owner = await invitingOwner("phase11-owner-6@example.com");
    const invited = await invite(app, owner, "phase11-invitee-6@example.com", "STAFF");
    await prisma.teamInvitation.update({ where: { id: invited.json().id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const response = await register({
      email: "phase11-invitee-6@example.com", password: "password123", fullName: "Too Late", invitationToken: invited.json().token,
    });
    expect(response.statusCode).toBe(409);
    expect(await prisma.user.count({ where: { normalizedEmail: "phase11-invitee-6@example.com" } })).toBe(0);
    expect(await prisma.teamInvitation.findFirstOrThrow({ where: { id: invited.json().id } })).toMatchObject({ status: "EXPIRED" });
  });

  it("7. a revoked invitation is rejected", async () => {
    const owner = await invitingOwner("phase11-owner-7@example.com");
    const invited = await invite(app, owner, "phase11-invitee-7@example.com", "STAFF");
    const revoke = await app.inject({ method: "DELETE", url: `/team/invitations/${invited.json().id}`, headers: authHeader(owner.token) });
    expect(revoke.statusCode).toBe(200);

    const response = await register({
      email: "phase11-invitee-7@example.com", password: "password123", fullName: "Revoked", invitationToken: invited.json().token,
    });
    expect(response.statusCode).toBe(409);
    expect(await prisma.user.count({ where: { normalizedEmail: "phase11-invitee-7@example.com" } })).toBe(0);
  });

  it("8. an already-consumed invitation cannot be used again", async () => {
    const owner = await invitingOwner("phase11-owner-8@example.com");
    const invited = await invite(app, owner, "phase11-invitee-8@example.com", "STAFF");
    // Simulate the invitation having already been consumed (by any path)
    // without creating a competing User row under this email, so this
    // test isolates "already consumed" from "account already exists".
    await prisma.teamInvitation.update({ where: { id: invited.json().id }, data: { status: "ACCEPTED", acceptedAt: new Date() } });

    const response = await register({
      email: "phase11-invitee-8@example.com", password: "password123", fullName: "Too Slow", invitationToken: invited.json().token,
    });
    expect(response.statusCode).toBe(409);
    expect(await prisma.user.count({ where: { normalizedEmail: "phase11-invitee-8@example.com" } })).toBe(0);
  });

  // -------------------------------------------------------------------
  // Existing-account handling
  // -------------------------------------------------------------------

  it("9. an invitee who already has a Chakusa account cannot re-register over it; their existing business is untouched", async () => {
    const owner = await invitingOwner("phase11-owner-9@example.com");
    // Invited first (while they have no account yet — createInvitation
    // rejects inviting an email that already belongs to a business), then
    // they independently sign up normally before ever using the invite link.
    const invited = await invite(app, owner, "phase11-invitee-9@example.com", "STAFF");
    expect(invited.statusCode).toBe(201);
    const existingAccount = await registerAccount(app, { email: "phase11-invitee-9@example.com" });

    const response = await register({
      email: "phase11-invitee-9@example.com", password: "password123", fullName: "Already Has Account", invitationToken: invited.json().token,
    });
    expect(response.statusCode).toBe(409);

    // Nothing about the invitation or the existing account changed.
    expect(await prisma.teamInvitation.findFirstOrThrow({ where: { id: invited.json().id } })).toMatchObject({ status: "PENDING" });
    const existingMembership = await prisma.businessMember.findFirstOrThrow({ where: { userId: existingAccount.userId } });
    expect(existingMembership).toMatchObject({ businessId: existingAccount.businessId, role: "OWNER" });
  });

  // -------------------------------------------------------------------
  // Concurrency
  // -------------------------------------------------------------------

  it("10. concurrent invited registrations for the final seat are concurrency-safe (exactly one succeeds)", async () => {
    const owner = await invitingOwner("phase11-seat-owner-10@example.com");
    const original = config.BUSINESS_SEAT_LIMIT;
    try {
      config.BUSINESS_SEAT_LIMIT = 3; // owner + 2, enough for both invitations to be created
      const invA = await invite(app, owner, "phase11-seat-a-10@example.com", "STAFF");
      const invB = await invite(app, owner, "phase11-seat-b-10@example.com", "STAFF");
      expect(invA.statusCode).toBe(201);
      expect(invB.statusCode).toBe(201);

      config.BUSINESS_SEAT_LIMIT = 2; // only one seat left beyond the owner by the time both try to register
      const [a, b] = await Promise.all([
        register({ email: "phase11-seat-a-10@example.com", password: "password123", fullName: "Seat A", invitationToken: invA.json().token }),
        register({ email: "phase11-seat-b-10@example.com", password: "password123", fullName: "Seat B", invitationToken: invB.json().token }),
      ]);
      const codes = [a.statusCode, b.statusCode].sort();
      expect(codes).toEqual([201, 403]);
      expect(await prisma.businessMember.count({ where: { businessId: owner.businessId, status: "ACTIVE" } })).toBe(2);
    } finally {
      config.BUSINESS_SEAT_LIMIT = original;
    }
  });

  // -------------------------------------------------------------------
  // Tenant access and onboarding distinction
  // -------------------------------------------------------------------

  it("11. an invited ADMIN can access tenant-scoped endpoints immediately after registering", async () => {
    const owner = await invitingOwner("phase11-owner-11@example.com");
    const invited = await invite(app, owner, "phase11-invitee-11@example.com", "ADMIN");
    const response = await register({
      email: "phase11-invitee-11@example.com", password: "password123", fullName: "Instant Access", invitationToken: invited.json().token,
    });
    const customers = await app.inject({ method: "GET", url: "/customers", headers: authHeader(response.json().accessToken) });
    expect(customers.statusCode).toBe(200);
  });

  it("12. registration response distinguishes OWNER onboarding from invited ADMIN/STAFF onboarding", async () => {
    const normalResponse = await register({
      email: "phase11-onboarding-owner-12@example.com", password: "password123", fullName: "New Owner", businessName: "New Shop",
    });
    expect(normalResponse.json().role).toBe("OWNER");
    expect(normalResponse.json().business).toBeTruthy();

    const owner = await invitingOwner("phase11-owner-12@example.com");
    const invited = await invite(app, owner, "phase11-invitee-12@example.com", "ADMIN");
    const invitedResponse = await register({
      email: "phase11-invitee-12@example.com", password: "password123", fullName: "New Admin", invitationToken: invited.json().token,
    });
    expect(invitedResponse.json().role).toBe("ADMIN");
    expect(invitedResponse.json().business.id).toBe(owner.businessId);
    // A mobile client can use `role` alone to decide: OWNER -> run business
    // onboarding (create a Business via POST /business isn't even needed,
    // since normal registration already created one); ADMIN/STAFF -> skip
    // straight into the existing business's workspace.
    expect(invitedResponse.json().role).not.toBe("OWNER");
  });
});

describe("Business Phase 1.2: seat usage summary and invite delivery outcome", () => {
  let app: FastifyInstance;
  let emailOutcome: "success" | "unavailable" = "success";
  const fakeSender: TeamInvitationEmailSender = async () => emailOutcome === "success";

  beforeAll(async () => {
    app = await createTestApp({ teamInvitationEmailSender: fakeSender });
  });

  afterEach(async () => {
    emailOutcome = "success";
    await resetDatabase();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function summary(token: string) {
    return app.inject({ method: "GET", url: "/team/summary", headers: authHeader(token) });
  }

  // -------------------------------------------------------------------
  // Seats
  // -------------------------------------------------------------------

  it("1. owner counts as an active seat", async () => {
    const owner = await businessOwner(app, "phase12-seat-1@example.com");
    const response = await summary(owner.token);
    expect(response.statusCode).toBe(200);
    expect(response.json().seats).toMatchObject({ activeMembers: 1, pendingReservations: 0, current: 1 });
  });

  it("2. active staff count toward seats", async () => {
    const owner = await businessOwner(app, "phase12-seat-2@example.com");
    const invited = await invite(app, owner, "phase12-staff-2@example.com", "STAFF");
    const session = await freshUserSession(app, "phase12-staff-2@example.com");
    await acceptTeamInvitation(invited.json().token, session.userId);

    const response = await summary(owner.token);
    expect(response.json().seats).toMatchObject({ activeMembers: 2, pendingReservations: 0, current: 2 });
  });

  it("3. a suspended (removed) member does not count as active", async () => {
    const owner = await businessOwner(app, "phase12-seat-3@example.com");
    const invited = await invite(app, owner, "phase12-staff-3@example.com", "STAFF");
    const session = await freshUserSession(app, "phase12-staff-3@example.com");
    await acceptTeamInvitation(invited.json().token, session.userId);
    const member = await prisma.businessMember.findFirstOrThrow({ where: { userId: session.userId } });

    await app.inject({ method: "DELETE", url: `/team/members/${member.id}`, headers: authHeader(owner.token) });
    const response = await summary(owner.token);
    expect(response.json().seats).toMatchObject({ activeMembers: 1, current: 1 });
  });

  it("4. a valid (non-expired) pending invite reserves a seat", async () => {
    const owner = await businessOwner(app, "phase12-seat-4@example.com");
    await invite(app, owner, "phase12-pending-4@example.com", "STAFF");
    const response = await summary(owner.token);
    expect(response.json().seats).toMatchObject({ activeMembers: 1, pendingReservations: 1, current: 2 });
  });

  it("5. an expired pending invite does not reserve a seat", async () => {
    const owner = await businessOwner(app, "phase12-seat-5@example.com");
    const invited = await invite(app, owner, "phase12-expired-5@example.com", "STAFF");
    await prisma.teamInvitation.update({ where: { id: invited.json().id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const response = await summary(owner.token);
    expect(response.json().seats).toMatchObject({ activeMembers: 1, pendingReservations: 0, current: 1 });
  });

  it("6. a revoked invite does not reserve a seat", async () => {
    const owner = await businessOwner(app, "phase12-seat-6@example.com");
    const invited = await invite(app, owner, "phase12-revoked-6@example.com", "STAFF");
    await app.inject({ method: "DELETE", url: `/team/invitations/${invited.json().id}`, headers: authHeader(owner.token) });
    const response = await summary(owner.token);
    expect(response.json().seats).toMatchObject({ pendingReservations: 0, current: 1 });
  });

  it("7. an accepted invite is not double-counted as both pending and member", async () => {
    const owner = await businessOwner(app, "phase12-seat-7@example.com");
    const invited = await invite(app, owner, "phase12-accepted-7@example.com", "STAFF");
    const session = await freshUserSession(app, "phase12-accepted-7@example.com");
    await acceptTeamInvitation(invited.json().token, session.userId);
    const response = await summary(owner.token);
    expect(response.json().seats).toMatchObject({ activeMembers: 2, pendingReservations: 0, current: 2 });
  });

  it("8. current matches the exact usage invitation enforcement itself sees", async () => {
    const owner = await businessOwner(app, "phase12-seat-8@example.com");
    const original = config.BUSINESS_SEAT_LIMIT;
    try {
      config.BUSINESS_SEAT_LIMIT = 2;
      await invite(app, owner, "phase12-boundary-8@example.com", "STAFF"); // fills the last seat (owner + 1 pending = 2)
      const response = await summary(owner.token);
      expect(response.json().seats.current).toBe(2);
      expect(response.json().seats.limit).toBe(2);
      // The same boundary rejects a second invite — proves the summary's
      // `current` is not a separately-drifting number.
      const blocked = await invite(app, owner, "phase12-boundary-8b@example.com", "STAFF");
      expect(blocked.statusCode).toBe(403);
    } finally {
      config.BUSINESS_SEAT_LIMIT = original;
    }
  });

  it("9. remaining is limit minus current", async () => {
    const owner = await businessOwner(app, "phase12-seat-9@example.com");
    await invite(app, owner, "phase12-remaining-9@example.com", "STAFF");
    const response = await summary(owner.token);
    const { current, limit, remaining } = response.json().seats;
    expect(remaining).toBe(limit - current);
  });

  it("10. limit comes from the backend's plan configuration, not the client", async () => {
    const owner = await businessOwner(app, "phase12-seat-10@example.com");
    const original = config.BUSINESS_SEAT_LIMIT;
    try {
      config.BUSINESS_SEAT_LIMIT = 7;
      const response = await summary(owner.token);
      expect(response.json().seats.limit).toBe(7);
    } finally {
      config.BUSINESS_SEAT_LIMIT = original;
    }
  });

  it("11. tenant isolation: one business's seat summary never reflects another's", async () => {
    const a = await businessOwner(app, "phase12-tenant-a-11@example.com");
    const b = await businessOwner(app, "phase12-tenant-b-11@example.com");
    await invite(app, b, "phase12-tenant-b-invite-11@example.com", "STAFF");

    const responseA = await summary(a.token);
    expect(responseA.json().seats).toMatchObject({ activeMembers: 1, pendingReservations: 0, current: 1 });
  });

  it("12. seat summary exposes only seat numbers, no other business data", async () => {
    const owner = await businessOwner(app, "phase12-seat-12@example.com");
    const response = await summary(owner.token);
    expect(Object.keys(response.json())).toEqual(["seats"]);
    expect(Object.keys(response.json().seats).sort()).toEqual(["activeMembers", "current", "limit", "pendingReservations", "remaining"].sort());
  });

  it("13. the concurrency boundary invite enforcement already relies on is unchanged", async () => {
    const owner = await businessOwner(app, "phase12-seat-13@example.com");
    const original = config.BUSINESS_SEAT_LIMIT;
    try {
      config.BUSINESS_SEAT_LIMIT = 2;
      const [a, b] = await Promise.all([
        invite(app, owner, "phase12-concurrent-a-13@example.com", "STAFF"),
        invite(app, owner, "phase12-concurrent-b-13@example.com", "STAFF"),
      ]);
      const codes = [a.statusCode, b.statusCode].sort();
      expect(codes).toEqual([201, 403]);
      const response = await summary(owner.token);
      expect(response.json().seats.current).toBe(2);
    } finally {
      config.BUSINESS_SEAT_LIMIT = original;
    }
  });

  // -------------------------------------------------------------------
  // Invite delivery outcome
  // -------------------------------------------------------------------

  it("14. successful email delivery reports emailSent: true", async () => {
    const owner = await businessOwner(app, "phase12-delivery-14@example.com");
    emailOutcome = "success";
    const response = await invite(app, owner, "phase12-delivered-14@example.com", "STAFF");
    expect(response.statusCode).toBe(201);
    expect(response.json().emailSent).toBe(true);
  });

  it("15. an unconfigured email provider reports emailSent: false (default sender, no fake override)", async () => {
    const plainApp = await createTestApp();
    try {
      const owner = await businessOwner(plainApp, "phase12-delivery-15@example.com");
      // Test env has no RESEND_API_KEY/EMAIL_FROM configured — the real
      // sender's own config gate returns false deterministically.
      const response = await invite(plainApp, owner, "phase12-undelivered-15@example.com", "STAFF");
      expect(response.statusCode).toBe(201);
      expect(response.json().emailSent).toBe(false);
    } finally {
      await plainApp.close();
    }
  });

  it("16. a real provider failure never throws and returns false (no error detail leaked)", async () => {
    const originalKey = config.RESEND_API_KEY;
    const originalFrom = config.EMAIL_FROM;
    const originalFetch = globalThis.fetch;
    try {
      config.RESEND_API_KEY = "test-key";
      config.EMAIL_FROM = "invites@chakusa.example";
      globalThis.fetch = (async () => {
        throw new Error("simulated network outage — must never surface to the client");
      }) as typeof fetch;

      const result = await sendTeamInvitationEmail("someone@example.com", "raw-token-value", "Test Business", "Owner Name");
      expect(result).toBe(false);
    } finally {
      config.RESEND_API_KEY = originalKey;
      config.EMAIL_FROM = originalFrom;
      globalThis.fetch = originalFetch;
    }
  });

  it("17. a failed/unconfigured email delivery still creates a valid, usable invitation", async () => {
    const owner = await businessOwner(app, "phase12-delivery-17@example.com");
    emailOutcome = "unavailable";
    const response = await invite(app, owner, "phase12-still-valid-17@example.com", "STAFF");
    expect(response.statusCode).toBe(201);
    expect(response.json().emailSent).toBe(false);

    const stored = await prisma.teamInvitation.findFirstOrThrow({ where: { id: response.json().id } });
    expect(stored.status).toBe("PENDING");

    const session = await freshUserSession(app, "phase12-still-valid-17@example.com");
    const outcome = await acceptTeamInvitation(response.json().token, session.userId);
    expect(outcome.outcome).toBe("accepted");
  });

  it("18. the raw manual-share token is still returned exactly once regardless of delivery outcome", async () => {
    const owner = await businessOwner(app, "phase12-delivery-18@example.com");
    emailOutcome = "unavailable";
    const response = await invite(app, owner, "phase12-manual-18@example.com", "STAFF");
    expect(response.json().token).toBeTypeOf("string");
    expect(response.json().token.length).toBeGreaterThan(10);
  });

  it("19. the invitation creation response never leaks provider internals", async () => {
    const owner = await businessOwner(app, "phase12-delivery-19@example.com");
    const response = await invite(app, owner, "phase12-no-leak-19@example.com", "STAFF");
    const body = response.json();
    expect(Object.keys(body).sort()).toEqual(["email", "emailSent", "expiresAt", "id", "role", "status", "token"].sort());
    expect(JSON.stringify(body)).not.toMatch(/resend|message[_-]?id|api[_-]?key/i);
  });

  it("20. duplicate-invite behavior is unchanged regardless of delivery outcome", async () => {
    const owner = await businessOwner(app, "phase12-delivery-20@example.com");
    await invite(app, owner, "phase12-dup-20@example.com", "STAFF");
    const second = await invite(app, owner, "phase12-dup-20@example.com", "STAFF");
    expect(second.statusCode).toBe(409);
  });

  it("21. invitation security (email identity matching) is unchanged", async () => {
    const owner = await businessOwner(app, "phase12-delivery-21@example.com");
    const invited = await invite(app, owner, "phase12-secure-21@example.com", "STAFF");
    const wrongSession = await freshUserSession(app, "phase12-wrong-21@example.com");
    const outcome = await acceptTeamInvitation(invited.json().token, wrongSession.userId);
    expect(outcome.outcome).toBe("email-mismatch");
  });

  // -------------------------------------------------------------------
  // Regression
  // -------------------------------------------------------------------

  it("22. the normal Business invite flow still works end to end", async () => {
    const owner = await businessOwner(app, "phase12-regression-22@example.com");
    const invited = await invite(app, owner, "phase12-regression-invitee-22@example.com", "ADMIN");
    expect(invited.statusCode).toBe(201);
    const session = await freshUserSession(app, "phase12-regression-invitee-22@example.com");
    const outcome = await acceptTeamInvitation(invited.json().token, session.userId);
    expect(outcome.outcome).toBe("accepted");
  });

  it("23. invited registration (Business Phase 1.1) still works", async () => {
    const owner = await businessOwner(app, "phase12-regression-23@example.com");
    const invited = await invite(app, owner, "phase12-regression-register-23@example.com", "STAFF");
    const response = await app.inject({
      method: "POST", url: "/auth/register",
      payload: { email: "phase12-regression-register-23@example.com", password: "password123", fullName: "Still Works", invitationToken: invited.json().token },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().role).toBe("STAFF");
    expect(response.json().business.id).toBe(owner.businessId);
  });

  it("24. the subscription/status teamManagement contract is unchanged", async () => {
    const owner = await businessOwner(app, "phase12-regression-24@example.com");
    const response = await app.inject({ method: "GET", url: "/subscription/status", headers: authHeader(owner.token) });
    expect(response.json().features.teamManagement).toBe(true);
  });

  it("25. owner-only team mutations are unchanged", async () => {
    const owner = await businessOwner(app, "phase12-regression-25@example.com");
    const invited = await invite(app, owner, "phase12-regression-staff-25@example.com", "STAFF");
    const session = await freshUserSession(app, "phase12-regression-staff-25@example.com");
    await acceptTeamInvitation(invited.json().token, session.userId);

    const forbidden = await app.inject({
      method: "POST", url: "/team/invitations", headers: authHeader(session.accessToken), payload: { email: "someone@example.com", role: "STAFF" },
    });
    expect(forbidden.statusCode).toBe(403);
  });
});
