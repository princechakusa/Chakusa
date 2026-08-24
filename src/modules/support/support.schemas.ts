import { z } from "zod";

export const createSupportTicketSchema = z.object({
  category: z.enum(["account", "billing", "booking", "messaging", "technical", "other"]),
  subject: z.string().trim().min(3).max(120),
  message: z.string().trim().min(10).max(4000),
});
export type CreateSupportTicketInput = z.infer<typeof createSupportTicketSchema>;

export const createBetaFeedbackSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  category: z.enum(["BUG", "PERFORMANCE", "BOOKING", "PAYMENTS", "AUTOMATION", "REPORTING", "UX", "OTHER"]),
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(10).max(4000),
  appVersion: z.string().trim().max(80).optional(),
  platform: z.enum(["Android", "iOS", "Web"]).optional(),
  deviceModel: z.string().trim().max(160).optional(),
  buildNumber: z.string().trim().max(80).optional(),
  screenshotUrl: z.string().url().max(2_000).optional(),
});
export type CreateBetaFeedbackInput = z.infer<typeof createBetaFeedbackSchema>;
