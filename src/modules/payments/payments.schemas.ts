import { z } from "zod";
export const paymentLinkSchema = z.object({ kind: z.enum(["deposit", "balance", "full"]) });
export const refundSchema = z.object({ amount: z.number().positive().max(99_999_999).optional() });
