import { prisma } from "../../prisma.js";
import { ApiError } from "../../errors.js";
import { runCustomerAssistantTurn, notifyAssistantReply } from "./customerAssistant.js";

// PROGRAM 2 LOOP 4 — customer-visible AI conversation threads: titles,
// search, pin, archive, delete, paginated history. Thread storage only;
// every turn runs through runCustomerAssistantTurn (the AI Platform).

function titleFrom(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length <= 60 ? clean : `${clean.slice(0, 57)}…`;
}

async function ownedConversation(customerProfileId: string, id: string, opts: { includeDeleted?: boolean } = {}) {
  const conversation = await prisma.customerAIConversation.findFirst({
    where: { id, customerProfileId, ...(opts.includeDeleted ? {} : { deletedAt: null }) },
  });
  if (!conversation) throw ApiError.notFound("Conversation not found");
  return conversation;
}

export async function createAssistantConversation(customerProfileId: string, input: { title?: string; businessSlug?: string } = {}) {
  let businessId: string | null = null;
  if (input.businessSlug) {
    const business = await prisma.business.findFirst({ where: { publicSlug: input.businessSlug, platformStatus: "ACTIVE" }, select: { id: true } });
    if (!business) throw ApiError.notFound("Business not found");
    businessId = business.id;
  }
  return prisma.customerAIConversation.create({
    data: { customerProfileId, businessId, title: input.title?.trim() || null },
  });
}

export async function listAssistantConversations(customerProfileId: string, query: { archived?: boolean; q?: string; cursor?: string; limit?: number } = {}) {
  const limit = Math.min(query.limit ?? 20, 50);
  const rows = await prisma.customerAIConversation.findMany({
    where: {
      customerProfileId,
      deletedAt: null,
      ...(query.archived === undefined ? {} : query.archived ? { archivedAt: { not: null } } : { archivedAt: null }),
      ...(query.q ? { title: { contains: query.q, mode: "insensitive" } } : {}),
    },
    orderBy: [{ pinned: "desc" }, { lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take: limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    select: { id: true, title: true, businessId: true, pinned: true, archivedAt: true, lastMessageAt: true, messageCount: true, createdAt: true, updatedAt: true },
  });
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? items[items.length - 1]?.id ?? null : null };
}

export async function getAssistantConversation(customerProfileId: string, id: string, query: { cursor?: string; limit?: number } = {}) {
  const conversation = await ownedConversation(customerProfileId, id);
  const limit = Math.min(query.limit ?? 50, 100);
  const messages = await prisma.customerAIMessage.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: "asc" },
    take: limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const page = messages.slice(0, limit);
  return {
    conversation: { id: conversation.id, title: conversation.title, businessId: conversation.businessId, pinned: conversation.pinned, archivedAt: conversation.archivedAt, lastMessageAt: conversation.lastMessageAt, messageCount: conversation.messageCount, createdAt: conversation.createdAt },
    messages: page.map((m) => ({ id: m.id, role: m.role, content: m.content, toolCalls: m.toolCalls, policyOutcome: m.policyOutcome, rating: m.rating, createdAt: m.createdAt })),
    nextCursor: messages.length > limit ? page[page.length - 1]?.id ?? null : null,
  };
}

export async function sendAssistantMessage(customerProfileId: string, conversationId: string, content: string) {
  const conversation = await ownedConversation(customerProfileId, conversationId);
  const trimmed = content.trim();
  if (!trimmed) throw ApiError.badRequest("Message cannot be empty");

  const userMessage = await prisma.customerAIMessage.create({
    data: { conversationId, role: "user", content: trimmed },
  });

  const turn = await runCustomerAssistantTurn({
    customerProfileId,
    conversationId,
    messageId: userMessage.id,
    prompt: trimmed,
    preferBusinessId: conversation.businessId,
  });

  const assistantMessage = await prisma.customerAIMessage.create({
    data: {
      conversationId,
      role: "assistant",
      content: turn.replyText || "(no response)",
      runId: turn.runId,
      toolCalls: turn.toolResults.length ? (turn.toolResults as never) : undefined,
      policyOutcome: turn.policyOutcome,
    },
  });

  const now = new Date();
  await prisma.customerAIConversation.update({
    where: { id: conversationId },
    data: {
      lastMessageAt: now,
      messageCount: { increment: 2 },
      ...(conversation.title ? {} : { title: titleFrom(trimmed) }),
      ...(conversation.businessId ? {} : { businessId: turn.anchorBusinessId }),
    },
  });

  await notifyAssistantReply(customerProfileId, turn.anchorBusinessId, conversationId, turn.replyText);

  return {
    userMessage: { id: userMessage.id, role: "user", content: userMessage.content, createdAt: userMessage.createdAt },
    assistantMessage: { id: assistantMessage.id, role: "assistant", content: assistantMessage.content, toolCalls: turn.toolResults, policyOutcome: turn.policyOutcome, createdAt: assistantMessage.createdAt },
    status: turn.status,
    toolResults: turn.toolResults,
  };
}

export async function updateAssistantConversation(customerProfileId: string, id: string, patch: { title?: string; pinned?: boolean; archived?: boolean }) {
  await ownedConversation(customerProfileId, id);
  return prisma.customerAIConversation.update({
    where: { id },
    data: {
      ...(patch.title !== undefined ? { title: patch.title.trim() || null } : {}),
      ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
      ...(patch.archived !== undefined ? { archivedAt: patch.archived ? new Date() : null } : {}),
    },
  });
}

export async function deleteAssistantConversation(customerProfileId: string, id: string) {
  await ownedConversation(customerProfileId, id);
  await prisma.customerAIConversation.update({ where: { id }, data: { deletedAt: new Date(), pinned: false } });
  return { deleted: true };
}

export async function rateAssistantMessage(customerProfileId: string, messageId: string, rating: number, note?: string) {
  const message = await prisma.customerAIMessage.findFirst({
    where: { id: messageId, role: "assistant", conversation: { customerProfileId } },
    select: { id: true },
  });
  if (!message) throw ApiError.notFound("Message not found");
  return prisma.customerAIMessage.update({ where: { id: messageId }, data: { rating, feedbackNote: note?.trim() || null } });
}
