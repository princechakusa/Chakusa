import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import { createTestApp, registerAccount, authHeader, resetDatabase } from "./helpers.js";
import {
  writeMemory,
  ensureSession,
  appendToolOutput,
  addPendingQuestion,
  pruneExpiredMemory,
  listMemory,
} from "../src/lib/ai/memory/memoryStore.js";
import { retrieveMemory } from "../src/lib/ai/memory/retrievalEngine.js";
import { deriveBusinessKnowledge, deriveCustomerKnowledge } from "../src/lib/ai/memory/knowledgeSources.js";
import { summarizeConversation } from "../src/lib/ai/memory/summarization.js";
import { advanceAIConversation } from "../src/lib/ai/aiRuntime.js";
import { savePolicyDraft, activatePolicy } from "../src/lib/ai/policyAdmin.js";
import { FAKE_AI_MODEL, FAKE_AI_PROVIDER_ID } from "../src/lib/ai/fakeAIProvider.js";

const NOW = new Date("2026-08-31T12:00:00.000Z");

async function seedModel() {
  await prisma.aIModelRegistry.create({
    data: {
      provider: FAKE_AI_PROVIDER_ID,
      model: FAKE_AI_MODEL,
      version: "1",
      capabilities: ["conversation"],
      approvedUseCases: ["conversation"],
      status: "ACTIVE",
      healthStatus: "HEALTHY",
    },
  });
}

async function seedOrchestrator() {
  const pkg = await prisma.promptPackage.create({ data: { key: "platform", name: "Platform", scope: "PLATFORM", status: "PUBLISHED" } });
  const template = await prisma.promptTemplate.create({ data: { packageId: pkg.id, key: "conversation.orchestrator", name: "Orchestrator", task: "conversation" } });
  const version = await prisma.promptVersion.create({
    data: {
      templateId: template.id,
      version: 1,
      status: "PUBLISHED",
      body: "Reply to: {{message}}",
      requiredCapability: "conversation",
      checksum: "seed",
      publishedAt: new Date(),
      variables: { create: [{ name: "message", required: true }] },
    },
  });
  await prisma.promptTemplate.update({ where: { id: template.id }, data: { currentVersionId: version.id } });
}

async function customer(businessId: string, name = "Mem Customer") {
  return prisma.customer.create({ data: { businessId, name, phone: "+263771234567", phoneE164: "+263771234567", email: "mem@example.com" } });
}

