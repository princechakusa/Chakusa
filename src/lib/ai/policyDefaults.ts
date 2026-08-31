import { z } from "zod";

export const AI_MODES = ["DRAFT", "APPROVAL", "AUTONOMOUS"] as const;
export type AIMode = (typeof AI_MODES)[number];

export const POLICY_EFFECTS = ["ALLOW", "REQUIRE_APPROVAL", "ESCALATE", "DENY"] as const;
export type PolicyEffect = (typeof POLICY_EFFECTS)[number];

export const POLICY_CHECKPOINTS = ["INVOCATION", "TOOL_EXECUTION", "CUSTOMER_RESPONSE", "WORKFLOW_EXECUTION"] as const;
export type PolicyCheckpoint = (typeof POLICY_CHECKPOINTS)[number];

export const APPROVAL_ACTIONS = [
  "reply",
  "tool_call",
  "quote",
  "payment",
  "appointment_modification",
  "customer_update",
  "workflow_launch",
] as const;

export const APPROVAL_STRATEGIES = ["NONE", "ANY_OWNER", "ANY_ADMIN", "SPECIFIC_USER", "TWO_PERSON"] as const;
export type ApprovalStrategy = (typeof APPROVAL_STRATEGIES)[number];

export const RULE_CATEGORIES = ["APPROVAL", "TOOL"] as const;

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM");

export const confidencePolicySchema = z.object({
  respondMin: z.number().min(0).max(1).default(0.4),
  toolMin: z.number().min(0).max(1).default(0.7),
  autonomousMin: z.number().min(0).max(1).default(0.85),
  escalateBelow: z.number().min(0).max(1).default(0.25),
});

export const businessPolicySchema = z.object({
  respectBusinessHours: z.boolean().default(false),
  quietHours: z.object({ start: timeOfDay, end: timeOfDay }).nullable().default(null),
  allowedChannels: z.array(z.string()).default(["sms", "whatsapp", "email"]),
  blockedTopics: z.array(z.string()).default([]),
  restrictedIndustries: z.array(z.string()).default([]),
  communicationRestrictions: z.array(z.string()).default([]),
  maxAutonomousActionsPerRun: z.number().int().min(0).default(3),
});

export const customerPolicySchema = z.object({
  requireConsentForMarketing: z.boolean().default(true),
  respectOptOut: z.boolean().default(true),
  respectSuppressions: z.boolean().default(true),
  respectPreferredChannel: z.boolean().default(true),
  respectPreferredLanguage: z.boolean().default(true),
});

export const safetyPolicySchema = z.object({
  blockPromptInjection: z.boolean().default(true),
  blockPiiInOutput: z.boolean().default(true),
  blockDataLeakage: z.boolean().default(true),
  blockUnsafeOutput: z.boolean().default(true),
  enforceTenantIsolation: z.boolean().default(true),
});

export const policyDocumentSchema = z.object({
  confidence: confidencePolicySchema.default({}),
  business: businessPolicySchema.default({}),
  customer: customerPolicySchema.default({}),
  safety: safetyPolicySchema.default({}),
});
export type PolicyDocument = z.infer<typeof policyDocumentSchema>;

/** The document a business gets before it has configured anything. */
export const DEFAULT_POLICY_DOCUMENT: PolicyDocument = policyDocumentSchema.parse({});
export const DEFAULT_MODE: AIMode = "DRAFT";

export interface EvaluableRule {
  category: (typeof RULE_CATEGORIES)[number];
  action: string;
  toolName: string | null;
  workflowId: string | null;
  effect: PolicyEffect;
  strategy: ApprovalStrategy;
  approverUserId: string | null;
  minConfidence: number | null;
}

/**
 * Rules in force when a business has never configured a policy: nothing that
 * touches money is allowed, and every other outward action needs a human.
 */
export const DEFAULT_RULES: EvaluableRule[] = APPROVAL_ACTIONS.map((action) => ({
  category: "APPROVAL",
  action,
  toolName: null,
  workflowId: null,
  effect: action === "payment" ? "DENY" : "REQUIRE_APPROVAL",
  strategy: "ANY_OWNER",
  approverUserId: null,
  minConfidence: null,
}));

export const ruleInputSchema = z.object({
  category: z.enum(RULE_CATEGORIES),
  action: z.string().trim().min(1).max(120),
  toolName: z.string().trim().max(120).nullish(),
  workflowId: z.string().uuid().nullish(),
  effect: z.enum(POLICY_EFFECTS),
  strategy: z.enum(APPROVAL_STRATEGIES).default("ANY_OWNER"),
  approverUserId: z.string().uuid().nullish(),
  minConfidence: z.number().min(0).max(1).nullish(),
  note: z.string().trim().max(500).nullish(),
});
export type RuleInput = z.infer<typeof ruleInputSchema>;
