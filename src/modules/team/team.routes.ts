import type { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { assertFeatureAvailable } from "../../lib/entitlements.js";
import { requireOwner } from "../../lib/authorization.js";
import { createInvitationSchema, changeMemberRoleSchema, transferOwnershipSchema } from "./team.schemas.js";
import { createInvitation, listInvitations, revokeInvitation } from "./teamInvitations.service.js";
import { listMembers, changeMemberRole, removeMember, reactivateMember, getSeatSummary, transferOwnership } from "./teamMembers.service.js";
import { sendTeamInvitationEmail, type TeamInvitationEmailSender } from "./teamInvitationEmail.js";

export interface TeamRoutesOptions {
  /** Test-only injection — see subscription.routes.ts's SubscriptionRoutesOptions for the same pattern. Defaults to the real Resend-backed sender. */
  emailSender?: TeamInvitationEmailSender;
}

/**
 * Authenticated, business-scoped team management. Every mutation
 * (invite/revoke/role-change/remove/reactivate) is owner-only in v1 — see
 * src/lib/authorization.ts's requireOwner and the Business Phase 1 report's
 * "role model" section for why ADMIN doesn't get any of this in v1. Member
 * *listing* (and seat summary — see GET /summary below) is available to any
 * active member (OWNER/ADMIN/STAFF) — "team visibility" is a stated v1
 * feature for the whole team, not just the owner. Neither read is gated by
 * assertFeatureAvailable, deliberately: a downgraded former-Business
 * owner's team history (and seat numbers) must remain readable even though
 * TEAM_MANAGEMENT (invite/remove/etc.) is no longer available to them — see
 * the Business Phase 1 report's "downgrade behavior" section, which this
 * mirrors for reads.
 */
export default async function teamRoutes(fastify: FastifyInstance, options: TeamRoutesOptions = {}) {
  const emailSender = options.emailSender ?? sendTeamInvitationEmail;

  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", fastify.requireBusiness);

  fastify.get("/members", async (request, reply) => {
    reply.send(await listMembers(request.businessId!));
  });

  /**
   * Business Phase 1.2: the one authoritative seat-usage read for mobile's
   * "X of N seats used" — see teamMembers.service.ts's getSeatSummary doc
   * comment for why `current` is defined exactly the way invitation
   * enforcement already defines it. `request.businessId` is the trusted,
   * server-resolved tenant (see tenant.ts's requireBusiness) — there is no
   * businessId parameter anywhere in this route.
   */
  fastify.get("/summary", async (request, reply) => {
    const seats = await getSeatSummary(request.businessId!, request.plan!);
    reply.send({ seats });
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

  fastify.post("/ownership-transfer", async (request, reply) => {
    requireOwner(request);
    const input = transferOwnershipSchema.parse(request.body);
    reply.send(await transferOwnership(request.businessId!, request.user.userId, input));
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
      // sendTeamInvitationEmail (real or injected fake) never throws — a
      // provider outage must not turn an already-created, valid invitation
      // into a 500. `emailSent` surfaces exactly this boolean to the
      // client, nothing else: never a Resend message ID, provider error
      // body, or any other delivery detail (see teamInvitationEmail.ts's
      // doc comment on why that boolean is a safe boundary to cross).
      const emailSent = await emailSender(invitation.invitedEmail, token, business?.name ?? "Chakusa", inviter?.fullName ?? "A teammate");
      if (!emailSent) request.log.warn("Team invitation email was not delivered");

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
        emailSent,
      });
    },
  );

  fastify.delete<{ Params: { id: string } }>("/invitations/:id", async (request, reply) => {
    requireOwner(request);
    reply.send(await revokeInvitation(request.businessId!, request.params.id));
  });
}
