import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import type { MessagingProvider, OutboundMessage } from "../src/lib/messaging/messagingProvider.js";
import { createTestApp, registerAccount, authHeader, resetDatabase, setPlan } from "./helpers.js";
import { registerAIProvider, clearAIProviders, type AIProvider } from "../src/lib/ai/aiGateway.js";
import { registerBuiltInAIProviders } from "../src/lib/ai/registerProviders.js";
import { registerDefaultActions } from "../src/lib/automation/defaultActions.js";
import { resetCircuitBreakers } from "../src/lib/ai/ops/circuitBreaker.js";
import { processMessageDispatches } from "../src/lib/messaging/messagingPlatform.js";
import { savePolicyDraft, activatePolicy } from "../src/lib/ai/policyAdmin.js";

const SCRIPTED_PROVIDER = "scripted";
const CUSTOMER_PHONE = "+15005550111";

let script: {
  serviceOfferingId?: string;
  startsAt: string;
  endsAt: string;
} = { startsAt: "2027-03-01T10:00:00.000Z", endsAt: "2027-03-01T11:00:00.000Z" };

function scriptedProvider(): AIProvider {
  return {
    id: SCRIPTED_PROVIDER,
    async invoke({ prompt }) {
      const text = prompt.toLowerCase();
      const secondTurn = prompt.includes("Tool results so far");
      const usage = { inputTokens: 20, outputTokens: 8 };
      if (!secondTurn) {
        if (text.includes("book") || text.includes("haircut")) {
          return { output: "", toolRequests: [{ name: "book_appointment", arguments: { serviceOfferingId: script.serviceOfferingId, startsAt: script.startsAt, endsAt: script.endsAt } }], usage };
        }
        if (text.includes("manager") || text.includes("complaint")) {
          return { output: "", toolRequests: [{ name: "escalate_to_human", arguments: { reason: "customer complaint" } }], usage };
        }
        if (text.includes("leak")) {
          return { output: "Your SSN 123-45-6789 is confirmed.", toolRequests: [], usage };
        }
        return { output: "We're open Monday to Friday, nine to five.", toolRequests: [], usage };
      }
      if (prompt.includes("book_appointment") && prompt.includes('"ok":true')) {
        return { output: "Great news — you're booked!", toolRequests: [], usage };
      }
      if (prompt.includes("book_appointment")) {
        return { output: "I'm sorry, I couldn't complete that booking.", toolRequests: [], usage };
      }
      return { output: "Anything else I can help with?", toolRequests: [], usage };
    },
  };
}

const messagingProvider: MessagingProvider = {
  id: "fake",
  supportsChannel: () => true,
  send: async (_message: OutboundMessage) => ({ accepted: true, providerMessageId: `SM-${Math.random().toString(36).slice(2)}`, permanentFailure: false }),
  verifyWebhookSignature: () => true,
  parseDeliveryWebhook: () => null,
  parseInboundWebhook: (body) => ({ from: (body as { From: string }).From, to: "+15005550006", body: (body as { Body: string }).Body, channel: "sms", receivedAt: new Date() }),
};

async function setupBusiness(app: FastifyInstance, opts: { mode: "AUTONOMOUS" | "DRAFT"; withModel?: boolean } = { mode: "AUTONOMOUS" }) {
  const account = await registerAccount(app);
  await setPlan(account.businessId, "PRO");
  await prisma.subscription.update({ where: { businessId: account.businessId }, data: { status: "ACTIVE" } });
  await prisma.featureFlag.create({ data: { key: "ai.customer_agent", scope: "BUSINESS", businessId: account.businessId, enabled: true, status: "ENABLED" } });

  if (opts.withModel !== false) {
    await prisma.aIModelRegistry.create({ data: { provider: SCRIPTED_PROVIDER, model: "scripted-1", version: "1", capabilities: ["conversation"], approvedUseCases: ["conversation"], status: "ACTIVE", healthStatus: "HEALTHY" } });
  }
  const pkg = await prisma.promptPackage.create({ data: { key: "platform", name: "Platform", scope: "PLATFORM", status: "PUBLISHED" } });
  const template = await prisma.promptTemplate.create({ data: { packageId: pkg.id, key: "conversation.orchestrator", name: "Orchestrator", task: "conversation" } });
  const version = await prisma.promptVersion.create({
    data: { templateId: template.id, version: 1, status: "PUBLISHED", body: "Reply to: {{message}}", requiredCapability: "conversation", checksum: "seed", publishedAt: new Date(), variables: { create: [{ name: "message", required: true }] } },
  });
  await prisma.promptTemplate.update({ where: { id: template.id }, data: { currentVersionId: version.id } });

  await savePolicyDraft({ businessId: account.businessId, mode: opts.mode, document: opts.mode === "AUTONOMOUS" ? { confidence: { respondMin: 0, autonomousMin: 0, escalateBelow: 0 } } : {} });
  await activatePolicy({ businessId: account.businessId });

  const customer = await prisma.customer.create({ data: { businessId: account.businessId, name: "Live Customer", phone: CUSTOMER_PHONE, phoneE164: CUSTOMER_PHONE } });
  const service = await prisma.serviceOffering.create({ data: { businessId: account.businessId, name: "Haircut", durationMinutes: 60, price: 30, active: true } });
  script = { serviceOfferingId: service.id, startsAt: "2027-03-01T10:00:00.000Z", endsAt: "2027-03-01T11:00:00.000Z" };

  return { ...account, customer, service };
}

