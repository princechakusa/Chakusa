import type { AdminRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { config } from "../src/lib/config.js";
import { prisma } from "../src/lib/prisma.js";
import { createTestApp, registerAccount, resetDatabase } from "./helpers.js";
import { communicationsEnabled, resetCommunicationsSwitchCache, sendOutboundMessage } from "../src/lib/messaging/messagingService.js";

describe("admin business operations snapshot", () => {
  let app: FastifyInstance;
  beforeAll(async () => { config.ADMIN_CONSOLE_ENABLED = true; config.ADMIN_CONSOLE_ORIGIN = "http://localhost:5173"; app = await createTestApp(); });
  beforeEach(resetDatabase);
  afterAll(async () => { config.ADMIN_CONSOLE_ENABLED = false; config.ADMIN_CONSOLE_ORIGIN = undefined; await app.close(); });

  async function admin(role: AdminRole) {
    const email = `ops-${role.toLowerCase()}-${Date.now()}@example.com`;
    const account = await registerAccount(app, { email, password: "admin-password-123", businessName: `${role} Console` });
    await prisma.adminMembership.create({ data: { userId: account.userId, role } });
    const res = await app.inject({ method: "POST", url: "/admin/auth/login", headers: { origin: "http://localhost:5173" }, payload: { email, password: "admin-password-123" } });
    return { email, token: res.json().accessToken as string };
  }
  const h = (token: string) => ({ origin: "http://localhost:5173", authorization: `Bearer ${token}` });

  it("returns counts and recent items without customer personal data, and audits the view", async () => {
    const owner = await registerAccount(app, { businessName: "Ops Barbers", email: "ops-owner@example.com" });
    const customer = await prisma.customer.create({ data: { businessId: owner.businessId, name: "Private Person", phone: "+15550001111" } });
    await prisma.lead.create({ data: { businessId: owner.businessId, customerId: customer.id, source: "missed_call", serviceRequested: "Skin fade", notes: "secret note" } });
    await prisma.serviceOffering.create({ data: { businessId: owner.businessId, name: "Skin fade", durationMinutes: 45, price: 25 } });
    const support = await admin("SUPPORT_AGENT");
    const res = await app.inject({ method: "GET", url: `/admin/businesses/${owner.businessId}/operations`, headers: h(support.token) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.leads.byStatus).toMatchObject({ new: 1 });
    expect(body.leads.recent[0]).toMatchObject({ source: "missed_call", serviceRequested: "Skin fade" });
    expect(body.services[0]).toMatchObject({ name: "Skin fade", price: 25 });
    const text = res.body;
    expect(text).not.toContain("Private Person");
    expect(text).not.toContain("+15550001111");
    expect(text).not.toContain("secret note");
    expect(await prisma.adminAuditLog.findFirst({ where: { action: "SUPPORT_OPERATIONS_VIEWED", targetId: owner.businessId } })).toMatchObject({ adminEmail: support.email });
  });

  it("is denied without the support read permission and 404s for unknown businesses", async () => {
    const finance = await admin("FINANCE");
    const owner = await registerAccount(app, { businessName: "Other Co", email: "ops-other@example.com" });
    const denied = await app.inject({ method: "GET", url: `/admin/businesses/${owner.businessId}/operations`, headers: h(finance.token) });
    expect(denied.statusCode).toBe(403);
    const support = await admin("SUPPORT_AGENT");
    const missing = await app.inject({ method: "GET", url: "/admin/businesses/00000000-0000-4000-8000-000000000000/operations", headers: h(support.token) });
    expect(missing.statusCode).toBe(404);
  });

  it("closes the support views when support_read_only_impersonation is switched off", async () => {
    const owner = await registerAccount(app, { businessName: "Gate Co", email: "ops-gate@example.com" });
    await prisma.platformSetting.create({ data: { key: "support_read_only_impersonation", value: false } });
    const support = await admin("SUPPORT_AGENT");
    for (const url of [`/admin/businesses/${owner.businessId}/operations`, `/admin/support/businesses/${owner.businessId}/context`]) {
      expect((await app.inject({ method: "GET", url, headers: h(support.token) })).statusCode).toBe(403);
    }
    expect(await prisma.adminAuditLog.count({ where: { action: { in: ["SUPPORT_OPERATIONS_VIEWED", "SUPPORT_READ_ONLY_CONTEXT_VIEWED"] } } })).toBe(0);
  });

  it("stops every outbound message while communications_enabled is off", async () => {
    let calls = 0;
    const provider = { send: async () => { calls += 1; return { accepted: true, providerMessageId: "x", permanentFailure: false }; } } as never;
    const message = { to: "+15550002222", channel: "sms", body: "hi", countryCode: "US", idempotencyKey: "k1" } as never;
    resetCommunicationsSwitchCache();
    expect(await communicationsEnabled()).toBe(true);
    expect((await sendOutboundMessage(message, provider)).accepted).toBe(true);
    await prisma.platformSetting.create({ data: { key: "communications_enabled", value: false } });
    resetCommunicationsSwitchCache();
    const blocked = await sendOutboundMessage(message, provider);
    expect(blocked).toEqual({ accepted: false, errorCode: "COMMUNICATIONS_DISABLED", permanentFailure: false });
    expect(calls).toBe(1);
    resetCommunicationsSwitchCache();
  });
});
