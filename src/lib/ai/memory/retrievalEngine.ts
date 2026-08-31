import { prisma } from "../../prisma.js";
import {
  estimateTokens,
  jaccard,
  normalizeForDedup,
  wordSet,
  type MemoryItem,
  type MemoryScope,
  type RetrievalPhase,
  type RetrievalResult,
  type RetrievedItem,
} from "./memoryTypes.js";
import { recordToItem, sessionToItems } from "./memoryStore.js";
import {
  deriveBusinessKnowledge,
  deriveConversationKnowledge,
  deriveCustomerKnowledge,
  deriveLongTermKnowledge,
} from "./knowledgeSources.js";

export interface RetrieveInput {
  businessId: string;
  phase: RetrievalPhase;
  runId?: string;
  conversationId?: string;
  customerId?: string;
  query?: string;
  tokenBudget?: number;
  maxItems?: number;
  now?: Date;
  persistLog?: boolean;
}

const DEFAULT_TOKEN_BUDGET = 1400;
const DEFAULT_MAX_ITEMS = 24;
const MIN_COMPRESSED_CHARS = 48;
const NEAR_DUPLICATE_THRESHOLD = 0.82;

// Half-life (days) for recency weighting, per scope. Session memory is
// almost entirely recency-driven; business facts barely decay.
const HALF_LIFE_DAYS: Record<MemoryScope, number> = {
  SESSION: 0.25,
  CONVERSATION: 5,
  CUSTOMER: 75,
  BUSINESS: 400,
  LONG_TERM: 150,
};

// Which memory kinds each runtime phase should prefer. A matched kind gets a
// deterministic score boost so the same inputs always yield the same order.
const PHASE_KIND_BOOST: Record<RetrievalPhase, Record<string, number>> = {
  INTENT: { intent: 0.25, sentiment_history: 0.2, conversation_meta: 0.15, summary: 0.15, prior_ai_conversation: 0.1, communication_history: 0.1 },
  PLANNING: { summary: 0.2, key_fact: 0.2, appointment_summary: 0.15, loyalty: 0.15, resolution: 0.15, policy: 0.15, business_instruction: 0.15 },
  TOOL_SELECTION: { service: 0.2, pricing_rule: 0.2, working_hours: 0.15, policy: 0.2, staff: 0.15, tool_output: 0.25, faq: 0.1 },
  RESPONSE: { brand_voice: 0.25, faq: 0.2, communication_preference: 0.2, promotion: 0.15, business_instruction: 0.15, customer_profile: 0.1, pending_question: 0.3 },
};

function recencyWeight(date: Date, scope: MemoryScope, now: Date): number {
  const ageDays = Math.max(0, (now.getTime() - date.getTime()) / 86_400_000);
  return Math.exp(-ageDays / HALF_LIFE_DAYS[scope]);
}

function freshnessScore(item: MemoryItem, now: Date): number {
  if (item.expiresAt) {
    const total = item.expiresAt.getTime() - item.updatedAt.getTime();
    if (total <= 0) return 0;
    return Math.min(1, Math.max(0, (item.expiresAt.getTime() - now.getTime()) / total));
  }
  const ageDays = Math.max(0, (now.getTime() - item.updatedAt.getTime()) / 86_400_000);
  return Math.exp(-ageDays / 120);
}

function relevanceScore(query: string | undefined, item: MemoryItem): number {
  if (!query) return 0.5;
  const overlap = jaccard(wordSet(query), wordSet(`${item.title ?? ""} ${item.content}`));
  return Math.min(1, overlap * 3); // small overlaps still matter for short queries
}

function scoreItem(item: MemoryItem, input: RetrieveInput, now: Date) {
  const recency = recencyWeight(item.updatedAt, item.scope, now);
  const freshness = freshnessScore(item, now);
  const relevance = relevanceScore(input.query, item);
  const phaseBoost = PHASE_KIND_BOOST[input.phase][item.kind] ?? 0;
  const score =
    0.3 * item.importance +
    0.22 * recency +
    0.13 * freshness +
    0.25 * relevance +
    phaseBoost +
    (item.pinned ? 0.5 : 0);
  return { recency, freshness, relevance, score };
}

