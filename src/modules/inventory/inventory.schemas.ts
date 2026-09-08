import { z } from "zod";

const qty = z.number().nonnegative().max(1_000_000_000);
const positiveQty = z.number().positive().max(1_000_000_000);

export const MOVEMENT_KINDS = ["OPENING", "RECEIVE", "RESTOCK", "CONSUME", "SERVICE_USE", "WASTE", "ADJUST", "CORRECTION"] as const;
// Kinds a route may accept from a client. OPENING is written only by item
// creation, never posted directly.
export const POSTABLE_KINDS = ["RECEIVE", "RESTOCK", "CONSUME", "SERVICE_USE", "WASTE", "ADJUST", "CORRECTION"] as const;
// Kinds that reconcile the audited ledger rather than record physical
// in/out flow — gated by the "inventory.adjust" capability.
export const RECONCILING_KINDS: readonly string[] = ["ADJUST", "CORRECTION"];

export const createInventoryItemSchema = z.object({
  name: z.string().trim().min(1).max(120),
  sku: z.string().trim().max(60).optional(),
  unit: z.string().trim().max(20).optional(),
  lowStockThreshold: qty.optional(),
  allowNegative: z.boolean().optional(),
  // Optional starting count, recorded as an OPENING ledger row in the same
  // transaction. Never a stored quantity.
  openingQuantity: positiveQty.optional(),
});

export const updateInventoryItemSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    sku: z.string().trim().max(60).nullable().optional(),
    unit: z.string().trim().max(20).nullable().optional(),
    lowStockThreshold: qty.nullable().optional(),
    allowNegative: z.boolean().optional(),
    active: z.boolean().optional(),
  })
  .refine(v => Object.keys(v).length > 0, { message: "No fields to update" });

export const listItemsQuerySchema = z.object({
  includeInactive: z.coerce.boolean().optional().default(false),
});

export const listItemMovementsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const createMovementSchema = z
  .object({
    kind: z.enum(POSTABLE_KINDS),
    // Magnitude, always positive. Sign is derived from `kind` (and
    // `direction` for the signed kinds).
    quantity: positiveQty,
    // Required for ADJUST / CORRECTION only.
    direction: z.enum(["increase", "decrease"]).optional(),
    // Required for SERVICE_USE, forbidden otherwise.
    appointmentId: z.string().uuid().optional(),
    reason: z.string().trim().max(300).optional(),
    reference: z.string().trim().max(120).optional(),
  })
  .superRefine((v, ctx) => {
    if (RECONCILING_KINDS.includes(v.kind) && v.direction === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["direction"], message: `direction is required for a ${v.kind} movement` });
    }
    if (!RECONCILING_KINDS.includes(v.kind) && v.direction !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["direction"], message: "direction only applies to ADJUST / CORRECTION" });
    }
    if (v.kind === "SERVICE_USE" && !v.appointmentId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["appointmentId"], message: "appointmentId is required for a SERVICE_USE movement" });
    }
    if (v.kind !== "SERVICE_USE" && v.appointmentId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["appointmentId"], message: "appointmentId only applies to SERVICE_USE" });
    }
  });

export const inventoryIdParamSchema = z.object({ id: z.string().uuid() });

export type CreateInventoryItemInput = z.infer<typeof createInventoryItemSchema>;
export type UpdateInventoryItemInput = z.infer<typeof updateInventoryItemSchema>;
export type CreateMovementInput = z.infer<typeof createMovementSchema>;
