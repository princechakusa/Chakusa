import { z } from "zod";

export const submitPublicFeedbackSchema = z.object({
  rating: z.number().int().min(1).max(5),
  // Empty/whitespace-only input is treated as "no comment" rather than a
  // meaningless empty string being stored — matches how a customer leaving
  // the comment box blank should read once it reaches the business owner.
  comment: z
    .string()
    .trim()
    .max(2000, "Comment must be 2000 characters or fewer")
    .optional()
    .transform((value) => (value ? value : undefined)),
});
export type SubmitPublicFeedbackInput = z.infer<typeof submitPublicFeedbackSchema>;

export const submitPublicContactSchema = z.object({
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(1).max(50),
  serviceRequested: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value) => (value ? value : undefined)),
  message: z
    .string()
    .trim()
    .max(2000, "Message must be 2000 characters or fewer")
    .optional()
    .transform((value) => (value ? value : undefined)),
});
export type SubmitPublicContactInput = z.infer<typeof submitPublicContactSchema>;
