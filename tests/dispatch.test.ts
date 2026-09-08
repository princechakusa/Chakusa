import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import { authHeader, createTestApp, registerAccount, resetDatabase, setPlan } from "./helpers.js";

const DAY = "2026-09-15"; // a Tuesday, inside default working hours

async function addMember(businessId: string, email: string, fullName: string) {
  const user = await prisma.user.create({ data: { email, normalizedEmail: email.toLowerCase(), fullName, passwordHash: null } });
  return prisma.businessMember.create({ data: { businessId, userId: user.id, role: "STAFF", status: "ACTIVE" } });
}

describe("dispatch", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterEach(resetDatabase);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  async function fixture(email = "dispatch@example.com") {
    const account = await registerAccount(app, { email });
    await setPlan(account.businessId, "BUSINESS"); // team management entitlement
    const owner = await prisma.businessMember.findFirstOrThrow({ where: { businessId: account.businessId, userId: account.userId } });
    const customer = await prisma.customer.create({ data: { businessId: account.businessId, name: "Pat Customer" } });
    return { ...account, owner, customer };
  }

  const book = (token: string, body: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/appointments", headers: authHeader(token), payload: body });

  it("returns a per-member day board with unassigned work separated out", async () => {
    const account = await fixture();
    const staff = await addMember(account.businessId, "dispatch-staff@example.com", "Sam Staff");

    await book(account.token, { customerId: account.customer.id, assignedMemberId: account.owner.id, serviceName: "Cut", startsAt: `${DAY}T09:00:00.000Z`, endsAt: `${DAY}T10:00:00.000Z` });
    await book(account.token, { serviceName: "Walk-in", startsAt: `${DAY}T11:00:00.000Z`, endsAt: `${DAY}T11:30:00.000Z` });

    const res = await app.inject({ method: "GET", url: `/dispatch?date=${DAY}`, headers: authHeader(account.token) });
    expect(res.statusCode).toBe(200);
    const board = res.json();
    expect(board.date).toBe(DAY);
    expect(board.members).toHaveLength(2);
    const ownerRow = board.members.find((m: { id: string }) => m.id === account.owner.id);
    expect(ownerRow.appointments).toHaveLength(1);
    expect(ownerRow.bookedMinutes).toBe(60);
    const staffRow = board.members.find((m: { id: string }) => m.id === staff.id);
    expect(staffRow.appointments).toHaveLength(0);
    expect(board.unassigned).toHaveLength(1);
    expect(board.unassigned[0].serviceName).toBe("Walk-in");
  });

  it("assigns an unassigned appointment to a member", async () => {
    const account = await fixture("dispatch-assign@example.com");
    const staff = await addMember(account.businessId, "dispatch-assign-staff@example.com", "Sam Staff");
    const created = await book(account.token, { serviceName: "Walk-in", startsAt: `${DAY}T11:00:00.000Z`, endsAt: `${DAY}T11:30:00.000Z` });

    const res = await app.inject({ method: "POST", url: "/dispatch/assign", headers: authHeader(account.token), payload: { appointmentId: created.json().id, memberId: staff.id } });
    expect(res.statusCode).toBe(200);
    expect(res.json().assignedMemberId).toBe(staff.id);

    const board = (await app.inject({ method: "GET", url: `/dispatch?date=${DAY}`, headers: authHeader(account.token) })).json();
    expect(board.unassigned).toHaveLength(0);
    expect(board.members.find((m: { id: string }) => m.id === staff.id).appointments).toHaveLength(1);
  });

  it("rejects an assignment that would overlap the member's existing booking", async () => {
    const account = await fixture("dispatch-conflict@example.com");
    const staff = await addMember(account.businessId, "dispatch-conflict-staff@example.com", "Sam Staff");
    await book(account.token, { assignedMemberId: staff.id, serviceName: "First", startsAt: `${DAY}T09:00:00.000Z`, endsAt: `${DAY}T10:00:00.000Z` });
    const clash = await book(account.token, { serviceName: "Second", startsAt: `${DAY}T09:30:00.000Z`, endsAt: `${DAY}T10:30:00.000Z` });

    const res = await app.inject({ method: "POST", url: "/dispatch/assign", headers: authHeader(account.token), payload: { appointmentId: clash.json().id, memberId: staff.id } });
    expect(res.statusCode).toBe(409);
  });

  it("lists candidates and marks the one with a clash unavailable", async () => {
    const account = await fixture("dispatch-candidates@example.com");
    const free = await addMember(account.businessId, "dispatch-free@example.com", "Free Person");
    const busy = await addMember(account.businessId, "dispatch-busy@example.com", "Busy Person");
    await book(account.token, { assignedMemberId: busy.id, serviceName: "Busy", startsAt: `${DAY}T09:00:00.000Z`, endsAt: `${DAY}T10:00:00.000Z` });
    const target = await book(account.token, { serviceName: "Needs owner", startsAt: `${DAY}T09:30:00.000Z`, endsAt: `${DAY}T10:15:00.000Z` });

    const res = await app.inject({ method: "GET", url: `/dispatch/candidates?appointmentId=${target.json().id}`, headers: authHeader(account.token) });
    expect(res.statusCode).toBe(200);
    const byId = Object.fromEntries(res.json().map((c: { id: string }) => [c.id, c]));
    expect(byId[free.id].available).toBe(true);
    expect(byId[busy.id].available).toBe(false);
    expect(byId[busy.id].hasConflict).toBe(true);
  });

  it("is tenant scoped", async () => {
    const owner = await fixture("dispatch-owner@example.com");
    const outsider = await registerAccount(app, { email: "dispatch-outsider@example.com" });
    const appt = await book(owner.token, { serviceName: "Private", startsAt: `${DAY}T09:00:00.000Z`, endsAt: `${DAY}T10:00:00.000Z` });

    expect((await app.inject({ method: "GET", url: `/dispatch/candidates?appointmentId=${appt.json().id}`, headers: authHeader(outsider.token) })).statusCode).toBe(404);
    const foreignMember = await prisma.businessMember.findFirstOrThrow({ where: { businessId: outsider.businessId } });
    expect((await app.inject({ method: "POST", url: "/dispatch/assign", headers: authHeader(outsider.token), payload: { appointmentId: appt.json().id, memberId: foreignMember.id } })).statusCode).toBe(404);
  });
});
