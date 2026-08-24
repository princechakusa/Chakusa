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

export const publicAvailabilitySchema = z.object({
  serviceOfferingId: z.string().uuid(),
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
}).refine(value => new Date(value.to) > new Date(value.from), { message: "to must be after from", path: ["to"] });

export const createPublicBookingSchema = z.object({
  serviceOfferingId: z.string().uuid(),
  assignedMemberId: z.string().uuid(),
  startsAt: z.string().datetime({ offset: true }),
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(1).max(50),
  email: z.string().trim().email().max(320).optional(),
  notes: z.string().trim().max(1000).optional(),
});
export type CreatePublicBookingInput = z.infer<typeof createPublicBookingSchema>;
