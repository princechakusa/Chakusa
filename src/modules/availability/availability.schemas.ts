import { z } from "zod";

const dateTime = z.string().datetime({ offset: true });
export const availabilityQuerySchema = z.object({ serviceOfferingId: z.string().uuid(), memberId: z.string().uuid().optional(), from: dateTime, to: dateTime }).refine(value => new Date(value.to) > new Date(value.from), { message: "to must be after from", path: ["to"] }).refine(value => new Date(value.to).getTime() - new Date(value.from).getTime() <= 32 * 86_400_000, { message: "Availability range cannot exceed 32 days", path: ["to"] });
export const createBookingBlockSchema = z.object({ assignedMemberId: z.string().uuid().nullable().optional(), startsAt: dateTime, endsAt: dateTime, reason: z.string().trim().max(200).nullable().optional() }).refine(value => new Date(value.endsAt) > new Date(value.startsAt), { message: "endsAt must be after startsAt", path: ["endsAt"] });
export const bookingBlockListSchema = z.object({ from: dateTime, to: dateTime }).refine(value => new Date(value.to) > new Date(value.from), { message: "to must be after from", path: ["to"] });
export const memberHoursSchema = z.object({ workingHours: z.record(z.unknown()).nullable() });
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;
export type CreateBookingBlockInput = z.infer<typeof createBookingBlockSchema>;
