import { z } from "zod";

export const sendMessageSchema = z.object({
  customerId: z.string().uuid(),
  leadId: z.string().uuid().optional(),
  body: z.string().trim().min(1).max(1600),
  channel: z.enum(["sms", "whatsapp"]).default("sms"),
  purpose: z.enum(["SERVICE", "TRANSACTIONAL", "MARKETING"]).default("SERVICE"),
  idempotencyKey: z.string().trim().min(8).max(200).optional(),
  messageType: z
    .enum(["missed_call", "booking_confirmation", "review_request", "private_feedback", "comeback_reminder", "custom", "public_profile_inquiry", "lead_follow_up"])
    .default("custom"),
});
export type SendMessageInput = z.input<typeof sendMessageSchema>;
