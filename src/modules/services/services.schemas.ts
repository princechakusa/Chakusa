import { z } from "zod";

const money = z.number().nonnegative().max(99_999_999);
const serviceFields = {
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  category: z.string().trim().min(1).max(80).nullable().optional(),
  durationMinutes: z.number().int().min(5).max(1_440),
  preparationMinutes: z.number().int().min(0).max(240).default(0),
  cleanupMinutes: z.number().int().min(0).max(240).default(0),
  price: money.nullable().optional(),
  depositAmount: money.nullable().optional(),
  active: z.boolean().default(true),
  publiclyBookable: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  memberIds: z.array(z.string().uuid()).max(100).default([]),
};

function depositDoesNotExceedPrice(value: { price?: number | null; depositAmount?: number | null }) {
  return value.price == null || value.depositAmount == null || value.depositAmount <= value.price;
}

export const createServiceOfferingSchema = z.object(serviceFields).refine(depositDoesNotExceedPrice, { message: "depositAmount cannot exceed price", path: ["depositAmount"] });
export const updateServiceOfferingSchema = z.object({
  name: serviceFields.name.optional(), description: serviceFields.description, category: serviceFields.category,
  durationMinutes: serviceFields.durationMinutes.optional(), preparationMinutes: serviceFields.preparationMinutes.optional(), cleanupMinutes: serviceFields.cleanupMinutes.optional(),
  price: serviceFields.price, depositAmount: serviceFields.depositAmount, active: serviceFields.active.optional(), publiclyBookable: serviceFields.publiclyBookable.optional(), sortOrder: serviceFields.sortOrder.optional(), memberIds: serviceFields.memberIds.optional(),
}).refine(depositDoesNotExceedPrice, { message: "depositAmount cannot exceed price", path: ["depositAmount"] });
export const listServiceOfferingsSchema = z.object({ active: z.enum(["true", "false"]).transform(value => value === "true").optional() });

export type CreateServiceOfferingInput = z.infer<typeof createServiceOfferingSchema>;
export type UpdateServiceOfferingInput = z.infer<typeof updateServiceOfferingSchema>;
