import { z } from "zod";

const pagination = {
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
};

export const adminDashboardQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(365).default(30),
});

export const adminBusinessListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  plan: z.enum(["FREE", "PRO", "BUSINESS"]).optional(),
  subscriptionStatus: z.enum(["ACTIVE", "TRIALING", "GRACE_PERIOD", "EXPIRED", "CANCELED"]).optional(),
  sort: z.enum(["newest", "oldest", "name"]).default("newest"),
  ...pagination,
});

export const adminUserListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  adminOnly: z.coerce.boolean().optional(),
  sort: z.enum(["newest", "oldest", "name"]).default("newest"),
  ...pagination,
});

export const adminSubscriptionListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  plan: z.enum(["FREE", "PRO", "BUSINESS"]).optional(),
  status: z.enum(["ACTIVE", "TRIALING", "GRACE_PERIOD", "EXPIRED", "CANCELED"]).optional(),
  ...pagination,
});

export const adminAutomationListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(["PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"]).optional(),
  ...pagination,
});

export const adminCommunicationListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(["draft", "copied", "sent", "delivered", "failed", "undelivered"]).optional(),
  ...pagination,
});

export const adminSupportListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(["open", "in_progress", "resolved", "closed"]).optional(),
  ...pagination,
});

export const adminAuditListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  action: z.string().trim().max(120).optional(),
  targetType: z.string().trim().max(120).optional(),
  ...pagination,
});

export const adminIdParamsSchema = z.object({ id: z.string().uuid() });

export type AdminDashboardQuery = z.infer<typeof adminDashboardQuerySchema>;
export type AdminBusinessListQuery = z.infer<typeof adminBusinessListQuerySchema>;
export type AdminUserListQuery = z.infer<typeof adminUserListQuerySchema>;
export type AdminSubscriptionListQuery = z.infer<typeof adminSubscriptionListQuerySchema>;
export type AdminAutomationListQuery = z.infer<typeof adminAutomationListQuerySchema>;
export type AdminCommunicationListQuery = z.infer<typeof adminCommunicationListQuerySchema>;
export type AdminSupportListQuery = z.infer<typeof adminSupportListQuerySchema>;
export type AdminAuditListQuery = z.infer<typeof adminAuditListQuerySchema>;
