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

/**
 * Ingestion contract for an automated recovery-source connector (currently:
 * the Android missed-call detector) — distinct from createLeadSchema, which
 * is the generic manual-entry API and has no phone/idempotency concept.
 * `clientEventId` must be generated once per real-world call event by the
 * connector and reused on every retry of that same event, never regenerated
 * per HTTP attempt — that's what makes offline-queue replay and network-
 * timeout retries safe against creating duplicate leads.
 */
export const reportMissedCallSchema = z.object({
  phone: z.string().min(1),
  occurredAt: z.coerce.date(),
  clientEventId: z.string().min(1).max(200),
});
export type ReportMissedCallInput = z.infer<typeof reportMissedCallSchema>;

export const updateLeadSchema = z.object({
  customerId: z.string().uuid().optional(),
  source: z.string().optional(),
  serviceRequested: z.string().optional(),
  urgency: z.enum(["low", "medium", "high"]).optional(),
  estimatedValue: z.coerce.number().nonnegative().optional(),
  notes: z.string().optional(),
});
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;

// Tracking only — see Lead.paymentStatus's schema comment. paidAmount is
// required once the business says anything was actually paid; it has no
// meaning attached to "unpaid" (explicitly nulled out in that case so a
// lead can't be flipped back to unpaid while a stale amount lingers).
export const updateLeadPaymentSchema = z
  .object({
    paymentStatus: z.enum(["unpaid", "partially_paid", "paid"]),
    paidAmount: z.coerce.number().nonnegative().optional(),
  })
  .refine((value) => value.paymentStatus === "unpaid" || value.paidAmount !== undefined, {
    message: "paidAmount is required when paymentStatus is partially_paid or paid",
    path: ["paidAmount"],
  });
export type UpdateLeadPaymentInput = z.infer<typeof updateLeadPaymentSchema>;

export const listLeadsQuerySchema = z.object({
  status: z.enum(["new", "contacted", "booked", "won", "lost"]).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
});
