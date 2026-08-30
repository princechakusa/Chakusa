import { z } from "zod";

const triggerTypeEnum = z.enum([
  "LEAD_CREATED",
  "LEAD_FOLLOW_UP",
  "REVIEW_REQUEST_FOLLOW_UP",
  "CUSTOMER_RETENTION",
]);

const channelEnum = z.enum(["SMS", "WHATSAPP"]);

// Deliberately permissive at this layer — trigger-specific shape validation
// (e.g. LEAD_FOLLOW_UP requiring a leadStatuses array) happens in
// automation.service.ts, keyed off the already-validated triggerType, since
// Zod's discriminated unions would force config's shape into the wire
// schema even though the (currently nonexistent) worker is the only real
// consumer of that shape's runtime semantics.
const configSchema = z.record(z.string(), z.unknown()).default({});

export const createAutomationRuleSchema = z.object({
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean().default(false),
  triggerType: triggerTypeEnum,
  channel: channelEnum.default("SMS"),
  delaySeconds: z.number().int().min(0).max(2592000).default(0), // max 30 days
  config: configSchema,
});
export type CreateAutomationRuleInput = z.infer<typeof createAutomationRuleSchema>;

export const updateAutomationRuleSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  channel: channelEnum.optional(),
  delaySeconds: z.number().int().min(0).max(2592000).optional(),
  config: configSchema.optional(),
});
export type UpdateAutomationRuleInput = z.infer<typeof updateAutomationRuleSchema>;

const runStatusEnum = z.enum(["PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"]);

// Mirrors customers.schemas.ts / leads.schemas.ts's existing page/pageSize
// convention exactly — see automation.service.ts's listAutomationRunHistory.
export const listAutomationRunHistoryQuerySchema = z.object({
  status: runStatusEnum.optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
});
export type ListAutomationRunHistoryQuery = z.infer<typeof listAutomationRunHistoryQuerySchema>;

const workflowNodeSchema = z.object({ id: z.string().trim().min(1).max(100), type: z.enum(["condition","delay","action","branch"]), config: z.record(z.string(), z.unknown()), next: z.array(z.string().trim().min(1).max(100)).max(2).optional() });
export const workflowDefinitionSchema = z.object({ trigger: z.object({ type: z.string().trim().min(1).max(80), config: z.record(z.string(), z.unknown()).optional() }), nodes: z.array(workflowNodeSchema).min(1).max(250), startNodeId: z.string().trim().min(1).max(100).optional(), settings: z.object({ timeoutSeconds: z.number().int().min(1).max(31_536_000).optional(), maxRetries: z.number().int().min(0).max(20).optional() }).optional() });
export const createWorkflowSchema = z.object({ name: z.string().trim().min(1).max(120), description: z.string().trim().max(1000).optional(), definition: workflowDefinitionSchema });
export const createWorkflowVersionSchema = z.object({ definition: workflowDefinitionSchema });
export const publishWorkflowSchema = z.object({ version: z.number().int().positive().optional() });
export const manualWorkflowSchema = z.object({ input: z.record(z.string(), z.unknown()).default({}) });
export const workflowExecutionQuerySchema = z.object({ status: z.enum(["PENDING","RUNNING","PAUSED","COMPLETED","FAILED","CANCELLED"]).optional(), take: z.coerce.number().int().positive().max(100).default(50) });
export const workflowAnalyticsQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });
export const workflowExecutionActionSchema = z.enum(["pause", "resume", "cancel", "retry"]);
