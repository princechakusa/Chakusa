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
