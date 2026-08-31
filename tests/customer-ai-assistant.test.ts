import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { config } from "../src/lib/config.js";
import { prisma } from "../src/lib/prisma.js";
import { createTestApp, registerAccount, resetDatabase } from "./helpers.js";
import { registerAIProvider, clearAIProviders, type AIProvider } from "../src/lib/ai/aiGateway.js";
import { registerBuiltInAIProviders } from "../src/lib/ai/registerProviders.js";
import { resetCircuitBreakers } from "../src/lib/ai/ops/circuitBreaker.js";
import { savePolicyDraft, activatePolicy } from "../src/lib/ai/policyAdmin.js";
import { resetCustomerAssistantPromptCache } from "../src/lib/ai/customerAssistant/customerAssistant.js";

const SCRIPTED = "scripted-assistant";
const openEveryDay = { version: 1, days: Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => [d, { enabled: true, opensAt: "00:00", closesAt: "23:59" }])) };
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

const script: { slug?: string; serviceOfferingId?: string; startsAt?: string; bookingId?: string } = {};

function scriptedProvider(): AIProvider {
  return {
    id: SCRIPTED,
    async invoke({ prompt }) {
      const usage = { inputTokens: 12, outputTokens: 6 };
      if (prompt.includes("Tool results so far")) {
        if (prompt.includes('"tool":"create_booking"') && prompt.includes('"ok":true')) return { output: "You're booked in.", toolRequests: [], usage };
        if (prompt.includes('"denied":true')) return { output: "I wasn't allowed to do that.", toolRequests: [], usage };
        return { output: "Here's what I found.", toolRequests: [], usage };
      }
      // Match on the customer's message only, not the orchestrator instructions.
      const text = (prompt.split("Customer message:").pop() ?? prompt).toLowerCase();
      if (text.includes("book") && text.includes("haircut")) {
        return { output: "", toolRequests: [{ name: "create_booking", arguments: { slug: script.slug, serviceOfferingId: script.serviceOfferingId, startsAt: script.startsAt } }], usage };
      }
      if (text.includes("cancel")) return { output: "", toolRequests: [{ name: "cancel_booking", arguments: { bookingId: script.bookingId } }], usage };
      if (text.includes("next")) return { output: "", toolRequests: [{ name: "next_booking", arguments: {} }], usage };
      if (text.includes("favourite")) return { output: "", toolRequests: [{ name: "favourite_businesses", arguments: {} }], usage };
      if (text.includes("recommend")) return { output: "", toolRequests: [{ name: "recommendations", arguments: {} }], usage };
      if (text.includes("nearby") || text.includes("barber")) return { output: "", toolRequests: [{ name: "search_businesses", arguments: { q: "barber", mode: "browse" } }], usage };
      return { output: "How can I help with your bookings?", toolRequests: [], usage };
    },
  };
}

async function registerCustomer(app: FastifyInstance, over: Partial<{ email: string; fullName: string }> = {}) {
  const email = over.email ?? `cust-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const res = await app.inject({ method: "POST", url: "/customer/auth/register", payload: { email, password: "password123", fullName: over.fullName ?? "Casey Customer" } });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.body}`);
  const body = res.json();
  return { email, token: body.accessToken as string, profileId: body.profile.id as string, userId: body.user.id as string };
}

function futureSlot(days = 7, hourUtc = 10): string {
  const d = new Date(Date.now() + days * 86_400_000);
  d.setUTCHours(hourUtc, 0, 0, 0);
  return d.toISOString();
}

