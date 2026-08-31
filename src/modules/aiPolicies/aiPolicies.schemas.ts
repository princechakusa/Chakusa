import { z } from "zod";
import { policyDocumentSchema, ruleInputSchema, AI_MODES, POLICY_CHECKPOINTS } from "../../lib/ai/policyDefaults.js";

export const saveDraftSchema = z.object({
  mode: z.enum(AI_MODES).optional(),
  document: policyDocumentSchema,
});

export const rulesSchema = z.object({
  rules: z.array(ruleInputSchema).max(200),
});

export const activateSchema = z.object({
  version: z.number().int().positive().optional(),
});

export const evaluateSchema = z.object({
  checkpoint: z.enum(POLICY_CHECKPOINTS),
  action: z.string().trim().min(1).max(120),
  toolName: z.string().trim().max(120).optional(),
  workflowId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  runId: z.string().uuid().optional(),
  confidence: z.number().min(0).max(1).optional(),
  channel: z.string().trim().max(40).optional(),
  purpose: z.string().trim().max(40).optional(),
  topics: z.array(z.string().trim().max(80)).max(50).optional(),
  promptText: z.string().max(20000).optional(),
  outputText: z.string().max(20000).optional(),
});

export const decisionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
