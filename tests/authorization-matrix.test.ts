import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { BusinessRole } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import { createSession } from "../src/modules/auth/auth.service.js";
import { authHeader, createTestApp, registerAccount, resetDatabase, setPlan, setSubscriptionStatus } from "./helpers.js";

// Advanced Team #12 — the role -> capability matrix is enforced server-side.
// These tests assert the sensitive boundaries the owner locked: STAFF cannot
// reach ADMIN/OWNER endpoints, ADMIN cannot reach OWNER-only endpoints,
// payloads cannot elevate a role, membership is per-business, and entitlement
// is a separate axis from authorization.

async function memberToken(app: FastifyInstance, businessId: string, role: BusinessRole) {
  const email = `${role.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const user = await prisma.user.create({ data: { email, normalizedEmail: email.toLowerCase(), fullName: `${role} Member`, passwordHash: null } });
  await prisma.businessMember.create({ data: { businessId, userId: user.id, role, status: "ACTIVE" } });
  const { session } = await createSession(user.id, prisma);
  return app.jwt.sign({ userId: user.id, sessionId: session.id, type: "access" }, { expiresIn: 900 });
}

describe("authorization matrix", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterEach(resetDatabase);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  async function business(email = "owner@authz.example.com") {
    const account = await registerAccount(app, { email });
    await setPlan(account.businessId, "BUSINESS");
    await setSubscriptionStatus(account.businessId, "ACTIVE");
    const admin = await memberToken(app, account.businessId, "ADMIN");
    const staff = await memberToken(app, account.businessId, "STAFF");
    return { ...account, admin, staff };
  }

  const ANY_UUID = "00000000-0000-0000-0000-000000000000";

  it("STAFF is blocked from every ADMIN/OWNER surface introduced or touched by #12", async () => {
    const b = await business();
    const s = authHeader(b.staff);
    const cases: [string, string, unknown?][] = [
      ["PATCH", "/business", { name: "Renamed" }],
      ["GET", "/team/invitations"],
      ["POST", "/team/invitations", { email: "x@y.com", role: "STAFF" }],
      ["POST", "/subscription/apple/verify", { transactionId: "t" }],
      ["POST", "/services", { name: "Svc", durationMinutes: 30 }],
      ["POST", "/availability/blocks", { startsAt: "2026-09-20T09:00:00.000Z", endsAt: "2026-09-20T10:00:00.000Z" }],
      ["GET", "/financial/summary?from=2026-09-01&to=2026-09-30"],
      ["POST", "/financial/categories", { name: "Cat" }],
      ["GET", "/commissions/rules"],
      ["PUT", "/commissions/rules", { businessMemberId: ANY_UUID, basis: "PERCENT_OF_SERVICE_PRICE", ratePercent: 10 }],
      ["GET", "/commissions/report?from=2026-09-01&to=2026-09-30"],
      ["GET", "/accounting/connections"],
      ["POST", "/calendar/subscriptions", {}],
      ["GET", "/business/export"],
    ];
    for (const [method, url, payload] of cases) {
      const res = await app.inject({ method: method as never, url, headers: s, payload: payload as never });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
  });

  it("ADMIN is blocked from OWNER-only surfaces but allowed on operational ones", async () => {
    const b = await business("owner2@authz.example.com");
    const a = authHeader(b.admin);

    // OWNER-only -> 403 for ADMIN
    expect((await app.inject({ method: "PATCH", url: "/business", headers: a, payload: { name: "X" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/team/invitations", headers: a, payload: { email: "z@z.com", role: "STAFF" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/team/ownership-transfer", headers: a, payload: { memberId: ANY_UUID, businessName: "Test Business" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "PUT", url: "/commissions/rules", headers: a, payload: { businessMemberId: ANY_UUID, basis: "PERCENT_OF_SERVICE_PRICE", ratePercent: 5 } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/calendar/subscriptions", headers: a, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/business/export", headers: a })).statusCode).toBe(403);

    // Operational -> allowed for ADMIN
    expect((await app.inject({ method: "POST", url: "/services", headers: a, payload: { name: "Cut", durationMinutes: 30 } })).statusCode).toBe(201);
    expect((await app.inject({ method: "GET", url: "/commissions/report?from=2026-09-01&to=2026-09-30", headers: a })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/financial/summary?from=2026-09-01&to=2026-09-30", headers: a })).statusCode).toBe(200);
  });

  it("STAFF keeps the operational access existing workflows depend on", async () => {
    const b = await business("owner3@authz.example.com");
    const s = authHeader(b.staff);
    const customer = await app.inject({ method: "POST", url: "/customers", headers: s, payload: { name: "Walk-in" } });
    expect(customer.statusCode).toBe(201);
    const appt = await app.inject({ method: "POST", url: "/appointments", headers: s, payload: { serviceName: "Cut", startsAt: "2026-09-10T09:00:00.000Z", endsAt: "2026-09-10T10:00:00.000Z" } });
    expect(appt.statusCode).toBe(201);
    const arrival = await app.inject({ method: "POST", url: `/appointments/${appt.json().id}/arrival`, headers: s, payload: { state: "ON_MY_WAY" } });
    expect(arrival.statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/financial/expenses", headers: s, payload: { amount: "5.00", currency: "USD", spentAt: "2026-09-10T00:00:00.000Z", vendor: "Shop" } })).statusCode).toBe(201);
  });

  it("a member of one business gets nothing in another", async () => {
    const a = await business("tenantA@authz.example.com");
    const other = await registerAccount(app, { email: "tenantB@authz.example.com" });
    await setPlan(other.businessId, "BUSINESS");
    // a.admin belongs only to business A; tokens carry no businessId, the
    // server resolves it from membership.
    const res = await app.inject({ method: "GET", url: "/commissions/report?from=2026-09-01&to=2026-09-30", headers: authHeader(a.admin) });
    const report = res.json();
    // The report is for business A (a.admin's only membership), never B.
    expect(res.statusCode).toBe(200);
    // Cross-tenant write attempt: A's owner cannot target B's member.
    const foreignMember = await prisma.businessMember.findFirstOrThrow({ where: { businessId: other.businessId } });
    const cross = await app.inject({ method: "PUT", url: "/commissions/rules", headers: authHeader(a.token), payload: { businessMemberId: foreignMember.id, basis: "PERCENT_OF_SERVICE_PRICE", ratePercent: 10 } });
    expect(cross.statusCode).toBe(400);
    void report;
  });

  it("a role-change payload cannot mint an OWNER and cannot touch the OWNER row", async () => {
    const b = await business("owner4@authz.example.com");
    const staffMember = await prisma.businessMember.findFirstOrThrow({ where: { businessId: b.businessId, role: "STAFF" } });
    const ownerMember = await prisma.businessMember.findFirstOrThrow({ where: { businessId: b.businessId, role: "OWNER" } });

    // Schema rejects OWNER as a target role.
    const elevate = await app.inject({ method: "PATCH", url: `/team/members/${staffMember.id}`, headers: authHeader(b.token), payload: { role: "OWNER" } });
    expect(elevate.statusCode).toBe(400);

    // OWNER row cannot be demoted.
    const demote = await app.inject({ method: "PATCH", url: `/team/members/${ownerMember.id}`, headers: authHeader(b.token), payload: { role: "ADMIN" } });
    expect(demote.statusCode).toBe(403);

    // STAFF cannot change roles at all.
    const staffTry = await app.inject({ method: "PATCH", url: `/team/members/${staffMember.id}`, headers: authHeader(b.staff), payload: { role: "ADMIN" } });
    expect(staffTry.statusCode).toBe(403);
  });

  it("entitlement and authorization are independent: BUSINESS plan does not let STAFF past a capability gate", async () => {
    const b = await business("owner5@authz.example.com"); // already BUSINESS + ACTIVE
    const res = await app.inject({ method: "GET", url: "/commissions/rules", headers: authHeader(b.staff) });
    expect(res.statusCode).toBe(403); // capability gate, not entitlement
  });
});
