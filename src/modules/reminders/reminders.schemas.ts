import { z } from "zod";

export const createReminderSchema = z.object({
  customerId: z.string().uuid().optional(),
  serviceName: z.string().optional(),
  lastVisitDate: z.coerce.date().optional(),
  dueDate: z.coerce.date().optional(),
});
export type CreateReminderInput = z.infer<typeof createReminderSchema>;

export const updateReminderSchema = z.object({
  serviceName: z.string().optional(),
  lastVisitDate: z.coerce.date().optional(),
  dueDate: z.coerce.date().optional(),
  status: z.enum(["due", "sent", "completed", "dismissed"]).optional(),
});
export type UpdateReminderInput = z.infer<typeof updateReminderSchema>;
