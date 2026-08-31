import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";

// PROGRAM 2 LOOP 4: platform oversight for the Customer AI Assistant. Reads
// the customer-assistant thread tables plus the shared AI Platform telemetry
// (AIConversationRun, AIInvocationLedger, AIPolicyDecision, AIRetrievalLog).
// Read-only; RBAC (platform.read) lives on the admin router.

function pageArgs(p = 1, size = 25) {
  const take = Math.min(200, Math.max(1, size));
  return { skip: (Math.max(1, p) - 1) * take, take, page: Math.max(1, p), pageSize: take };
}

export async function adminCustomerAIAnalytics() {
  const since30 = new Date(Date.now() - 30 * 86_400_000);
  const [conversations, activeCustomers, totalMessages, messages30, assistantMsgs, runsByStatus, feedback, customerCount] = await Promise.all([
    prisma.customerAIConversation.count({ where: { deletedAt: null } }),
    prisma.customerAIConversation.groupBy({ by: ["customerProfileId"], where: { deletedAt: null } }).then((rows) => rows.length),
    prisma.customerAIMessage.count(),
    prisma.customerAIMessage.count({ where: { createdAt: { gte: since30 } } }),
    prisma.customerAIMessage.count({ where: { role: "assistant" } }),
    prisma.aIConversationRun.groupBy({ by: ["status"], where: { idempotencyKey: { startsWith: "customer-assistant:" } }, _count: { _all: true } }),
    prisma.customerAIMessage.groupBy({ by: ["rating"], where: { rating: { not: null } }, _count: { _all: true } }),
    prisma.customerProfile.count({ where: { status: "ACTIVE" } }),
  ]);
  const conversationsPerActive = activeCustomers ? Number((conversations / activeCustomers).toFixed(2)) : 0;
  return {
    conversations,
    activeCustomers,
    adoptionRate: customerCount ? Number((activeCustomers / customerCount).toFixed(3)) : 0,
    totalMessages,
    assistantMessages: assistantMsgs,
    messagesLast30Days: messages30,
    avgMessagesPerConversation: conversations ? Number((totalMessages / conversations).toFixed(2)) : 0,
    conversationsPerActiveCustomer: conversationsPerActive,
    runsByStatus: Object.fromEntries(runsByStatus.map((r) => [r.status, r._count._all])),
    feedback: {
      positive: feedback.find((f) => f.rating === 1)?._count._all ?? 0,
      negative: feedback.find((f) => f.rating === -1)?._count._all ?? 0,
    },
  };
}

export async function adminCustomerAIUsage(days = 14) {
  const since = new Date(Date.now() - days * 86_400_000);
  const messages = await prisma.customerAIMessage.findMany({
    where: { createdAt: { gte: since } },
    select: { createdAt: true, role: true },
    orderBy: { createdAt: "asc" },
  });
  const byDay = new Map<string, { messages: number; assistant: number }>();
  for (const message of messages) {
    const key = message.createdAt.toISOString().slice(0, 10);
    const entry = byDay.get(key) ?? { messages: 0, assistant: 0 };
    entry.messages += 1;
    if (message.role === "assistant") entry.assistant += 1;
    byDay.set(key, entry);
  }
  return { days, series: [...byDay.entries()].map(([date, v]) => ({ date, ...v })) };
}

export async function adminCustomerAIToolUsage() {
  const messages = await prisma.customerAIMessage.findMany({
    where: { role: "assistant", toolCalls: { not: Prisma.DbNull } },
    select: { toolCalls: true },
    take: 5000,
    orderBy: { createdAt: "desc" },
  });
  const counts = new Map<string, { calls: number; ok: number; denied: number; failed: number }>();
  for (const message of messages) {
    const calls = Array.isArray(message.toolCalls) ? (message.toolCalls as Array<{ tool?: string; ok?: boolean; denied?: boolean }>) : [];
    for (const call of calls) {
      if (!call.tool) continue;
      const entry = counts.get(call.tool) ?? { calls: 0, ok: 0, denied: 0, failed: 0 };
      entry.calls += 1;
      if (call.ok) entry.ok += 1;
      else if (call.denied) entry.denied += 1;
      else entry.failed += 1;
      counts.set(call.tool, entry);
    }
  }
  return { tools: [...counts.entries()].map(([tool, v]) => ({ tool, ...v })).sort((a, b) => b.calls - a.calls) };
}

