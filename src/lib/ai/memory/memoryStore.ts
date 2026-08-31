import type { Prisma } from "@prisma/client";
import { prisma } from "../../prisma.js";
import { ApiError } from "../../errors.js";
import { MEMORY_SCOPES, type MemoryItem, type MemoryScope } from "./memoryTypes.js";

const DEFAULT_SESSION_TTL_MINUTES = 60;

export interface WriteMemoryInput {
  businessId: string;
  scope: MemoryScope;
  kind: string;
  content: string;
  title?: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
  conversationId?: string | null;
  customerId?: string | null;
  runId?: string | null;
  data?: unknown;
  source: string;
  sourceRef?: string | null;
  confidence?: number | null;
  importance?: number;
  pinned?: boolean;
  expiresAt?: Date | null;
  ttlMinutes?: number | null;
  createdByUserId?: string | null;
  /** When set, any existing non-superseded record with the same (scope, kind, dedupeKey) is superseded. */
  supersedeMatching?: boolean;
}

function resolveExpiry(input: WriteMemoryInput): Date | null {
  if (input.expiresAt !== undefined) return input.expiresAt;
  if (input.ttlMinutes) return new Date(Date.now() + input.ttlMinutes * 60_000);
  return null;
}

export async function writeMemory(input: WriteMemoryInput) {
  if (!MEMORY_SCOPES.includes(input.scope)) throw ApiError.badRequest(`Unknown memory scope: ${input.scope}`);
  if (!input.content.trim()) throw ApiError.badRequest("Memory content cannot be empty");
  if (!input.source.trim()) throw ApiError.badRequest("Memory requires a source attribution");

  return prisma.$transaction(async (tx) => {
    const created = await tx.aIMemoryRecord.create({
      data: {
        businessId: input.businessId,
        scope: input.scope,
        kind: input.kind,
        content: input.content,
        title: input.title ?? null,
        subjectType: input.subjectType ?? null,
        subjectId: input.subjectId ?? null,
        conversationId: input.conversationId ?? null,
        customerId: input.customerId ?? null,
        runId: input.runId ?? null,
        data: (input.data ?? undefined) as Prisma.InputJsonValue | undefined,
        source: input.source,
        sourceRef: input.sourceRef ?? null,
        confidence: input.confidence ?? null,
        importance: input.importance ?? 0.5,
        pinned: input.pinned ?? false,
        expiresAt: resolveExpiry(input),
        createdByUserId: input.createdByUserId ?? null,
      },
    });
    if (input.supersedeMatching) {
      await tx.aIMemoryRecord.updateMany({
        where: {
          businessId: input.businessId,
          scope: input.scope,
          kind: input.kind,
          conversationId: input.conversationId ?? null,
          customerId: input.customerId ?? null,
          subjectId: input.subjectId ?? null,
          supersededById: null,
          id: { not: created.id },
        },
        data: { supersededById: created.id },
      });
    }
    return created;
  });
}

export async function updateMemory(businessId: string, id: string, patch: Partial<Pick<WriteMemoryInput, "content" | "title" | "data" | "importance" | "pinned" | "expiresAt" | "confidence">>) {
  const existing = await prisma.aIMemoryRecord.findFirst({ where: { id, businessId } });
  if (!existing) throw ApiError.notFound("Memory record not found");
  return prisma.aIMemoryRecord.update({
    where: { id },
    data: {
      content: patch.content ?? existing.content,
      title: patch.title === undefined ? existing.title : patch.title,
      data: (patch.data ?? existing.data ?? undefined) as Prisma.InputJsonValue | undefined,
      importance: patch.importance ?? existing.importance,
      pinned: patch.pinned ?? existing.pinned,
      confidence: patch.confidence === undefined ? existing.confidence : patch.confidence,
      expiresAt: patch.expiresAt === undefined ? existing.expiresAt : patch.expiresAt,
    },
  });
}

export async function deleteMemory(businessId: string, id: string) {
  const deleted = await prisma.aIMemoryRecord.deleteMany({ where: { id, businessId } });
  if (!deleted.count) throw ApiError.notFound("Memory record not found");
}

export async function listMemory(businessId: string, filter: { scope?: MemoryScope; kind?: string; customerId?: string; conversationId?: string; includeExpired?: boolean } = {}) {
  return prisma.aIMemoryRecord.findMany({
    where: {
      businessId,
      supersededById: null,
      ...(filter.scope ? { scope: filter.scope } : {}),
      ...(filter.kind ? { kind: filter.kind } : {}),
      ...(filter.customerId ? { customerId: filter.customerId } : {}),
      ...(filter.conversationId ? { conversationId: filter.conversationId } : {}),
      ...(filter.includeExpired ? {} : { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }),
    },
    orderBy: [{ pinned: "desc" }, { importance: "desc" }, { updatedAt: "desc" }],
    take: 500,
  });
}

/** Deletes memory whose TTL has passed. Returns the number removed. */
export async function pruneExpiredMemory(businessId?: string) {
  const now = new Date();
  const [records, sessions] = await prisma.$transaction([
    prisma.aIMemoryRecord.deleteMany({ where: { ...(businessId ? { businessId } : {}), expiresAt: { not: null, lt: now } } }),
    prisma.aIMemorySession.deleteMany({ where: { ...(businessId ? { businessId } : {}), expiresAt: { lt: now } } }),
  ]);
  return { records: records.count, sessions: sessions.count };
}

