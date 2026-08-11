import { z } from "zod";

export const updateBusinessSchema = z.object({
  name: z.string().min(1).optional(),
  industry: z.string().optional(),
  phone: z.string().optional(),
  googleReviewLink: z.string().url().optional(),
  workingHours: z.record(z.string(), z.unknown()).optional(),
  defaultServices: z.array(z.string()).optional(),
  reminderDays: z.number().int().positive().optional(),
  preferredTone: z.enum(["friendly", "professional", "casual"]).optional(),
});
export type UpdateBusinessInput = z.infer<typeof updateBusinessSchema>;

export const createBusinessSchema = z.object({
  name: z.string().min(1),
  industry: z.string().optional(),
  phone: z.string().optional(),
});
export type CreateBusinessInput = z.infer<typeof createBusinessSchema>;