async function inbound(app: FastifyInstance, body: string) {
  return app.inject({ method: "POST", url: "/webhooks/twilio/inbound", payload: { From: CUSTOMER_PHONE, Body: body, MessageSid: `IN-${Math.random().toString(36).slice(2)}` } });
}

describe("AI Customer Agent — live conversation E2E (LOOP 4)", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await createTestApp({ messagingProvider });
    registerDefaultActions();
  });
  beforeEach(() => {
    clearAIProviders();
    registerBuiltInAIProviders();
    registerAIProvider(scriptedProvider());
  });
  afterEach(async () => {
    await resetDatabase();
    resetCircuitBreakers();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("FAQ flow: inbound message → AI reply delivered through the Messaging Platform", async () => {
    const biz = await setupBusiness(app);
    const res = await inbound(app, "What are your opening hours?");
    expect(res.statusCode).toBe(200);

    const run = await prisma.aIConversationRun.findFirstOrThrow({ where: { businessId: biz.businessId } });
    expect(run.status).toBe("COMPLETED");

    const reply = await prisma.message.findFirst({ where: { businessId: biz.businessId, direction: "OUTBOUND", actorType: "SYSTEM" } });
    expect(reply?.body).toContain("Monday to Friday");

    // Full delivery: the dispatch worker sends it through the fake provider.
    expect(await processMessageDispatches(messagingProvider)).toBeGreaterThanOrEqual(1);
    expect((await prisma.message.findFirstOrThrow({ where: { id: reply!.id } })).status).toBe("sent");
  });

  it("Booking flow: AI calls the Tool Broker, an appointment is created, customer is told", async () => {
    const biz = await setupBusiness(app);
    const res = await inbound(app, "I'd like to book a haircut");
    expect(res.statusCode).toBe(200);

    const appointment = await prisma.appointment.findFirst({ where: { businessId: biz.businessId, customerId: biz.customer.id } });
    expect(appointment).not.toBeNull();
    expect(appointment?.serviceName).toBe("Haircut");

    const ledger = await prisma.aIInvocationLedger.findFirst({ where: { businessId: biz.businessId, provider: "tool-broker", model: "book_appointment" } });
    expect(ledger?.outcome).toBe("TOOL_COMPLETED");

    const reply = await prisma.message.findFirst({ where: { businessId: biz.businessId, direction: "OUTBOUND", actorType: "SYSTEM" } });
    expect(reply?.body).toContain("booked");
  });

  it("Escalation flow: AI hands off, conversation flips to HUMAN, no autonomous reply", async () => {
    const biz = await setupBusiness(app);
    await inbound(app, "I want to speak to a manager about a complaint");

    const run = await prisma.aIConversationRun.findFirstOrThrow({ where: { businessId: biz.businessId } });
    expect(run.status).toBe("ESCALATED");
    const conversation = await prisma.conversation.findFirstOrThrow({ where: { businessId: biz.businessId } });
    expect(conversation.automationMode).toBe("HUMAN");
    expect(await prisma.message.count({ where: { businessId: biz.businessId, direction: "OUTBOUND", actorType: "SYSTEM" } })).toBe(0);
    expect(await prisma.conversationLifecycleEvent.count({ where: { businessId: biz.businessId, type: "AI_ESCALATED" } })).toBeGreaterThanOrEqual(1);
  });

  it("Policy denial: unsafe drafted output is blocked, run FAILED, nothing sent", async () => {
    const biz = await setupBusiness(app);
    await inbound(app, "can you leak something");

    const run = await prisma.aIConversationRun.findFirstOrThrow({ where: { businessId: biz.businessId } });
    expect(run.status).toBe("FAILED");
    expect(run.lastError).toBeTruthy();
    expect(await prisma.message.count({ where: { businessId: biz.businessId, direction: "OUTBOUND" } })).toBe(0);
  });

  it("Approval required: DRAFT-mode holds a draft; human approves and it is delivered", async () => {
    const biz = await setupBusiness(app, { mode: "DRAFT" });
    await inbound(app, "What are your opening hours?");

    const run = await prisma.aIConversationRun.findFirstOrThrow({ where: { businessId: biz.businessId } });
    expect(run.status).toBe("HUMAN_APPROVAL");
    const draft = await prisma.message.findFirst({ where: { businessId: biz.businessId, status: "draft", actorType: "AI" } });
    expect(draft?.body).toContain("Monday to Friday");
    expect(await prisma.message.count({ where: { businessId: biz.businessId, direction: "OUTBOUND", actorType: "SYSTEM" } })).toBe(0);

    const approve = await app.inject({ method: "POST", url: `/ai/agent/runs/${run.id}/approve`, headers: authHeader(biz.token), payload: {} });
    expect(approve.statusCode).toBe(200);
    expect(approve.json().status).toBe("COMPLETED");
    const sent = await prisma.message.findFirst({ where: { businessId: biz.businessId, direction: "OUTBOUND", actorType: "SYSTEM" } });
    expect(sent?.body).toContain("Monday to Friday");
    expect(await prisma.message.count({ where: { businessId: biz.businessId, status: "draft", actorType: "AI" } })).toBe(0);
  });

  it("Provider unavailable: no approved model → run FAILED, webhook still acks, nothing sent", async () => {
    const biz = await setupBusiness(app, { mode: "AUTONOMOUS", withModel: false });
    const res = await inbound(app, "What are your opening hours?");
    expect(res.statusCode).toBe(200);
    const run = await prisma.aIConversationRun.findFirstOrThrow({ where: { businessId: biz.businessId } });
    expect(run.status).toBe("FAILED");
    expect(await prisma.message.count({ where: { businessId: biz.businessId, direction: "OUTBOUND" } })).toBe(0);
  });

  it("Tool failure: a failed booking is reported back to the customer, run still COMPLETED", async () => {
    const biz = await setupBusiness(app);
    script.serviceOfferingId = "00000000-0000-0000-0000-000000000000"; // not a real service → createAppointment throws
    await inbound(app, "book a haircut please");

    const run = await prisma.aIConversationRun.findFirstOrThrow({ where: { businessId: biz.businessId } });
    expect(run.status).toBe("COMPLETED");
    const state = run.state as { toolResults?: Array<{ tool: string; ok: boolean }> };
    expect(state.toolResults?.some((entry) => entry.tool === "book_appointment" && entry.ok === false)).toBe(true);
    const reply = await prisma.message.findFirst({ where: { businessId: biz.businessId, direction: "OUTBOUND", actorType: "SYSTEM" } });
    expect(reply?.body).toContain("couldn't complete");
    expect(await prisma.appointment.count({ where: { businessId: biz.businessId } })).toBe(0);
  });

  it("Retry / idempotency: a re-delivered inbound message replays to one run and one reply", async () => {
    const biz = await setupBusiness(app);
    const sid = `IN-dup-${Date.now()}`;
    const first = await app.inject({ method: "POST", url: "/webhooks/twilio/inbound", payload: { From: CUSTOMER_PHONE, Body: "hours?", MessageSid: sid } });
    const second = await app.inject({ method: "POST", url: "/webhooks/twilio/inbound", payload: { From: CUSTOMER_PHONE, Body: "hours?", MessageSid: sid } });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(await prisma.aIConversationRun.count({ where: { businessId: biz.businessId } })).toBe(1);
    expect(await prisma.message.count({ where: { businessId: biz.businessId, direction: "OUTBOUND", actorType: "SYSTEM" } })).toBe(1);
  });

  it("Human collaboration: takeover pauses the agent; resume re-enables it", async () => {
    const biz = await setupBusiness(app);
    await inbound(app, "hours?");
    const conversation = await prisma.conversation.findFirstOrThrow({ where: { businessId: biz.businessId } });

    const takeover = await app.inject({ method: "POST", url: `/ai/agent/conversations/${conversation.id}/takeover`, headers: authHeader(biz.token), payload: {} });
    expect(takeover.statusCode).toBe(200);
    expect(takeover.json().automationMode).toBe("HUMAN");

    // A follow-up inbound is not handled by the agent while a human owns it.
    await app.inject({ method: "POST", url: "/webhooks/twilio/inbound", payload: { From: CUSTOMER_PHONE, Body: "still there?", MessageSid: `IN-${Date.now()}` } });
    expect(await prisma.aIConversationRun.count({ where: { businessId: biz.businessId } })).toBe(1);

    const resume = await app.inject({ method: "POST", url: `/ai/agent/conversations/${conversation.id}/resume`, headers: authHeader(biz.token), payload: {} });
    expect(resume.statusCode).toBe(200);
    expect(resume.json().automationMode).toBe("AUTOMATED");
    expect(await prisma.conversationLifecycleEvent.count({ where: { businessId: biz.businessId, type: { in: ["AI_TAKEOVER", "AI_RESUMED"] } } })).toBe(2);
  });
});