export function recordToItem(record: {
  id: string;
  scope: string;
  kind: string;
  title: string | null;
  content: string;
  source: string;
  sourceRef: string | null;
  importance: number;
  pinned: boolean;
  confidence: number | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
  data: unknown;
}): MemoryItem {
  return {
    id: record.id,
    scope: record.scope as MemoryScope,
    kind: record.kind,
    title: record.title,
    content: record.content,
    source: record.source,
    sourceRef: record.sourceRef,
    importance: record.importance,
    pinned: record.pinned,
    confidence: record.confidence,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    expiresAt: record.expiresAt,
    data: record.data,
    origin: "stored",
  };
}

// ---------------------------------------------------------------------------
// Session memory
// ---------------------------------------------------------------------------

export interface SessionState {
  context: Record<string, unknown>;
  variables: Record<string, unknown>;
  toolOutputs: Array<{ name: string; output: unknown; at: string }>;
  pendingQuestions: Array<{ id: string; question: string; askedAt: string; answeredAt?: string; answer?: string }>;
}

export async function ensureSession(input: { businessId: string; runId: string; conversationId?: string | null; customerId?: string | null; ttlMinutes?: number }) {
  const expiresAt = new Date(Date.now() + (input.ttlMinutes ?? DEFAULT_SESSION_TTL_MINUTES) * 60_000);
  return prisma.aIMemorySession.upsert({
    where: { runId: input.runId },
    create: {
      businessId: input.businessId,
      runId: input.runId,
      conversationId: input.conversationId ?? null,
      customerId: input.customerId ?? null,
      expiresAt,
    },
    update: { expiresAt, conversationId: input.conversationId ?? null, customerId: input.customerId ?? null },
  });
}

export async function getSession(businessId: string, runId: string) {
  return prisma.aIMemorySession.findFirst({ where: { runId, businessId } });
}

function readSession(row: { context: unknown; variables: unknown; toolOutputs: unknown; pendingQuestions: unknown }): SessionState {
  return {
    context: (row.context as Record<string, unknown>) ?? {},
    variables: (row.variables as Record<string, unknown>) ?? {},
    toolOutputs: Array.isArray(row.toolOutputs) ? (row.toolOutputs as SessionState["toolOutputs"]) : [],
    pendingQuestions: Array.isArray(row.pendingQuestions) ? (row.pendingQuestions as SessionState["pendingQuestions"]) : [],
  };
}

export async function updateSession(businessId: string, runId: string, mutate: (state: SessionState) => SessionState) {
  const row = await prisma.aIMemorySession.findFirst({ where: { runId, businessId } });
  if (!row) throw ApiError.notFound("AI memory session not found");
  const next = mutate(readSession(row));
  return prisma.aIMemorySession.update({
    where: { id: row.id },
    data: {
      context: next.context as Prisma.InputJsonValue,
      variables: next.variables as Prisma.InputJsonValue,
      toolOutputs: next.toolOutputs as Prisma.InputJsonValue,
      pendingQuestions: next.pendingQuestions as Prisma.InputJsonValue,
    },
  });
}

export async function setSessionContext(businessId: string, runId: string, patch: Record<string, unknown>) {
  return updateSession(businessId, runId, (state) => ({ ...state, context: { ...state.context, ...patch } }));
}

export async function setSessionVariables(businessId: string, runId: string, patch: Record<string, unknown>) {
  return updateSession(businessId, runId, (state) => ({ ...state, variables: { ...state.variables, ...patch } }));
}

export async function appendToolOutput(businessId: string, runId: string, entry: { name: string; output: unknown }) {
  return updateSession(businessId, runId, (state) => ({
    ...state,
    toolOutputs: [...state.toolOutputs, { name: entry.name, output: entry.output, at: new Date().toISOString() }].slice(-50),
  }));
}

export async function addPendingQuestion(businessId: string, runId: string, question: string) {
  const id = `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  await updateSession(businessId, runId, (state) => ({
    ...state,
    pendingQuestions: [...state.pendingQuestions, { id, question, askedAt: new Date().toISOString() }],
  }));
  return id;
}

export async function resolvePendingQuestion(businessId: string, runId: string, questionId: string, answer: string) {
  return updateSession(businessId, runId, (state) => ({
    ...state,
    pendingQuestions: state.pendingQuestions.map((q) => (q.id === questionId ? { ...q, answer, answeredAt: new Date().toISOString() } : q)),
  }));
}

export async function sessionToItems(businessId: string, runId: string): Promise<MemoryItem[]> {
  const row = await prisma.aIMemorySession.findFirst({ where: { runId, businessId } });
  if (!row) return [];
  const state = readSession(row);
  const items: MemoryItem[] = [];
  const base = { scope: "SESSION" as const, pinned: false, createdAt: row.createdAt, updatedAt: row.updatedAt, expiresAt: row.expiresAt, origin: "session" as const, importance: 0.6 };
  for (const [key, value] of Object.entries(state.variables)) {
    items.push({ ...base, id: `${row.id}:var:${key}`, kind: "variable", title: key, content: `${key} = ${JSON.stringify(value)}`, source: `session:${runId}` });
  }
  for (const [index, output] of state.toolOutputs.entries()) {
    items.push({ ...base, id: `${row.id}:tool:${index}`, kind: "tool_output", title: output.name, content: `Tool ${output.name} → ${JSON.stringify(output.output)}`, source: `session:${runId}:tool:${output.name}`, importance: 0.7 });
  }
  for (const question of state.pendingQuestions.filter((q) => !q.answeredAt)) {
    items.push({ ...base, id: `${row.id}:q:${question.id}`, kind: "pending_question", content: `Awaiting answer: ${question.question}`, source: `session:${runId}:question`, importance: 0.9 });
  }
  return items;
}
