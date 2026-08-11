import { z } from "zod";

export const createReviewRequestSchema = z.object({
  customerId: z.string().uuid().optional(),
  serviceName: z.string().optional(),
  message: z.string().optional(),
});
export type CreateReviewRequestInput = z.infer<typeof createReviewRequestSchema>;

export const updateReviewRequestSchema = z.object({
  serviceName: z.string().optional(),
  message: z.string().optional(),
});
export type UpdateReviewRequestInput = z.infer<typeof updateReviewRequestSchema>;
