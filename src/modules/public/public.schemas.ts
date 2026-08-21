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
  // Referral-program attribution only (see Lead.referredByCustomerId's
  // schema comment) — the customer id embedded in the referrer's personal
  // share link (?ref=). Malformed/unknown/foreign-business values are
  // silently ignored rather than rejecting the submission (see
  // publicBusinessProfile.service.ts): a stale or tampered ref must never
  // block a legitimate contact-form submission.
  ref: z.string().optional(),
});
export type SubmitPublicContactInput = z.infer<typeof submitPublicContactSchema>;
