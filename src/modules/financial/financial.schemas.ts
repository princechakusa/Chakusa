import { z } from "zod";

// PROGRAM 3 / Financial Management. Request validation for the
// BUSINESS-facing expense, category and mileage API. Every authoritative
// value (businessId, createdByMemberId, computed mileage amount, slug,
// timestamps, soft-delete state) is resolved server-side and is
// deliberately absent from every schema below.

const FINITE = (v: number | string) => Number.isFinite(typeof v === "string" ? Number(v) : v);

// Positive money, kept as a trimmed string so the service hands an exact
// value straight to Prisma.Decimal - never a float.
const MONEY_POSITIVE = z
  .union([z.number(), z.string()])
  .refine(FINITE, "must be a finite number")
  .transform((v) => (typeof v === "string" ? v.trim() : v))
  .refine((v) => Number(v) > 0, "must be greater than zero")
  .refine((v) => Number(v) <= 99_999_999, "is too large");

const MONEY_NON_NEGATIVE = z
  .union([z.number(), z.string()])
  .refine(FINITE, "must be a finite number")
  .transform((v) => (typeof v === "string" ? v.trim() : v))
  .refine((v) => Number(v) >= 0, "must not be negative")
  .refine((v) => Number(v) <= 99_999_999, "is too large");

const DISTANCE = z
  .union([z.number(), z.string()])
  .refine(FINITE, "must be a finite number")
  .transform((v) => (typeof v === "string" ? v.trim() : v))
  .refine((v) => Number(v) > 0, "must be greater than zero")
  .refine((v) => Number(v) <= 9_999_999, "is too large");

const CURRENCY = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{3}$/, "must be a 3-letter ISO currency code"));

const NAME_MAX = 60;
const TEXT_MAX = 500;

export const expensePaymentMethodSchema = z.enum([
  "cash",
  "card",
  "bank_transfer",
  "mobile_money",
  "cheque",
  "other",
]);

// --- categories -----------------------------------------------------------

export const createExpenseCategorySchema = z.object({
  name: z.string().trim().min(1).max(NAME_MAX),
});
export type CreateExpenseCategoryInput = z.infer<typeof createExpenseCategorySchema>;

export const updateExpenseCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(NAME_MAX).optional(),
    sortOrder: z.number().int().min(0).max(100_000).optional(),
    archived: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "at least one field is required");
export type UpdateExpenseCategoryInput = z.infer<typeof updateExpenseCategorySchema>;

export const listExpenseCategoriesQuerySchema = z.object({
  includeArchived: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .optional()
    .transform((v) => v === true || v === "true"),
});
export type ListExpenseCategoriesQuery = z.infer<typeof listExpenseCategoriesQuerySchema>;

// --- expenses -----------------------------------------------------------

const expenseLinks = {
  categoryId: z.string().uuid().nullish(),
  appointmentId: z.string().uuid().nullish(),
  customerId: z.string().uuid().nullish(),
};

export const createExpenseSchema = z.object({
  amount: MONEY_POSITIVE,
  currency: CURRENCY,
  spentAt: z.coerce.date(),
  vendor: z.string().trim().max(NAME_MAX).nullish(),
  description: z.string().trim().max(TEXT_MAX).nullish(),
  reference: z.string().trim().max(NAME_MAX).nullish(),
  paymentMethod: expensePaymentMethodSchema.nullish(),
  ...expenseLinks,
});
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

export const updateExpenseSchema = z
  .object({
    amount: MONEY_POSITIVE.optional(),
    currency: CURRENCY.optional(),
    spentAt: z.coerce.date().optional(),
    vendor: z.string().trim().max(NAME_MAX).nullish(),
    description: z.string().trim().max(TEXT_MAX).nullish(),
    reference: z.string().trim().max(NAME_MAX).nullish(),
    paymentMethod: expensePaymentMethodSchema.nullish(),
    ...expenseLinks,
  })
  .refine((v) => Object.keys(v).length > 0, "at least one field is required");
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;

export const listExpensesQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  categoryId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
});
export type ListExpensesQuery = z.infer<typeof listExpensesQuerySchema>;

// --- mileage -----------------------------------------------------------

export const createMileageTripSchema = z.object({
  tripDate: z.coerce.date(),
  distance: DISTANCE,
  unit: z.enum(["mi", "km"]).default("mi"),
  ratePerUnit: MONEY_NON_NEGATIVE.nullish(),
  currency: CURRENCY.nullish(),
  purpose: z.string().trim().max(TEXT_MAX).nullish(),
  fromLabel: z.string().trim().max(NAME_MAX).nullish(),
  toLabel: z.string().trim().max(NAME_MAX).nullish(),
  appointmentId: z.string().uuid().nullish(),
  customerId: z.string().uuid().nullish(),
});
export type CreateMileageTripInput = z.infer<typeof createMileageTripSchema>;

export const updateMileageTripSchema = z
  .object({
    tripDate: z.coerce.date().optional(),
    distance: DISTANCE.optional(),
    unit: z.enum(["mi", "km"]).optional(),
    ratePerUnit: MONEY_NON_NEGATIVE.nullish(),
    currency: CURRENCY.nullish(),
    purpose: z.string().trim().max(TEXT_MAX).nullish(),
    fromLabel: z.string().trim().max(NAME_MAX).nullish(),
    toLabel: z.string().trim().max(NAME_MAX).nullish(),
    appointmentId: z.string().uuid().nullish(),
    customerId: z.string().uuid().nullish(),
  })
  .refine((v) => Object.keys(v).length > 0, "at least one field is required");
export type UpdateMileageTripInput = z.infer<typeof updateMileageTripSchema>;

export const listMileageTripsQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
});
export type ListMileageTripsQuery = z.infer<typeof listMileageTripsQuerySchema>;

// --- summary -----------------------------------------------------------

export const financialSummaryQuerySchema = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date(),
  })
  .refine((v) => v.from <= v.to, "from must be on or before to");
export type FinancialSummaryQuery = z.infer<typeof financialSummaryQuerySchema>;

export const idParamSchema = z.object({ id: z.string().uuid() });
