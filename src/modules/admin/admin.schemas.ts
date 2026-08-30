import { z } from "zod";

export const adminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(1_000),
});

export const adminSessionParamsSchema = z.object({ id: z.string().uuid() });

export const adminCsrfHeaderSchema = z.string().min(32).max(256);

export const adminBusinessConfirmationSchema = z.object({
  confirmation: z.string().min(1).max(200),
});
export const adminBusinessCohortSchema = z.object({ cohort: z.string().trim().max(80).nullable() });
export const adminFeedbackUpdateSchema = z.object({ status: z.enum(["OPEN", "IN_REVIEW", "RESOLVED", "CLOSED"]), internalNotes: z.string().trim().max(4000).nullable().optional() });

export const adminBusinessSuspensionSchema = adminBusinessConfirmationSchema.extend({
  reason: z.string().trim().min(10).max(500),
});

export const adminBusinessDeletionSchema = adminBusinessConfirmationSchema.extend({
  reason: z.string().trim().min(10).max(500),
});

export const adminUserConfirmationSchema = z.object({
  confirmation: z.string().email(),
});

export const adminUserStatusSchema = adminUserConfirmationSchema.extend({
  status: z.enum(["ACTIVE", "DISABLED"]),
});

export const adminRevokeSessionSchema = z.object({
  confirmation: z.literal("REVOKE"),
});

export const adminAutomationRetrySchema = z.object({
  confirmation: z.literal("RETRY"),
});

export const adminSettingUpdateSchema = z.object({
  key: z.enum(["maintenance_mode", "automation_enabled", "communications_enabled", "support_read_only_impersonation", "ai_enabled", "messaging_enabled", "providers_enabled", "conversations_enabled"]),
  enabled: z.boolean(),
});

export const adminRoleSchema = z.enum([
  "SUPER_ADMIN",
  "PLATFORM_ADMIN",
  "SUPPORT_AGENT",
  "FINANCE",
  "OPERATIONS",
  "READ_ONLY",
]);

export const adminMembershipStatusSchema = z.enum(["ACTIVE", "SUSPENDED"]);

export const adminAccessGrantSchema = z.object({
  role: adminRoleSchema,
  confirmation: z.string().email(),
});

export const adminAccessUpdateSchema = z.object({
  role: adminRoleSchema.optional(),
  status: adminMembershipStatusSchema.optional(),
  confirmation: z.string().email(),
}).refine((value) => value.role !== undefined || value.status !== undefined, {
  message: "A role or status change is required",
});