export async function adminCustomerAIConversations(query: { customerProfileId?: string; page?: number; pageSize?: number }) {
  const { skip, take, page, pageSize } = pageArgs(query.page, query.pageSize);
  const where = { deletedAt: null, ...(query.customerProfileId ? { customerProfileId: query.customerProfileId } : {}) };
  const [items, total] = await Promise.all([
    prisma.customerAIConversation.findMany({
      where,
      orderBy: { lastMessageAt: "desc" },
      skip,
      take,
      select: { id: true, customerProfileId: true, businessId: true, title: true, pinned: true, archivedAt: true, messageCount: true, lastMessageAt: true, createdAt: true },
    }),
    prisma.customerAIConversation.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function adminCustomerAIConversationDetail(id: string) {
  const conversation = await prisma.customerAIConversation.findUnique({
    where: { id },
    include: { messages: { orderBy: { createdAt: "asc" }, take: 200 } },
  });
  if (!conversation) throw ApiError.notFound("Conversation not found");
  return conversation;
}

export async function adminCustomerAIFeedback(query: { page?: number; pageSize?: number }) {
  const { skip, take, page, pageSize } = pageArgs(query.page, query.pageSize);
  const where = { role: "assistant", rating: { not: null } };
  const [items, total] = await Promise.all([
    prisma.customerAIMessage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: { id: true, conversationId: true, content: true, rating: true, feedbackNote: true, policyOutcome: true, createdAt: true },
    }),
    prisma.customerAIMessage.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function adminCustomerAIQualityMetrics() {
  const since30 = new Date(Date.now() - 30 * 86_400_000);
  const runs = await prisma.aIConversationRun.findMany({
    where: { idempotencyKey: { startsWith: "customer-assistant:" }, updatedAt: { gte: since30 } },
    select: { id: true, status: true },
  });
  const runIds = runs.map((r) => r.id);
  const [policyDecisions, retrieval] = await Promise.all([
    runIds.length
      ? prisma.aIPolicyDecision.groupBy({ by: ["outcome"], where: { checkpoint: "CUSTOMER_RESPONSE", runId: { in: runIds } }, _count: { _all: true } })
      : Promise.resolve([] as Array<{ outcome: string; _count: { _all: number } }>),
    runIds.length
      ? prisma.aIRetrievalLog.aggregate({ where: { runId: { in: runIds } }, _avg: { attributionCoverage: true, compressionRatio: true, contextTokens: true, latencyMs: true } })
      : Promise.resolve({ _avg: { attributionCoverage: null, compressionRatio: null, contextTokens: null, latencyMs: null } }),
  ]);
  const total = policyDecisions.reduce((sum, row) => sum + row._count._all, 0) || 1;
  const runTotal = runs.length || 1;
  return {
    policyOutcomes: Object.fromEntries(policyDecisions.map((r) => [r.outcome, r._count._all])),
    denyRate: Number(((policyDecisions.find((r) => r.outcome === "DENY")?._count._all ?? 0) / total).toFixed(3)),
    escalateRate: Number(((policyDecisions.find((r) => r.outcome === "ESCALATE")?._count._all ?? 0) / total).toFixed(3)),
    completionRate: Number((runs.filter((r) => r.status === "COMPLETED").length / runTotal).toFixed(3)),
    retrieval: {
      avgAttributionCoverage: retrieval._avg.attributionCoverage ?? null,
      avgCompressionRatio: retrieval._avg.compressionRatio ?? null,
      avgContextTokens: retrieval._avg.contextTokens ?? null,
      avgLatencyMs: retrieval._avg.latencyMs ?? null,
    },
  };
}

export async function adminCustomerAISettingsOverview() {
  const profiles = await prisma.customerProfile.findMany({
    where: { status: "ACTIVE" },
    select: { privacySettings: true, communicationPreferences: true },
    take: 20_000,
  });
  let personalizationOn = 0;
  let memoryOn = 0;
  let recommendationsOn = 0;
  const languages = new Map<string, number>();
  for (const profile of profiles) {
    const privacy = (profile.privacySettings ?? {}) as Record<string, unknown>;
    const assistant = ((profile.communicationPreferences ?? {}) as Record<string, { memoryEnabled?: boolean; recommendationsEnabled?: boolean; language?: string }>).assistant ?? {};
    if (privacy.allowAIPersonalisation !== false) personalizationOn += 1;
    if (assistant.memoryEnabled !== false) memoryOn += 1;
    if (assistant.recommendationsEnabled !== false) recommendationsOn += 1;
    const lang = assistant.language ?? "default";
    languages.set(lang, (languages.get(lang) ?? 0) + 1);
  }
  return {
    activeCustomers: profiles.length,
    personalizationOn,
    memoryOn,
    recommendationsOn,
    languages: Object.fromEntries([...languages.entries()].sort((a, b) => b[1] - a[1])),
  };
}
