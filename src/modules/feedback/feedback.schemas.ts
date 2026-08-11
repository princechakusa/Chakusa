import { z } from "zod";

export const createFeedbackSchema = z.object({
  customerId: z.string().uuid().optional(),
  reviewRequestId: z.string().uuid().optional(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().optional(),
});
export type CreateFeedbackInput = z.infer<typeof createFeedbackSchema>;

export const updateFeedbackStatusSchema = z.object({
  status: z.enum(["new", "acknowledged", "resolved"]),
});
export type UpdateFeedbackStatusInput = z.infer<typeof updateFeedbackStatusSchema>;
