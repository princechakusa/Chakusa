import { z } from "zod";

export const createCustomerSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  notes: z.string().optional(),
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
        name: z.string().trim().min(1),
        phone: z.string().trim().optional(),
        email: z.string().trim().email().optional().or(z.literal("").transform(() => undefined)),
        notes: z.string().trim().optional(),
      }),
    )
    .min(1)
    .max(500, "Import is limited to 500 customers at a time"),
});
export type BulkImportCustomersInput = z.infer<typeof bulkImportCustomersSchema>;

export const listCustomersQuerySchema = z.object({
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
});

export const customerTagSchema = z.object({ name: z.string().trim().min(1).max(40) });
export const customerTagAssignmentsSchema = z.object({ tagIds: z.array(z.string().uuid()).max(30) });
