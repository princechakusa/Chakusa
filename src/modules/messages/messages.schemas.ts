import { z } from "zod";

export const sendMessageSchema = z.object({
  customerId: z.string().uuid(),
  leadId: z.string().uuid().optional(),
  body: z.string().trim().min(1).max(1600),
  messageType: z
    .enum(["missed_call", "booking_confirmation", "review_request", "private_feedback", "comeback_reminder", "custom", "public_profile_inquiry"])
    .default("custom"),
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
