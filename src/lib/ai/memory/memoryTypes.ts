export const MEMORY_SCOPES = ["SESSION", "CONVERSATION", "CUSTOMER", "BUSINESS", "LONG_TERM"] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

export const RETRIEVAL_PHASES = ["INTENT", "PLANNING", "TOOL_SELECTION", "RESPONSE"] as const;
export type RetrievalPhase = (typeof RETRIEVAL_PHASES)[number];

/** A single unit of context. `source` is mandatory — nothing is retrieved anonymously. */
export interface MemoryItem {
  id: string;
  scope: MemoryScope;
  kind: string;
  title?: string | null;
  content: string;
  source: string;
  sourceRef?: string | null;
  importance: number;
  pinned: boolean;
  confidence?: number | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date | null;
  data?: unknown;
  origin: "stored" | "derived" | "session";
}

export interface RetrievedItem extends MemoryItem {
  score: number;
  recencyWeight: number;
  freshness: number;
  relevance: number;
  tokens: number;
  compressed: boolean;
}

export interface RetrievalMetrics {
  candidateCount: number;
  returnedCount: number;
  duplicatesSuppressed: number;
  hit: boolean;
  latencyMs: number;
  rawTokens: number;
  contextTokens: number;
  compressionRatio: number;
  freshnessScore: number;
  attributionCoverage: number;
  sources: string[];
}

export interface RetrievalResult {
  phase: RetrievalPhase;
  items: RetrievedItem[];
  metrics: RetrievalMetrics;
  logId?: string;
}

/** ~4 chars per token — good enough for context-window budgeting. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function normalizeForDedup(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

export function wordSet(text: string): Set<string> {
  return new Set(normalizeForDedup(text).split(" ").filter((word) => word.length > 2));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  return intersection / (a.size + b.size - intersection || 1);
}
