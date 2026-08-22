import { z } from "zod";

const templateTypeEnum = z.enum([
  "missed_call",
  "booking_confirmation",
  "review_request",
  "private_feedback",
  "comeback_reminder",
  "custom",
  "public_profile_inquiry",
]);

export const createTemplateSchema = z.object({
  templateType: templateTypeEnum,
  name: z.string().min(1),
  body: z.string().min(1),
  tone: z.enum(["friendly", "professional", "casual"]).default("friendly"),
  isDefault: z.boolean().default(false),
});
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;

export const updateTemplateSchema = createTemplateSchema.partial();
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;
