import { z } from "zod";

// Length caps bound what any client (mobile, web, import) can store per
// customer; they are generous enough for every real value.
export const createCustomerSchema = z.object({
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().max(254).email().optional(),
  notes: z.string().max(5_000).optional(),
  birthday: z.coerce.date().optional(),
  anniversary: z.coerce.date().optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

export const updateCustomerSchema = createCustomerSchema.partial();
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

// A single "bring your existing customer list" import — CSV/paste-in
// parsed client-side into rows, never a raw file upload. Deliberately does
// not touch device contacts (see src/modules/customers/customers.service.ts's
// bulkImportCustomers doc comment for why): this is the only bulk-onboarding
// path Chakusa offers.
export const bulkImportCustomersSchema = z.object({
  customers: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        phone: z.string().trim().max(40).optional(),
        email: z.string().trim().max(254).email().optional().or(z.literal("").transform(() => undefined)),
        notes: z.string().trim().max(5_000).optional(),
      }),
    )
    .min(1)
    .max(500, "Import is limited to 500 customers at a time"),
});
export type BulkImportCustomersInput = z.infer<typeof bulkImportCustomersSchema>;
export const customerCsvPreviewSchema = z.object({ csv: z.string().min(1).max(1_000_000) });

export const listCustomersQuerySchema = z.object({
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
});

export const customerTagSchema = z.object({ name: z.string().trim().min(1).max(40) });
export const customerTagAssignmentsSchema = z.object({ tagIds: z.array(z.string().uuid()).max(30) });
