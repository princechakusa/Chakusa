import { z } from "zod";

export const createSupportTicketSchema = z.object({
  category: z.enum(["account", "billing", "booking", "messaging", "technical", "other"]),
  subject: z.string().trim().min(3).max(120),
  message: z.string().trim().min(10).max(4000),
});
export type CreateSupportTicketInput = z.infer<typeof createSupportTicketSchema>;
