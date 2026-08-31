import { z } from "zod";
import { AI_METRICS } from "../../lib/ai/ops/aiMetrics.js";
import { EVALUATION_CATEGORIES } from "../../lib/ai/ops/evaluationHarness.js";
import { AI_OUTCOME_TYPES } from "../../lib/ai/ops/aiAnalytics.js";

const sinceHours = z.coerce.number().int().min(1).max(2160).default(168);

export const windowQuerySchema = z.object({ sinceHours });

export const trendQuerySchema = z.object({
  metric: z.enum(AI_METRICS),
  sinceHours,
  bucket: z.enum(["hour", "day"]).default("hour"),
  provider: z.string().trim().max(60).optional(),
});

export const createSuiteSchema = z.object({
  key: z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9_.-]+$/),
  name: z.string().trim().min(1).max(160),
  category: z.enum(EVALUATION_CATEGORIES),
  description: z.string().trim().max(2000).nullish(),
});

export const addCaseSchema = z.object({
  name: z.string().trim().min(1).max(160),
  input: z.record(z.string(), z.unknown()),
  expected: z.record(z.string(), z.unknown()),
  locale: z.string().trim().min(2).max(20).nullish(),
  weight: z.number().min(0).max(100).default(1),
  promptTemplateKey: z.string().trim().max(120).nullish(),
  tags: z.array(z.string().trim().max(60)).max(20).optional(),
});

export const runSuiteSchema = z.object({
  promptVersionId: z.string().uuid().nullish(),
  compareToRunId: z.string().uuid().nullish(),
  label: z.string().trim().max(120).nullish(),
});

export const compareRunsSchema = z.object({
  runIdA: z.string().uuid(),
  runIdB: z.string().uuid(),
});

export const runListQuerySchema = z.object({
  status: z.string().trim().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const approveRunSchema = z.object({
  attributeOutcome: z
    .object({
      outcomeType: z.enum(AI_OUTCOME_TYPES),
      outcomeId: z.string().trim().min(1).max(200),
      amount: z.number().nonnegative().optional(),
      currency: z.string().trim().max(8).optional(),
    })
    .optional(),
});
