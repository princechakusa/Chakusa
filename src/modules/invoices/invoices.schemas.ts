import { z } from "zod";

// PROGRAM 3 / Invoicing I2: request validation for the BUSINESS draft +
// read Invoice API. Only DRAFT-stage operations exist here - no send, no
// void, no customer input, no payment fields. Every authoritative value
// (businessId, createdByMemberId, currency, invoiceNumber, status,
// totals, revision numbering, quote provenance) is resolved server-side
// and is deliberately absent from every schema below.

const MONEY = z
  .union([z.number(), z.string()])
  .refine((v) => Number.isFinite(typeof v === "string" ? Number(v) : v), "must be a finite number")
  .transform((v) => (typeof v === "string" ? v.trim() : v));
const QUANTITY = MONEY;

const MAX_LINE_ITEMS = 200;
const DESCRIPTION_MAX = 500;
const TEXT_MAX = 5_000;

export const invoiceLineItemSchema = z.object({
  serviceOfferingId: z.string().uuid().nullish(),
  description: z.string().trim().min(1).max(DESCRIPTION_MAX),
  quantity: QUANTITY,
  unitPrice: MONEY,
  discountAmount: MONEY.optional(),
  taxable: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
});

const originAssociations = {
  customerId: z.string().uuid().nullish(),
  customerProfileId: z.string().uuid().nullish(),
  appointmentId: z.string().uuid().nullish(),
};

const commercialContent = {
  lineItems: z.array(invoiceLineItemSchema).max(MAX_LINE_ITEMS).optional(),
  notes: z.string().trim().max(TEXT_MAX).nullish(),
  terms: z.string().trim().max(TEXT_MAX).nullish(),
  issueDate: z.coerce.date().nullish(),
  dueDate: z.coerce.date().nullish(),
  taxRatePercent: z
    .union([z.number(), z.string()])
    .refine((v) => Number.isFinite(typeof v === "string" ? Number(v) : v), "must be a finite number")
    .transform((v) => (typeof v === "string" ? v.trim() : v))
    .optional(),
};

export const createInvoiceSchema = z.object({ ...originAssociations, ...commercialContent });
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

export const updateInvoiceSchema = z.object({
  // Optimistic-concurrency guard: the revision the client last saw.
  expectedCurrentRevisionId: z.string().uuid(),
  ...originAssociations,
  ...commercialContent,
});
export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;

export const listInvoicesQuerySchema = z.object({
  status: z.enum(["DRAFT", "SENT", "VOID"]).optional(),
  customerId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
});
export type ListInvoicesQuery = z.infer<typeof listInvoicesQuerySchema>;

export const invoiceIdParamSchema = z.object({ id: z.string().uuid() });
