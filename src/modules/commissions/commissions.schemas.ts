import { z } from "zod";

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");

export const upsertCommissionRuleSchema = z
  .object({
    businessMemberId: z.string().uuid(),
    serviceOfferingId: z.string().uuid().nullable().optional(),
    basis: z.enum(["PERCENT_OF_SERVICE_PRICE", "FIXED_PER_APPOINTMENT"]),
    ratePercent: z.number().min(0).max(100).optional(),
    fixedAmount: z.number().positive().max(99_999_999).optional(),
    fixedCurrency: z.string().trim().length(3).toUpperCase().optional(),
    active: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.basis === "PERCENT_OF_SERVICE_PRICE") {
      if (value.ratePercent === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ratePercent"], message: "ratePercent is required for a percentage rule" });
      if (value.fixedAmount !== undefined || value.fixedCurrency !== undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fixedAmount"], message: "fixedAmount / fixedCurrency do not apply to a percentage rule" });
    } else {
      if (value.fixedAmount === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fixedAmount"], message: "fixedAmount is required for a fixed rule" });
      if (value.fixedCurrency === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fixedCurrency"], message: "fixedCurrency is required for a fixed rule" });
      if (value.ratePercent !== undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ratePercent"], message: "ratePercent does not apply to a fixed rule" });
    }
  });

export const commissionReportQuerySchema = z
  .object({ from: dateOnly, to: dateOnly })
  .refine(v => v.to >= v.from, { path: ["to"], message: "to must be on or after from" });

export type UpsertCommissionRuleInput = z.infer<typeof upsertCommissionRuleSchema>;
export type CommissionReportQuery = z.infer<typeof commissionReportQuerySchema>;