/** Stable, deterministic ordering: score desc, then origin priority, then id. */
const ORIGIN_RANK: Record<MemoryItem["origin"], number> = { session: 0, stored: 1, derived: 2 };
function compareScored(a: RetrievedItem, b: RetrievedItem): number {
  if (b.score !== a.score) return b.score - a.score;
  if (ORIGIN_RANK[a.origin] !== ORIGIN_RANK[b.origin]) return ORIGIN_RANK[a.origin] - ORIGIN_RANK[b.origin];
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function suppressDuplicates(items: RetrievedItem[]): { kept: RetrievedItem[]; suppressed: number } {
  const kept: RetrievedItem[] = [];
  const seenExact = new Set<string>();
  const keptSets: Set<string>[] = [];
  let suppressed = 0;
  for (const item of items) {
    const normalized = normalizeForDedup(`${item.title ?? ""} ${item.content}`);
    if (seenExact.has(normalized)) {
      suppressed += 1;
      continue;
    }
    const set = wordSet(normalized);
    if (keptSets.some((existing) => jaccard(existing, set) >= NEAR_DUPLICATE_THRESHOLD)) {
      suppressed += 1;
      continue;
    }
    seenExact.add(normalized);
    keptSets.push(set);
    kept.push(item);
  }
  return { kept, suppressed };
}

function compressToBudget(items: RetrievedItem[], tokenBudget: number, maxItems: number) {
  const selected: RetrievedItem[] = [];
  let contextTokens = 0;
  let rawTokens = 0;
  for (const item of items) {
    if (selected.length >= maxItems) break;
    const full = estimateTokens(`${item.title ?? ""} ${item.content}`);
    const remaining = tokenBudget - contextTokens;
    if (remaining <= 0) break;
    if (full <= remaining) {
      selected.push({ ...item, tokens: full, compressed: false });
      contextTokens += full;
      rawTokens += full;
      continue;
    }
    // Compress: keep the leading slice that fits (accounting for the title
    // prefix and the ellipsis), drop the data blob.
    const overhead = (item.title ? item.title.length + 1 : 0) + 2;
    const budgetChars = remaining * 4 - overhead;
    if (budgetChars < MIN_COMPRESSED_CHARS) break;
    const trimmed = `${item.content.slice(0, budgetChars).trimEnd()}…`;
    const tokens = estimateTokens(`${item.title ?? ""} ${trimmed}`);
    if (tokens > remaining) break;
    selected.push({ ...item, content: trimmed, data: undefined, tokens, compressed: true });
    contextTokens += tokens;
    rawTokens += full;
  }
  return { selected, contextTokens, rawTokens };
}

async function gatherCandidates(input: RetrieveInput): Promise<MemoryItem[]> {
  const now = input.now ?? new Date();
  const tasks: Array<Promise<MemoryItem[]>> = [];

  // Stored memory records (tenant-scoped, non-superseded, non-expired).
  tasks.push(
    prisma.aIMemoryRecord
      .findMany({
        where: {
          businessId: input.businessId,
          supersededById: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          AND: [
            {
              OR: [
                { scope: "BUSINESS" },
                { scope: "LONG_TERM" },
                ...(input.customerId ? [{ scope: "CUSTOMER" as const, customerId: input.customerId }] : []),
                ...(input.conversationId ? [{ scope: "CONVERSATION" as const, conversationId: input.conversationId }] : []),
              ],
            },
          ],
        },
        orderBy: [{ pinned: "desc" }, { importance: "desc" }, { updatedAt: "desc" }],
        take: 300,
      })
      .then((rows) => rows.map(recordToItem)),
  );

  tasks.push(deriveBusinessKnowledge(input.businessId));
  tasks.push(deriveLongTermKnowledge(input.businessId));
  if (input.customerId) tasks.push(deriveCustomerKnowledge(input.businessId, input.customerId));
  if (input.conversationId) tasks.push(deriveConversationKnowledge(input.businessId, input.conversationId));
  if (input.runId) tasks.push(sessionToItems(input.businessId, input.runId));

  const groups = await Promise.all(tasks);
  return groups.flat();
}

/**
 * Deterministic memory retrieval: gather -> score -> suppress duplicates ->
 * rank -> compress to the context-window budget -> log. Every returned item
 * keeps its `source`. Given the same stored data and `now`, the result is
 * byte-for-byte identical.
 */
export async function retrieveMemory(input: RetrieveInput): Promise<RetrievalResult> {
  const started = Date.now();
  const now = input.now ?? new Date();
  const tokenBudget = input.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
  const maxItems = input.maxItems ?? DEFAULT_MAX_ITEMS;

  const candidates = await gatherCandidates(input);
  const scored: RetrievedItem[] = candidates.map((item) => {
    const { recency, freshness, relevance, score } = scoreItem(item, input, now);
    return { ...item, recencyWeight: recency, freshness, relevance, score, tokens: estimateTokens(item.content), compressed: false };
  });
  scored.sort(compareScored);

  const { kept, suppressed } = suppressDuplicates(scored);
  const { selected, contextTokens, rawTokens } = compressToBudget(kept, tokenBudget, maxItems);

  const attributed = selected.filter((item) => item.source && item.source.trim().length > 0).length;
  const metrics = {
    candidateCount: candidates.length,
    returnedCount: selected.length,
    duplicatesSuppressed: suppressed,
    hit: selected.length > 0,
    latencyMs: Date.now() - started,
    rawTokens,
    contextTokens,
    compressionRatio: rawTokens > 0 ? Number((contextTokens / rawTokens).toFixed(4)) : 1,
    freshnessScore: selected.length ? Number((selected.reduce((sum, item) => sum + item.freshness, 0) / selected.length).toFixed(4)) : 0,
    attributionCoverage: selected.length ? Number((attributed / selected.length).toFixed(4)) : 0,
    sources: [...new Set(selected.map((item) => item.source))],
  };

  let logId: string | undefined;
  if (input.persistLog !== false) {
    const log = await prisma.aIRetrievalLog.create({
      data: {
        businessId: input.businessId,
        runId: input.runId ?? null,
        conversationId: input.conversationId ?? null,
        customerId: input.customerId ?? null,
        phase: input.phase,
        query: input.query ?? null,
        candidateCount: metrics.candidateCount,
        returnedCount: metrics.returnedCount,
        duplicatesSuppressed: metrics.duplicatesSuppressed,
        hit: metrics.hit,
        latencyMs: metrics.latencyMs,
        rawTokens: metrics.rawTokens,
        contextTokens: metrics.contextTokens,
        compressionRatio: metrics.compressionRatio,
        freshnessScore: metrics.freshnessScore,
        attributionCoverage: metrics.attributionCoverage,
        sources: metrics.sources as never,
      },
    });
    logId = log.id;
  }

  // Mark stored records as accessed (best-effort, non-blocking on the hot path).
  const storedIds = selected.filter((item) => item.origin === "stored").map((item) => item.id);
  if (storedIds.length) {
    await prisma.aIMemoryRecord.updateMany({
      where: { id: { in: storedIds }, businessId: input.businessId },
      data: { lastAccessedAt: now, accessCount: { increment: 1 } },
    });
  }

  return { phase: input.phase, items: selected, metrics, logId };
}

/** Renders retrieved items into a compact, source-tagged block for a prompt/context. */
export function formatMemoryForContext(items: RetrievedItem[]): string {
  return items
    .map((item) => `- (${item.scope}/${item.kind}; source: ${item.source}${item.compressed ? "; compressed" : ""}) ${item.title ? `${item.title}: ` : ""}${item.content}`)
    .join("\n");
}
