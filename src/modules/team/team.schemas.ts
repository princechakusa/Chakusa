import { z } from "zod";

// OWNER is deliberately excluded — an invitation can never grant ownership.
// See the Business Phase 1 report's "role model" section: ownership stays
// immutable in v1, no transfer flow exists.
const invitableRoleEnum = z.enum(["ADMIN", "STAFF"]);

export const createInvitationSchema = z.object({
  email: z.string().trim().email(),
  role: invitableRoleEnum,
});
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

export const changeMemberRoleSchema = z.object({
  role: invitableRoleEnum,
});
export type ChangeMemberRoleInput = z.infer<typeof changeMemberRoleSchema>;
