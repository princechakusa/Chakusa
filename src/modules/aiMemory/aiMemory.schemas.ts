import { z } from "zod";
import { MEMORY_SCOPES, RETRIEVAL_PHASES } from "../../lib/ai/memory/memoryTypes.js";

export const createRecordSchema = z.object({
  scope: z.enum(MEMORY_SCOPES),
  kind: z.string().trim().min(1).max(60),
  title: z.string().trim().max(200).nullish(),
  content: z.string().trim().min(1).max(8000),
  data: z.unknown().optional(),
  customerId: z.string().uuid().nullish(),
  conversationId: z.string().uuid().nullish(),
  subjectType: z.string().trim().max(40).nullish(),
  subjectId: z.string().trim().max(120).nullish(),
  source: z.string().trim().min(1).max(120).default("manual"),
  sourceRef: z.string().trim().max(200).nullish(),
  confidence: z.number().min(0).max(1).nullish(),
  importance: z.number().min(0).max(1).default(0.6),
  pinned: z.boolean().default(false),
  ttlMinutes: z.number().int().positive().max(525600).nullish(),
});

export const updateRecordSchema = z.object({
  content: z.string().trim().min(1).max(8000).optional(),
  title: z.string().trim().max(200).nullish(),
  data: z.unknown().optional(),
  importance: z.number().min(0).max(1).optional(),
  pinned: z.boolean().optional(),
  confidence: z.number().min(0).max(1).nullish(),
  ttlMinutes: z.number().int().positive().max(525600).nullish(),
});

export const retrieveSchema = z.object({
  phase: z.enum(RETRIEVAL_PHASES),
  customerId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  runId: z.string().uuid().optional(),
  query: z.string().trim().max(2000).optional(),
  tokenBudget: z.number().int().min(64).max(8000).optional(),
  maxItems: z.number().int().min(1).max(100).optional(),
});

export const monitoringQuerySchema = z.object({
  sinceHours: z.coerce.number().int().min(1).max(720).default(168),
});
