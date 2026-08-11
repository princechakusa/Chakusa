import { z } from "zod";

export const createLeadSchema = z.object({
  customerId: z.string().uuid().optional(),
  source: z.string().optional(),
  missedCallTime: z.coerce.date().optional(),
  serviceRequested: z.string().optional(),
  urgency: z.enum(["low", "medium", "high"]).default("medium"),
  estimatedValue: z.coerce.number().nonnegative().optional(),
  notes: z.string().optional(),
});
export type CreateLeadInput = z.infer<typeof createLeadSchema>;

export const updateLeadSchema = z.object({
  customerId: z.string().uuid().optional(),
  source: z.string().optional(),
  serviceRequested: z.string().optional(),
  urgency: z.enum(["low", "medium", "high"]).optional(),
  estimatedValue: z.coerce.number().nonnegative().optional(),
  notes: z.string().optional(),
  status: z.enum(["new", "contacted", "booked", "won", "lost"]).optional(),
});
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;

export const listLeadsQuerySchema = z.object({
  status: z.enum(["new", "contacted", "booked", "won", "lost"]).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
});
