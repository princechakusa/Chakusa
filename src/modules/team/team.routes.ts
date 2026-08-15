import type { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { assertFeatureAvailable } from "../../lib/entitlements.js";
import { requireOwner } from "../../lib/authorization.js";
import { createInvitationSchema, changeMemberRoleSchema } from "./team.schemas.js";
import { createInvitation, listInvitations, revokeInvitation } from "./teamInvitations.service.js";
import { listMembers, changeMemberRole, removeMember, reactivateMember } from "./teamMembers.service.js";
import { sendTeamInvitationEmail } from "./teamInvitationEmail.js";

/**
 * Authenticated, business-scoped team management. Every mutation
 * (invite/revoke/role-change/remove/reactivate) is owner-only in v1 — see
 * src/lib/authorization.ts's requireOwner and the Business Phase 1 report's
 * "role model" section for why ADMIN doesn't get any of this in v1. Member
 * *listing* is available to any active member (OWNER/ADMIN/STAFF) — "team
 * visibility" is a stated v1 feature for the whole team, not just the
 * owner.
 */
export default async function teamRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", fastify.requireBusiness);

  fastify.get("/members", async (request, reply) => {
    reply.send(await listMembers(request.businessId!));
  });

  fastify.patch<{ Params: { id: string } }>("/members/:id", async (request, reply) => {
    requireOwner(request);
    const input = changeMemberRoleSchema.parse(request.body);
    reply.send(await changeMemberRole(request.businessId!, request.user.userId, request.params.id, input));
  });

  fastify.delete<{ Params: { id: string } }>("/members/:id", async (request, reply) => {
    requireOwner(request);
    reply.send(await removeMember(request.businessId!, request.user.userId, request.params.id));
  });

  fastify.post<{ Params: { id: string } }>("/members/:id/reactivate", async (request, reply) => {
    requireOwner(request);
    reply.send(await reactivateMember(request.businessId!, request.plan!, request.user.userId, request.params.id));
  });

  fastify.get("/invitations", async (request, reply) => {
    requireOwner(request);
    reply.send(await listInvitations(request.businessId!));
  });

  fastify.post(
    "/invitations",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      requireOwner(request);
      assertFeatureAvailable(request.plan!, request.status!, "TEAM_MANAGEMENT");
      const input = createInvitationSchema.parse(request.body);

      const { invitation, token } = await createInvitation(request.businessId!, request.plan!, request.user.userId, input);

      const [business, inviter] = await Promise.all([
        prisma.business.findUnique({ where: { id: request.businessId! }, select: { name: true } }),
        prisma.user.findUnique({ where: { id: request.user.userId }, select: { fullName: true } }),
      ]);
      const delivered = await sendTeamInvitationEmail(invitation.invitedEmail, token, business?.name ?? "Chakusa", inviter?.fullName ?? "A teammate");
      if (!delivered) request.log.warn("Team invitation email was not delivered");

      reply.status(201).send({
        id: invitation.id,
        email: invitation.invitedEmail,
        role: invitation.role,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
        // Returned exactly once, to the authenticated owner who just
        // created it — same trust boundary as generatePublicReviewLink's
        // raw token. Never logged, never returned again. Lets the owner
        // copy/share the invite link manually if email delivery fails or
        // isn't configured (see teamInvitationEmail.ts).
        token,
      });
    },
  );

  fastify.delete<{ Params: { id: string } }>("/invitations/:id", async (request, reply) => {
    requireOwner(request);
    reply.send(await revokeInvitation(request.businessId!, request.params.id));
  });
}
