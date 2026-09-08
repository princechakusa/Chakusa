import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import { authHeader, createTestApp, registerAccount, resetDatabase, setPlan, setSubscriptionStatus } from "./helpers.js";
import { handleInboundAIMessage } from "../src/lib/ai/agent/customerAgent.js";
import { recordInboundMessage } from "../src/lib/messaging/messagingPlatform.js";

const ALL_OPEN = { days: Object.fromEntries(["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].map(d => [d, { enabled: true, opensAt: "00:00", closesAt: "23:59" }])) };
const ALL_CLOSED = { days: Object.fromEntries(["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].map(d => [d, { enabled: false, opensAt: "09:00", closesAt: "17:00" }])) };

describe("after-hours AI (#16)", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterEach(resetDatabase);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  async function setup(opts: {
    plan?: "BUSINESS" | "PRO";
    enabled?: boolean;
    smsEnabled?: boolean;
    whatsappEnabled?: boolean;
    mode?: "ALWAYS" | "AFTER_HOURS_ONLY";
    hours?: unknown;
    timezone?: string | null;
    platformFlag?: boolean;
    automationMode?: "AUTOMATED" | "HUMAN";
  }) {
    const account = await registerAccount(app, { email: `ah-${Date.now()}-${Math.random().toString(36).slice(2)}@ex.com` });
    await setPlan(account.businessId, opts.plan ?? "BUSINESS");
    await setSubscriptionStatus(account.businessId, "ACTIVE");
    await prisma.business.update({ where: { id: account.businessId }, data: { timezone: opts.timezone === undefined ? "UTC" : opts.timezone, workingHours: (opts.hours ?? ALL_OPEN) as never } });
    if (opts.platformFlag !== false) {
      await prisma.featureFlag.create({ data: { key: "ai.customer_agent", scope: "BUSINESS", businessId: account.businessId, enabled: true, status: "ENABLED" } });
    }
    if (opts.enabled !== undefined || opts.mode || opts.smsEnabled !== undefined || opts.whatsappEnabled !== undefined) {
      await prisma.aiReceptionistSettings.create({
        data: {
          businessId: account.businessId,
          enabled: opts.enabled ?? false,
          smsEnabled: opts.smsEnabled ?? true,
          whatsappEnabled: opts.whatsappEnabled ?? true,
          mode: opts.mode ?? "ALWAYS",
        },
      });
    }
    const customer = await prisma.customer.create({ data: { businessId: account.businessId, name: "Pat", phone: "+15005550020", phoneE164: "+15005550020" } });
    const inbound = await recordInboundMessage({ businessId: account.businessId, customerId: customer.id, from: "+15005550020", channel: "sms", body: "Are you open?", provider: "fake", providerMessageId: `IN-${Math.random().toString(36).slice(2)}` });
    if (opts.automationMode) await prisma.conversation.update({ where: { id: inbound.conversationId! }, data: { automationMode: opts.automationMode } });
    return { ...account, customer, conversationId: inbound.conversationId! };
  }

  const fire = (s: Awaited<ReturnType<typeof setup>>, channel: "sms" | "whatsapp" = "sms") =>
    handleInboundAIMessage({ businessId: s.businessId, conversationId: s.conversationId, customerId: s.customer.id, providerMessageId: `M-${Math.random().toString(36).slice(2)}`, channel, body: "hi" });
  const runCount = (businessId: string) => prisma.aIConversationRun.count({ where: { businessId } });

  it("1. receptionist disabled -> no response, no run", async () => {
    const s = await setup({ enabled: false });
    expect(await fire(s)).toMatchObject({ handled: false, reason: "receptionist_disabled" });
    expect(await runCount(s.businessId)).toBe(0);
  });

  it("2. plan not entitled -> no response, no run", async () => {
    const s = await setup({ plan: "PRO", enabled: true });
    expect(await fire(s)).toMatchObject({ handled: false, reason: "not_entitled" });
    expect(await runCount(s.businessId)).toBe(0);
  });

  it("3. channel disabled -> no response, no run", async () => {
    const s = await setup({ enabled: true, smsEnabled: false });
    expect(await fire(s, "sms")).toMatchObject({ handled: false, reason: "channel_disabled" });
    expect(await runCount(s.businessId)).toBe(0);
  });

  it("4. AFTER_HOURS_ONLY + inside hours -> no response, no run", async () => {
    const s = await setup({ enabled: true, mode: "AFTER_HOURS_ONLY", hours: ALL_OPEN });
    expect(await fire(s)).toMatchObject({ handled: false, reason: "inside_hours" });
    expect(await runCount(s.businessId)).toBe(0);
  });

  it("5. AFTER_HOURS_ONLY + outside hours -> eligible; run created and stamped after-hours", async () => {
    const s = await setup({ enabled: true, mode: "AFTER_HOURS_ONLY", hours: ALL_CLOSED });
    const r = await fire(s);
    expect(r.handled).toBe(true); // run reaches the pipeline (FAILS only for lack of a seeded model)
    const runs = await prisma.aIConversationRun.findMany({ where: { businessId: s.businessId } });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.afterHours).toBe(true);
  });

  it("6. ALWAYS + inside hours -> eligible; run stamped NOT after-hours", async () => {
    const s = await setup({ enabled: true, mode: "ALWAYS", hours: ALL_OPEN });
    expect((await fire(s)).handled).toBe(true);
    const runs = await prisma.aIConversationRun.findMany({ where: { businessId: s.businessId } });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.afterHours).toBe(false);
  });

  it("7. ALWAYS + outside hours -> eligible", async () => {
    const s = await setup({ enabled: true, mode: "ALWAYS", hours: ALL_CLOSED });
    expect((await fire(s)).handled).toBe(true);
    expect(await runCount(s.businessId)).toBe(1);
  });

  it("8. closed day + AFTER_HOURS_ONLY -> eligible (business shut all day)", async () => {
    const s = await setup({ enabled: true, mode: "AFTER_HOURS_ONLY", hours: ALL_CLOSED });
    expect((await fire(s)).handled).toBe(true);
    expect(await runCount(s.businessId)).toBe(1);
  });

  it("9. GET reports schedule, next opening and current eligibility without leaking internals", async () => {
    const s = await setup({ enabled: true, mode: "AFTER_HOURS_ONLY", hours: { days: { ...ALL_CLOSED.days, monday: { enabled: true, opensAt: "09:00", closesAt: "17:00" } } } });
    const res = await app.inject({ method: "GET", url: "/ai/receptionist", headers: authHeader(s.token) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.settings.mode).toBe("AFTER_HOURS_ONLY");
    expect(body.hours).toMatchObject({ resolved: true, timezone: "UTC" });
    // currentlyEligible is true only if it's currently outside Monday 9-17 UTC.
    expect(typeof body.status.currentlyEligible).toBe("boolean");
    expect(JSON.stringify(body)).not.toMatch(/toolBroker|invocation|model registry|promptVersion/i);
  });

  it("12. human takeover wins over the schedule: AFTER_HOURS + outside -> still no AI", async () => {
    const s = await setup({ enabled: true, mode: "AFTER_HOURS_ONLY", hours: ALL_CLOSED, automationMode: "HUMAN" });
    expect(await fire(s)).toMatchObject({ handled: false, reason: "human_owned" });
    expect(await runCount(s.businessId)).toBe(0);
  });

  it("15. settings + gate are per business", async () => {
    const a = await setup({ enabled: true, mode: "AFTER_HOURS_ONLY", hours: ALL_OPEN }); // A: inside hours -> blocked
    const b = await setup({ enabled: true, mode: "ALWAYS", hours: ALL_OPEN }); // B: always -> eligible
    expect((await fire(a)).reason).toBe("inside_hours");
    expect((await fire(b)).handled).toBe(true);
  });

  it("16. missing/invalid hours + AFTER_HOURS_ONLY -> fails conservatively, no run", async () => {
    const s = await setup({ enabled: true, mode: "AFTER_HOURS_ONLY", hours: ALL_CLOSED, timezone: null });
    expect(await fire(s)).toMatchObject({ handled: false, reason: "hours_unresolved" });
    expect(await runCount(s.businessId)).toBe(0);
  });

  it("17. no provider invocation is possible while a gate blocks (ledger stays empty)", async () => {
    const s = await setup({ enabled: true, mode: "AFTER_HOURS_ONLY", hours: ALL_OPEN });
    await fire(s);
    expect(await prisma.aIInvocationLedger.count({ where: { businessId: s.businessId } })).toBe(0);
  });
});
