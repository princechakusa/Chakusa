import { z } from "zod";

export const dispatchBoardSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
});
export const dispatchAssignSchema = z.object({
  appointmentId: z.string().uuid(),
  memberId: z.string().uuid(),
});
export const dispatchCandidatesSchema = z.object({
  appointmentId: z.string().uuid(),
});

export type DispatchBoardInput = z.infer<typeof dispatchBoardSchema>;
export type DispatchAssignInput = z.infer<typeof dispatchAssignSchema>;
export type DispatchCandidatesInput = z.infer<typeof dispatchCandidatesSchema>;