describe("AI Memory Platform & Knowledge Layer (3B-3)", () => {
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

  describe("session memory", () => {
    it("tracks variables, tool outputs and pending questions, retrievable via the engine", async () => {
      const { businessId } = await registerAccount(app);
      const run = await prisma.aIConversationRun.create({ data: { businessId, conversationId: "c1", idempotencyKey: "s1", status: "RECEIVED" } });
      await ensureSession({ businessId, runId: run.id, conversationId: "c1" });
      await appendToolOutput(businessId, run.id, { name: "CREATE_TASK", output: { id: "t1" } });
      const qId = await addPendingQuestion(businessId, run.id, "What date works for you?");
      expect(qId).toMatch(/^q_/);

      const result = await retrieveMemory({ businessId, phase: "TOOL_SELECTION", runId: run.id, now: NOW, persistLog: false });
      const kinds = result.items.map((item) => item.kind);
      expect(kinds).toContain("tool_output");
      expect(result.items.find((item) => item.kind === "pending_question")?.content).toContain("What date works");
      expect(result.items.every((item) => item.origin !== "session" || item.source.startsWith("session:"))).toBe(true);
    });
  });

  describe("business & customer knowledge", () => {
    it("derives business knowledge from services, staff and brand voice", async () => {
      const { businessId } = await registerAccount(app);
      await prisma.serviceOffering.create({ data: { businessId, name: "Haircut", category: "Grooming", durationMinutes: 30, price: 25 } });
      const items = await deriveBusinessKnowledge(businessId);
      const kinds = items.map((item) => item.kind);
      expect(kinds).toEqual(expect.arrayContaining(["business_profile", "brand_voice", "service", "pricing_rule", "staff"]));
      expect(items.every((item) => item.source.length > 0)).toBe(true);
      expect(items.find((item) => item.kind === "service")?.content).toContain("Haircut");
    });

    it("derives customer knowledge: appointments, reviews, loyalty, comms preferences", async () => {
      const { businessId } = await registerAccount(app);
      const c = await customer(businessId);
      await prisma.appointment.create({ data: { businessId, customerId: c.id, serviceName: "Haircut", startsAt: new Date("2026-07-01T10:00:00Z"), endsAt: new Date("2026-07-01T10:30:00Z"), status: "COMPLETED", price: 25, paidAmount: 25, paymentStatus: "paid", createdByUserId: "u" } });
      await prisma.feedback.create({ data: { businessId, customerId: c.id, rating: 5, sentiment: "positive", comment: "Great" } });
      await prisma.customerCommunicationPreference.create({ data: { businessId, customerId: c.id, preferredChannels: ["sms"], marketingConsent: true } });

      const items = await deriveCustomerKnowledge(businessId, c.id);
      const kinds = items.map((item) => item.kind);
      expect(kinds).toEqual(expect.arrayContaining(["customer_profile", "appointment_summary", "appointment", "loyalty", "sentiment_history", "review", "communication_preference"]));
      expect(items.every((item) => Boolean(item.source))).toBe(true);
    });
  });

  describe("retrieval engine", () => {
    async function seedRecords(businessId: string) {
      await writeMemory({ businessId, scope: "BUSINESS", kind: "faq", title: "Parking", content: "We have free parking on site for booking customers.", source: "manual", importance: 0.9, pinned: true });
      await writeMemory({ businessId, scope: "BUSINESS", kind: "promotion", content: "Spring promo: 10% off colour services in March.", source: "manual", importance: 0.4 });
      await writeMemory({ businessId, scope: "BUSINESS", kind: "business_instruction", content: "Never quote a firm price for bridal packages without a consultation.", source: "manual", importance: 0.8 });
    }

    it("is deterministic and attributes every returned item", async () => {
      const { businessId } = await registerAccount(app);
      await seedRecords(businessId);
      const a = await retrieveMemory({ businessId, phase: "RESPONSE", query: "parking", now: NOW, persistLog: false });
      const b = await retrieveMemory({ businessId, phase: "RESPONSE", query: "parking", now: NOW, persistLog: false });
      expect(a.items.map((item) => item.id)).toEqual(b.items.map((item) => item.id));
      expect(a.metrics.attributionCoverage).toBe(1);
      expect(a.items.every((item) => item.source && item.source.length > 0)).toBe(true);
    });

    it("ranks a pinned, query-relevant item first", async () => {
      const { businessId } = await registerAccount(app);
      await seedRecords(businessId);
      const result = await retrieveMemory({ businessId, phase: "RESPONSE", query: "is there parking available", now: NOW, persistLog: false });
      expect(result.items[0]?.kind).toBe("faq");
      expect(result.items[0]?.title).toBe("Parking");
    });

    it("compresses to the context-window budget", async () => {
      const { businessId } = await registerAccount(app);
      const topics = ["parking", "refunds", "opening", "booking", "products", "loyalty", "allergy", "payments", "cancellation", "groups", "gifts", "delivery"];
      for (const topic of topics) {
        await writeMemory({ businessId, scope: "BUSINESS", kind: "faq", title: topic, content: `Policy on ${topic}: ${`the specifics for ${topic} vary `.repeat(8)}`, source: "manual", importance: 0.6 });
      }
      const result = await retrieveMemory({ businessId, phase: "RESPONSE", tokenBudget: 200, now: NOW, persistLog: false });
      expect(result.metrics.contextTokens).toBeLessThanOrEqual(200);
      expect(result.metrics.compressionRatio).toBeLessThan(1);
      expect(result.items.some((item) => item.compressed)).toBe(true);
    });

    it("respects maxItems (context pruning)", async () => {
      const { businessId } = await registerAccount(app);
      for (let i = 0; i < 10; i += 1) {
        await writeMemory({ businessId, scope: "BUSINESS", kind: "faq", content: `Short fact number ${i}.`, source: "manual", importance: 0.5 });
      }
      const result = await retrieveMemory({ businessId, phase: "RESPONSE", maxItems: 3, tokenBudget: 5000, now: NOW, persistLog: false });
      expect(result.items.length).toBeLessThanOrEqual(3);
    });

    it("suppresses duplicate content", async () => {
      const { businessId } = await registerAccount(app);
      await writeMemory({ businessId, scope: "BUSINESS", kind: "faq", content: "We are open Monday to Friday from nine to five.", source: "a", importance: 0.5 });
      await writeMemory({ businessId, scope: "BUSINESS", kind: "faq", content: "We are open Monday to Friday from nine to five!", source: "b", importance: 0.5 });
      const result = await retrieveMemory({ businessId, phase: "RESPONSE", now: NOW, persistLog: false });
      const openHoursItems = result.items.filter((item) => item.content.toLowerCase().includes("monday to friday"));
      expect(openHoursItems.length).toBe(1);
      expect(result.metrics.duplicatesSuppressed).toBeGreaterThanOrEqual(1);
    });
  });

  describe("TTL & pruning", () => {
    it("excludes expired memory from retrieval and prunes it", async () => {
      const { businessId } = await registerAccount(app);
      await writeMemory({ businessId, scope: "BUSINESS", kind: "promotion", content: "Expired flash sale.", source: "manual", expiresAt: new Date("2026-08-30T00:00:00Z") });
      await writeMemory({ businessId, scope: "BUSINESS", kind: "faq", content: "Evergreen fact about our address.", source: "manual" });

      const result = await retrieveMemory({ businessId, phase: "RESPONSE", now: NOW, persistLog: false });
      expect(result.items.some((item) => item.content.includes("Expired flash sale"))).toBe(false);
      expect(result.items.some((item) => item.content.includes("Evergreen"))).toBe(true);

      const pruned = await pruneExpiredMemory(businessId);
      expect(pruned.records).toBe(1);
      expect(await listMemory(businessId, { includeExpired: true })).toHaveLength(1);
    });
  });

  describe("cross-tenant isolation", () => {
    it("never returns another business's memory or customer knowledge", async () => {
      const a = await registerAccount(app);
      const b = await registerAccount(app);
      await writeMemory({ businessId: b.businessId, scope: "BUSINESS", kind: "faq", content: "Business B secret parking code is 4242.", source: "manual", pinned: true, importance: 1 });
      const foreignCustomer = await customer(b.businessId, "B Customer");

      const result = await retrieveMemory({ businessId: a.businessId, phase: "RESPONSE", query: "parking code", customerId: foreignCustomer.id, now: NOW, persistLog: false });
      expect(result.items.some((item) => item.content.includes("4242"))).toBe(false);
      expect(await deriveCustomerKnowledge(a.businessId, foreignCustomer.id)).toEqual([]);
    });
  });

  describe("conversation & long-term memory", () => {
    it("summarizes a conversation and supersedes the prior summary", async () => {
      const { businessId } = await registerAccount(app);
      const conv = await prisma.conversation.create({ data: { businessId, status: "OPEN" } });
      await prisma.message.create({ data: { businessId, conversationId: conv.id, messageType: "custom", body: "Hi, I want to book a haircut for Friday at 2pm.", direction: "INBOUND", idempotencyKey: "m1" } });
      await prisma.message.create({ data: { businessId, conversationId: conv.id, messageType: "custom", body: "Sure, Friday 2pm works.", direction: "OUTBOUND", idempotencyKey: "m2" } });

      const first = await summarizeConversation({ businessId, conversationId: conv.id, outcome: "COMPLETED" });
      expect(first.summary.content).toContain("book a haircut");
      const second = await summarizeConversation({ businessId, conversationId: conv.id, outcome: "COMPLETED" });
      const active = await prisma.aIMemoryRecord.findMany({ where: { businessId, kind: "summary", supersededById: null } });
      expect(active).toHaveLength(1);
      expect(active[0]?.id).toBe(second.summary.id);

      // Long-term retrieval picks up the historical summary as CONVERSATION memory for that conversation.
      const result = await retrieveMemory({ businessId, phase: "PLANNING", conversationId: conv.id, now: NOW, persistLog: false });
      expect(result.items.some((item) => item.kind === "summary")).toBe(true);
    });
  });

  describe("runtime integration", () => {
    it("advanceAIConversation retrieves memory per phase, logs it, and writes conversation memory", async () => {
      const { businessId } = await registerAccount(app);
      await seedModel();
      await seedOrchestrator();
      await savePolicyDraft({ businessId, mode: "AUTONOMOUS", document: { confidence: { respondMin: 0, autonomousMin: 0, escalateBelow: 0 } } });
      await activatePolicy({ businessId });
      const c = await customer(businessId);
      const conv = await prisma.conversation.create({ data: { businessId, customerId: c.id, status: "OPEN" } });
      const run = await prisma.aIConversationRun.create({ data: { businessId, customerId: c.id, conversationId: conv.id, idempotencyKey: "run-mem-1", status: "RECEIVED" } });

      const advanced = await advanceAIConversation({ businessId, runId: run.id, prompt: "Do you have parking?" });
      expect(advanced.status).toBe("COMPLETED");

      const session = await prisma.aIMemorySession.findFirst({ where: { runId: run.id } });
      expect(session).not.toBeNull();

      const logs = await prisma.aIRetrievalLog.findMany({ where: { businessId, runId: run.id } });
      expect(new Set(logs.map((log) => log.phase))).toEqual(new Set(["INTENT", "PLANNING", "TOOL_SELECTION", "RESPONSE"]));
      expect(logs.every((log) => log.attributionCoverage === 1 || log.returnedCount === 0)).toBe(true);

      const convMemory = await prisma.aIMemoryRecord.findMany({ where: { businessId, conversationId: conv.id, supersededById: null } });
      expect(convMemory.map((row) => row.kind)).toEqual(expect.arrayContaining(["ai_decision", "resolution", "summary"]));

      const state = advanced.state as { retrievalMetrics?: Record<string, unknown> };
      expect(state.retrievalMetrics && Object.keys(state.retrievalMetrics)).toEqual(expect.arrayContaining(["INTENT", "RESPONSE"]));
    });
  });

  describe("HTTP module & monitoring", () => {
    it("exposes memory management and monitoring, tenant-scoped", async () => {
      const owner = await registerAccount(app);
      await seedModel();
      await seedOrchestrator();
      await savePolicyDraft({ businessId: owner.businessId, mode: "AUTONOMOUS", document: { confidence: { respondMin: 0, autonomousMin: 0, escalateBelow: 0 } } });
      await activatePolicy({ businessId: owner.businessId });

      const created = await app.inject({
        method: "POST",
        url: "/ai/memory/records",
        headers: authHeader(owner.token),
        payload: { scope: "BUSINESS", kind: "faq", title: "Refunds", content: "Refunds are issued within 14 days.", importance: 0.8 },
      });
      expect(created.statusCode).toBe(201);

      const businessView = await app.inject({ method: "GET", url: "/ai/memory/business", headers: authHeader(owner.token) }).then((r) => r.json());
      expect(businessView.stored.some((row: { kind: string }) => row.kind === "faq")).toBe(true);
      expect(businessView.derived.some((row: { kind: string }) => row.kind === "business_profile")).toBe(true);

      const preview = await app.inject({
        method: "POST",
        url: "/ai/memory/retrieve",
        headers: authHeader(owner.token),
        payload: { phase: "RESPONSE", query: "refund policy" },
      });
      expect(preview.statusCode).toBe(200);
      expect(preview.json().metrics.attributionCoverage).toBe(1);
      // preview must not persist a log
      expect(await prisma.aIRetrievalLog.count({ where: { businessId: owner.businessId } })).toBe(0);

      const conv = await prisma.conversation.create({ data: { businessId: owner.businessId, status: "OPEN" } });
      const run = await prisma.aIConversationRun.create({ data: { businessId: owner.businessId, conversationId: conv.id, idempotencyKey: "run-http-1", status: "RECEIVED" } });
      await advanceAIConversation({ businessId: owner.businessId, runId: run.id, prompt: "hello" });

      const monitoring = await app.inject({ method: "GET", url: "/ai/memory/monitoring", headers: authHeader(owner.token) }).then((r) => r.json());
      expect(monitoring.retrievals).toBeGreaterThanOrEqual(4);
      expect(Object.keys(monitoring.byPhase).sort()).toEqual(["INTENT", "PLANNING", "RESPONSE", "TOOL_SELECTION"]);
      expect(monitoring.avgSourceAttributionCoverage).toBeGreaterThan(0);
      expect(monitoring.store.activeRecords).toBeGreaterThanOrEqual(1);

      const other = await registerAccount(app);
      const otherView = await app.inject({ method: "GET", url: "/ai/memory/business", headers: authHeader(other.token) }).then((r) => r.json());
      expect(otherView.stored).toHaveLength(0);
    });
  });
});
