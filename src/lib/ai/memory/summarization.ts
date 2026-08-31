import { prisma } from "../../prisma.js";
import { writeMemory } from "./memoryStore.js";

/**
 * Deterministic, extractive conversation summarization — no model call. It
 * takes the first inbound message, the last few exchanges, and any AI
 * decisions / human interventions already recorded as memory, and writes a
 * CONVERSATION-scope `summary` plus a handful of `key_fact` rows. Re-running
 * it supersedes the previous summary for the same conversation.
 */
export async function summarizeConversation(input: {
  businessId: string;
  conversationId: string;
  runId?: string | null;
  customerId?: string | null;
  outcome?: string | null;
  actorUserId?: string | null;
}) {
  const messages = await prisma.message.findMany({
    where: { businessId: input.businessId, conversationId: input.conversationId, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { direction: true, body: true, createdAt: true },
  });

  const firstInbound = messages.find((message) => message.direction === "INBOUND");
  const tail = messages.slice(-4);
  const lines: string[] = [];
  if (firstInbound) lines.push(`Opened with: "${firstInbound.body.slice(0, 200)}"`);
  if (tail.length) {
    lines.push(
      `Latest exchange: ${tail.map((message) => `${message.direction === "OUTBOUND" ? "biz" : "cust"}: ${message.body.slice(0, 140)}`).join(" | ")}`,
    );
  }
  if (input.outcome) lines.push(`Resolution outcome: ${input.outcome}.`);
  const summaryText = lines.join(" ") || "No messages exchanged yet.";

  const summary = await writeMemory({
    businessId: input.businessId,
    scope: "CONVERSATION",
    kind: "summary",
    title: "Conversation summary",
    content: summaryText,
    conversationId: input.conversationId,
    customerId: input.customerId ?? null,
    runId: input.runId ?? null,
    source: "summarizer",
    sourceRef: input.conversationId,
    importance: 0.75,
    supersedeMatching: true,
  });

  // Key facts: distinct, information-bearing customer lines.
  const facts = [...new Set(messages.filter((message) => message.direction === "INBOUND").map((message) => message.body.trim()))]
    .filter((body) => body.length >= 12 && /\d|\b(book|cancel|resched|price|quote|refund|address|time|date)\b/i.test(body))
    .slice(0, 5);
  for (const [index, fact] of facts.entries()) {
    await writeMemory({
      businessId: input.businessId,
      scope: "CONVERSATION",
      kind: "key_fact",
      content: fact.slice(0, 240),
      conversationId: input.conversationId,
      customerId: input.customerId ?? null,
      subjectId: `${input.conversationId}:fact:${index}`,
      source: "summarizer",
      sourceRef: input.conversationId,
      importance: 0.6,
      supersedeMatching: true,
    });
  }

  return { summary, keyFacts: facts.length };
}

/**
 * Records a discrete conversation-memory event (AI decision, human
 * intervention, customer intent, resolution). These become retrievable
 * CONVERSATION-scope items immediately.
 */
export async function recordConversationEvent(input: {
  businessId: string;
  conversationId: string;
  runId?: string | null;
  customerId?: string | null;
  kind: "ai_decision" | "human_intervention" | "intent" | "resolution";
  content: string;
  data?: unknown;
  importance?: number;
}) {
  return writeMemory({
    businessId: input.businessId,
    scope: "CONVERSATION",
    kind: input.kind,
    content: input.content,
    data: input.data,
    conversationId: input.conversationId,
    customerId: input.customerId ?? null,
    runId: input.runId ?? null,
    source: `runtime:${input.kind}`,
    sourceRef: input.runId ?? input.conversationId,
    importance: input.importance ?? (input.kind === "resolution" ? 0.8 : 0.65),
  });
}