async function bookableBusiness(app: FastifyInstance, name: string) {
  const account = await registerAccount(app, { businessName: name });
  const business = await prisma.business.update({
    where: { id: account.businessId },
    data: { timezone: "UTC", workingHours: openEveryDay, bookingMinNoticeMinutes: 0, bookingWindowDays: 365, cancellationNoticeMinutes: 0, industry: "barbershop", verifiedAt: new Date() },
    select: { id: true, publicSlug: true },
  });
  const member = await prisma.businessMember.findFirstOrThrow({ where: { businessId: business.id } });
  const service = await prisma.serviceOffering.create({ data: { businessId: business.id, name: "Haircut", durationMinutes: 60, price: 30, active: true, publiclyBookable: true } });
  await prisma.aIModelRegistry.create({ data: { provider: SCRIPTED, model: "s1", version: "1", capabilities: ["conversation"], approvedUseCases: ["conversation"], status: "ACTIVE", healthStatus: "HEALTHY" } }).catch(() => undefined);
  await savePolicyDraft({ businessId: business.id, mode: "AUTONOMOUS", document: { confidence: { respondMin: 0, autonomousMin: 0, escalateBelow: 0 } } });
  await activatePolicy({ businessId: business.id });
  return { ...account, slug: business.publicSlug as string, businessId: business.id, memberId: member.id, serviceId: service.id };
}

/** Links the customer to the business so resolveAnchorBusiness has an anchor. */
async function favourite(app: FastifyInstance, token: string, businessId: string) {
  const res = await app.inject({ method: "PATCH", url: `/customer/businesses/${businessId}/favourite`, headers: auth(token), payload: { favourite: true } });
  if (res.statusCode !== 200) throw new Error(`favourite failed: ${res.body}`);
}

async function newConversation(app: FastifyInstance, token: string, businessSlug?: string) {
  const res = await app.inject({ method: "POST", url: "/customer/ai/assistant/conversations", headers: auth(token), payload: businessSlug ? { businessSlug } : {} });
  return res.json().id as string;
}
async function say(app: FastifyInstance, token: string, conversationId: string, content: string) {
  return app.inject({ method: "POST", url: `/customer/ai/assistant/conversations/${conversationId}/messages`, headers: auth(token), payload: { content } });
}

