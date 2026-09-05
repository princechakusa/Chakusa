import { z } from "zod";

// PROGRAM 3 LOOP 3B: request validation for the BUSINESS draft + read
// Quotes/Estimates API. Only DRAFT-stage operations exist here — no send,
// no revisioning of sent documents, no customer-facing input. Every
// authoritative value (businessId, createdByMemberId, currency,
// documentNumber, status, totals, revision numbering) is resolved
// server-side and is deliberately absent from every schema below.

const MONEY = z
  .union([z.number(), z.string()])
  .refine((v) => {
    const n = typeof v === "string" ? Number(v) : v;
    return Number.isFinite(n);
  }, "must be a finite number")
  .transform((v) => (typeof v === "string" ? v.trim() : v));

const QUANTITY = MONEY; // same "finite numeric" guard; domain layer enforces > 0

const MAX_LINE_ITEMS = 200;
const DESCRIPTION_MAX = 500;
const TEXT_MAX = 5_000;

export const quoteLineItemSchema = z.object({
  // Provenance only. Ownership is verified server-side; a value here never
  // makes the server trust a price — description/unitPrice below are always
  // the authoritative, snapshotted values.
  serviceOfferingId: z.string().uuid().nullish(),
  description: z.string().trim().min(1).max(DESCRIPTION_MAX),
  quantity: QUANTITY,
  unitPrice: MONEY,
  discountAmount: MONEY.optional(),
  taxable: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
});

const originAssociations = {
  leadId: z.string().uuid().nullish(),
  customerId: z.string().uuid().nullish(),
  customerProfileId: z.string().uuid().nullish(),
  appointmentId: z.string().uuid().nullish(),
};

const commercialContent = {
  lineItems: z.array(quoteLineItemSchema).max(MAX_LINE_ITEMS).optional(),
  notes: z.string().trim().max(TEXT_MAX).nullish(),
  terms: z.string().trim().max(TEXT_MAX).nullish(),
  expiresAt: z.coerce.date().nullish(),
  // A single explicit rate applied uniformly to taxable lines — NOT a
  // jurisdiction-aware tax engine (see quotes.domain.ts). 0 is valid; the
  // domain layer enforces the 0-100 bound. Rejected here only if it is not
  // a finite number, so Prisma.Decimal never receives garbage.
  taxRatePercent: z
    .union([z.number(), z.string()])
    .refine((v) => Number.isFinite(typeof v === "string" ? Number(v) : v), "must be a finite number")
    .transform((v) => (typeof v === "string" ? v.trim() : v))
    .optional(),
};

export const createQuoteSchema = z.object({
  documentType: z.enum(["ESTIMATE", "QUOTE"]),
  ...originAssociations,
  ...commercialContent,
});
export type CreateQuoteInput = z.infer<typeof createQuoteSchema>;

// documentType is deliberately ABSENT — it is immutable after creation
// because the document-number sequence is per-type (see the module doc
// comment and Loop 3B spec §15). A future explicit "convert estimate to
// quote" workflow will handle that.
export const updateQuoteSchema = z.object({
  // Optimistic-concurrency guard: the revision the client last saw. A
  // stale value means someone else edited the draft first — the edit is
  // rejected rather than silently clobbering the newer content.
  expectedCurrentRevisionId: z.string().uuid(),
  ...originAssociations,
  ...commercialContent,
});
export type UpdateQuoteInput = z.infer<typeof updateQuoteSchema>;

export const listQuotesQuerySchema = z.object({
  documentType: z.enum(["ESTIMATE", "QUOTE"]).optional(),
  status: z.enum(["DRAFT", "SENT", "ACCEPTED", "DECLINED", "CANCELED", "EXPIRED"]).optional(),
  customerId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
});
export type ListQuotesQuery = z.infer<typeof listQuotesQuerySchema>;

export const quoteIdParamSchema = z.object({ id: z.string().uuid() });

// PROGRAM 3 LOOP 3C: DRAFT -> SENT. Body is optional; the only accepted
// field is the same optimistic-concurrency guard used by the edit
// endpoint. When present it must equal the document's current revision at
// transition time, so a business that edited the draft in another tab
// cannot send the stale revision it was looking at. When absent, the send
// binds to whatever revision is current-and-valid inside the
// transaction. No commercial content, no businessId, no token input -
// everything authoritative is resolved/generated server-side.
export const sendQuoteSchema = z.object({
  expectedCurrentRevisionId: z.string().uuid().optional(),
});
export type SendQuoteInput = z.infer<typeof sendQuoteSchema>;
