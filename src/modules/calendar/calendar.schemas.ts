import { z } from "zod";

export const createCalendarSubscriptionSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
});

export type CreateCalendarSubscriptionInput = z.infer<typeof createCalendarSubscriptionSchema>;