describe("Customer AI Assistant Platform (Program 2, Loop 4)", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    config.ADMIN_CONSOLE_ENABLED = true;
    app = await createTestApp();
  });
  beforeEach(() => {
    clearAIProviders();
    registerBuiltInAIProviders();
    registerAIProvider(scriptedProvider());
  });
  afterEach(async () => {
    await resetDatabase();
    resetCircuitBreakers();
    resetCustomerAssistantPromptCache();
  });
  afterAll(async () => {
    config.ADMIN_CONSOLE_ENABLED = false;
    await app.close();
    await prisma.$disconnect();
  });

  describe("conversation lifecycle", () => {
    it("creates, titles, lists, pins, archives, searches and deletes a conversation", async () => {
      const biz = await bookableBusiness(app, "Thread Barbers");
      const customer = await registerCustomer(app);
      await favourite(app, customer.token, biz.businessId);

      const id = await newConversation(app, customer.token);
      const turn = await say(app, customer.token, id, "What are the opening hours?");
      expect(turn.statusCode).toBe(201);
      expect(turn.json().assistantMessage.content).toBeTruthy();

      const list = await app.inject({ method: "GET", url: "/customer/ai/assistant/conversations", headers: auth(customer.token) }).then((r) => r.json());
      expect(list.items).toHaveLength(1);
      expect(list.items[0].title).toContain("opening hours");
      expect(list.items[0].messageCount).toBe(2);

      await app.inject({ method: "PATCH", url: `/customer/ai/assistant/conversations/${id}`, headers: auth(customer.token), payload: { pinned: true } });
      const search = await app.inject({ method: "GET", url: "/customer/ai/assistant/conversations?q=opening", headers: auth(customer.token) }).then((r) => r.json());
      expect(search.items[0].id).toBe(id);
      expect(search.items[0].pinned).toBe(true);

      await app.inject({ method: "PATCH", url: `/customer/ai/assistant/conversations/${id}`, headers: auth(customer.token), payload: { archived: true } });
      const active = await app.inject({ method: "GET", url: "/customer/ai/assistant/conversations?archived=false", headers: auth(customer.token) }).then((r) => r.json());
      expect(active.items).toHaveLength(0);

      const del = await app.inject({ method: "DELETE", url: `/customer/ai/assistant/conversations/${id}`, headers: auth(customer.token) });
      expect(del.json().deleted).toBe(true);
      const afterDelete = await app.inject({ method: "GET", url: `/customer/ai/assistant/conversations/${id}`, headers: auth(customer.token) });
      expect(afterDelete.statusCode).toBe(404);
    });

    it("requires a customer session", async () => {
      const res = await app.inject({ method: "GET", url: "/customer/ai/assistant/conversations" });
      expect([401, 403]).toContain(res.statusCode);
    });
  });

  describe("tool execution through the existing Tool Broker", () => {
    it("books an appointment via the create_booking tool and records an invocation ledger row + policy decision", async () => {
      const biz = await bookableBusiness(app, "Tool Barbers");
      const customer = await registerCustomer(app);
      await favourite(app, customer.token, biz.businessId);
      script.slug = biz.slug;
      script.serviceOfferingId = biz.serviceId;
      script.startsAt = futureSlot(8, 9);

      const id = await newConversation(app, customer.token, biz.slug);
      const turn = await say(app, customer.token, id, "Please book me a haircut");
      expect(turn.statusCode).toBe(201);
      const body = turn.json();
      expect(body.toolResults.some((t: { tool: string; ok: boolean }) => t.tool === "create_booking" && t.ok)).toBe(true);
      expect(body.assistantMessage.content).toContain("booked");

      const appt = await prisma.appointment.findFirstOrThrow({ where: { bookedByCustomerProfileId: customer.profileId } });
      expect(appt.bookingChannel).toBe("customer_app");

      const run = await prisma.aIConversationRun.findFirstOrThrow({ where: { idempotencyKey: { startsWith: "customer-assistant:" } } });
      const toolLedger = await prisma.aIInvocationLedger.findFirst({ where: { correlationId: { contains: run.id }, model: "create_booking", outcome: "TOOL_COMPLETED" } });
      expect(toolLedger).not.toBeNull();
      const policy = await prisma.aIPolicyDecision.findFirst({ where: { runId: run.id, checkpoint: "CUSTOMER_RESPONSE" } });
      expect(policy).not.toBeNull();
    });

    it("a tool only ever sees the calling customer's data (booking history)", async () => {
      const biz = await bookableBusiness(app, "Isolation Barbers");
      const alice = await registerCustomer(app, { fullName: "Alice" });
      const bob = await registerCustomer(app, { fullName: "Bob" });
      await favourite(app, alice.token, biz.businessId);
      await favourite(app, bob.token, biz.businessId);
      // Alice books directly through the Booking Platform.
      await app.inject({ method: "POST", url: "/customer/bookings", headers: auth(alice.token), payload: { slug: biz.slug, serviceOfferingId: biz.serviceId, startsAt: futureSlot(9, 11) } });

      const bobConv = await newConversation(app, bob.token, biz.slug);
      const turn = await say(app, bob.token, bobConv, "when is my next appointment?");
      const nextTool = turn.json().toolResults.find((t: { tool: string }) => t.tool === "next_booking");
      expect(nextTool.output.next).toBeNull(); // Bob has no bookings; Alice's are invisible
    });
  });

  describe("marketplace assistant", () => {
    it("answers 'find me a barber nearby' by reusing marketplace search", async () => {
      const biz = await bookableBusiness(app, "Nearby Barbers");
      const customer = await registerCustomer(app);
      await favourite(app, customer.token, biz.businessId);
      const id = await newConversation(app, customer.token, biz.slug);
      const turn = await say(app, customer.token, id, "Find me a barber nearby");
      const search = turn.json().toolResults.find((t: { tool: string }) => t.tool === "search_businesses");
      expect(search.ok).toBe(true);
      expect(search.output.businesses.some((b: { slug: string }) => b.slug === biz.slug)).toBe(true);
    });
  });

  describe("recommendation engine", () => {
    it("returns explainable recommendations (every item carries a reason)", async () => {
      const biz = await bookableBusiness(app, "Rec Barbers");
      const customer = await registerCustomer(app);
      await favourite(app, customer.token, biz.businessId);
      const res = await app.inject({ method: "GET", url: "/customer/ai/assistant/recommendations", headers: auth(customer.token) }).then((r) => r.json());
      expect(Array.isArray(res.recommendations)).toBe(true);
      for (const rec of res.recommendations) {
        expect(rec.reason.length).toBeGreaterThan(0);
        expect(rec.slug || rec.name).toBeTruthy();
      }
    });
  });

  describe("memory + personalization", () => {
    it("builds a customer-scoped context and personalization profile", async () => {
      const biz = await bookableBusiness(app, "Memory Barbers");
      const customer = await registerCustomer(app);
      await favourite(app, customer.token, biz.businessId);
      await app.inject({ method: "POST", url: "/customer/bookings", headers: auth(customer.token), payload: { slug: biz.slug, serviceOfferingId: biz.serviceId, startsAt: futureSlot(10, 9) } });

      const ctx = await app.inject({ method: "GET", url: "/customer/ai/assistant/context", headers: auth(customer.token) }).then((r) => r.json());
      expect(ctx.favouriteBusinesses.some((b: { name: string }) => b.name === "Memory Barbers")).toBe(true);
      expect(ctx.bookings.upcoming.length).toBe(1);
      expect(ctx.loyalty.tier).toBeDefined();

      const personalization = await app.inject({ method: "GET", url: "/customer/ai/assistant/personalization", headers: auth(customer.token) }).then((r) => r.json());
      expect(personalization.preferredBusinesses.some((b: { name: string }) => b.name === "Memory Barbers")).toBe(true);
    });

    it("respects the memory toggle: turning it off skips retrieval writes", async () => {
      const biz = await bookableBusiness(app, "Toggle Barbers");
      const customer = await registerCustomer(app);
      await favourite(app, customer.token, biz.businessId);
      await app.inject({ method: "PATCH", url: "/customer/ai/assistant/settings", headers: auth(customer.token), payload: { memoryEnabled: false } });

      const id = await newConversation(app, customer.token, biz.slug);
      await say(app, customer.token, id, "hello there");
      const run = await prisma.aIConversationRun.findFirstOrThrow({ where: { idempotencyKey: { startsWith: "customer-assistant:" } } });
      expect(await prisma.aIRetrievalLog.count({ where: { runId: run.id } })).toBe(0);
    });
  });

  describe("notifications", () => {
    it("writes an ai_reply notification to the customer feed", async () => {
      const biz = await bookableBusiness(app, "Notify Barbers");
      const customer = await registerCustomer(app);
      await favourite(app, customer.token, biz.businessId);
      const id = await newConversation(app, customer.token, biz.slug);
      await say(app, customer.token, id, "hello");
      const feed = await app.inject({ method: "GET", url: "/customer/notifications", headers: auth(customer.token) }).then((r) => r.json());
      expect(feed.some((n: { category: string }) => n.category === "ai_reply")).toBe(true);
    });
  });

  describe("settings", () => {
    it("reads and writes assistant settings through the existing profile storage", async () => {
      const customer = await registerCustomer(app);
      const before = await app.inject({ method: "GET", url: "/customer/ai/assistant/settings", headers: auth(customer.token) }).then((r) => r.json());
      expect(before.personalizationEnabled).toBe(true);
      const after = await app.inject({ method: "PATCH", url: "/customer/ai/assistant/settings", headers: auth(customer.token), payload: { personalizationEnabled: false, language: "fr", notifyOnReply: false } }).then((r) => r.json());
      expect(after).toMatchObject({ personalizationEnabled: false, language: "fr", notifyOnReply: false });
      const profile = await prisma.customerProfile.findUniqueOrThrow({ where: { id: customer.profileId } });
      expect((profile.privacySettings as { allowAIPersonalisation?: boolean }).allowAIPersonalisation).toBe(false);
    });
  });

  describe("cross-customer isolation", () => {
    it("a customer cannot read or post to another customer's conversation", async () => {
      const biz = await bookableBusiness(app, "Private Barbers");
      const alice = await registerCustomer(app);
      const bob = await registerCustomer(app);
      await favourite(app, alice.token, biz.businessId);
      const aliceConv = await newConversation(app, alice.token, biz.slug);
      await say(app, alice.token, aliceConv, "hello");

      expect((await app.inject({ method: "GET", url: `/customer/ai/assistant/conversations/${aliceConv}`, headers: auth(bob.token) })).statusCode).toBe(404);
      expect((await say(app, bob.token, aliceConv, "let me in")).statusCode).toBe(404);
      const bobList = await app.inject({ method: "GET", url: "/customer/ai/assistant/conversations", headers: auth(bob.token) }).then((r) => r.json());
      expect(bobList.items).toHaveLength(0);
    });
  });

  describe("admin oversight", () => {
    it("exposes customer AI analytics, usage, tool usage, conversations, feedback, quality and settings overview", async () => {
      const biz = await bookableBusiness(app, "Admin Barbers");
      const customer = await registerCustomer(app);
      await favourite(app, customer.token, biz.businessId);
      const id = await newConversation(app, customer.token, biz.slug);
      const turn = await say(app, customer.token, id, "Find me a barber nearby");
      await app.inject({ method: "POST", url: `/customer/ai/assistant/messages/${turn.json().assistantMessage.id}/feedback`, headers: auth(customer.token), payload: { rating: 1 } });

      const adminEmail = `ai-admin-${Date.now()}@example.com`;
      const adminAcct = await registerAccount(app, { email: adminEmail, password: "admin-password-123", businessName: "Admin Co" });
      await prisma.adminMembership.create({ data: { userId: adminAcct.userId, role: "SUPER_ADMIN" } });
      const login = await app.inject({ method: "POST", url: "/admin/auth/login", payload: { email: adminEmail, password: "admin-password-123" } });
      const headers = { authorization: `Bearer ${login.json().accessToken}` };

      const analytics = await app.inject({ method: "GET", url: "/admin/ai/customer/analytics", headers }).then((r) => r.json());
      expect(analytics.conversations).toBeGreaterThanOrEqual(1);
      expect(analytics.feedback.positive).toBeGreaterThanOrEqual(1);

      expect((await app.inject({ method: "GET", url: "/admin/ai/customer/usage", headers })).statusCode).toBe(200);
      const toolUsage = await app.inject({ method: "GET", url: "/admin/ai/customer/tool-usage", headers }).then((r) => r.json());
      expect(toolUsage.tools.some((t: { tool: string }) => t.tool === "search_businesses")).toBe(true);
      const convs = await app.inject({ method: "GET", url: "/admin/ai/customer/conversations", headers }).then((r) => r.json());
      expect(convs.total).toBeGreaterThanOrEqual(1);
      expect((await app.inject({ method: "GET", url: `/admin/ai/customer/conversations/${id}`, headers })).statusCode).toBe(200);
      const feedback = await app.inject({ method: "GET", url: "/admin/ai/customer/feedback", headers }).then((r) => r.json());
      expect(feedback.total).toBeGreaterThanOrEqual(1);
      expect((await app.inject({ method: "GET", url: "/admin/ai/customer/quality", headers })).statusCode).toBe(200);
      const overview = await app.inject({ method: "GET", url: "/admin/ai/customer/settings-overview", headers }).then((r) => r.json());
      expect(overview.activeCustomers).toBeGreaterThanOrEqual(1);
    });

    it("blocks customer AI admin routes for non-admins and customer sessions", async () => {
      const biz = await bookableBusiness(app, "Guard Barbers");
      expect(biz.slug).toBeTruthy();
      // A plain business user with no admin membership.
      const plain = await registerAccount(app, { email: `plain-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`, businessName: "Plain Co" });
      const denied = await app.inject({ method: "GET", url: "/admin/ai/customer/analytics", headers: { authorization: `Bearer ${plain.accessToken}` } });
      expect([401, 403]).toContain(denied.statusCode);
      // A customer session.
      const customer = await registerCustomer(app);
      const deniedCustomer = await app.inject({ method: "GET", url: "/admin/ai/customer/analytics", headers: auth(customer.token) });
      expect([401, 403]).toContain(deniedCustomer.statusCode);
    });
  });
});
