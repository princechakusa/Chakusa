import { z } from "zod";

export const listAttentionItemsQuerySchema = z.object({
  category: z.enum(["missed_call_followup", "customer_due", "review_opportunity"]).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
});
export type ListAttentionItemsQuery = z.infer<typeof listAttentionItemsQuerySchema>;
