import type { FastifyInstance } from "fastify";
import { ApiError } from "../../lib/errors.js";
import { resolveTeamInvitation, acceptTeamInvitation } from "./teamInvitations.service.js";

/**
 * GET is fully unauthenticated (same shape as public.routes.ts's review
 * routes — no fastify.authenticate hook on the plugin). POST /accept
 * requires authentication (added per-route below, not plugin-wide) because
 * acceptance identity must be verifiable: the invited email must match the
 * authenticated caller's own account email — see
 * teamInvitations.service.ts's acceptTeamInvitation for the actual check.
 *
 * The "invited email has no Chakusa account yet" case (Business Phase 1's
 * former known gap) is handled separately: POST /auth/register accepts an
 * optional `invitationToken` and, when present, joins the invitation's
 * Business instead of creating a new one — see auth.service.ts's
 * registerInvitedUser and claimInvitationForNewUser below. This accept
 * endpoint remains the path for an invitee who already has an account.
 */
export default async function publicTeamInviteRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { token: string } }>(
    "/:token",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const resolved = await resolveTeamInvitation(request.params.token);
      if (!resolved) throw ApiError.notFound("This invitation is invalid or no longer available");

      reply.send({
        state: resolved.state,
        business: resolved.state === "open" ? { name: resolved.invitation.business.name } : undefined,
        email: resolved.state === "open" ? resolved.invitation.invitedEmail : undefined,
        role: resolved.state === "open" ? resolved.invitation.role : undefined,
      });
    },
  );

  fastify.post<{ Params: { token: string } }>(
    "/:token/accept",
    { preHandler: fastify.authenticate, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const outcome = await acceptTeamInvitation(request.params.token, request.user.userId);

      switch (outcome.outcome) {
        case "accepted":
          reply.status(200).send({ state: "accepted" });
          return;
        case "not-found":
          throw ApiError.notFound("This invitation is invalid or no longer available");
        case "expired":
          reply.send({ state: "expired" });
          return;
        case "already-used":
          reply.send({ state: "already-used" });
          return;
        case "email-mismatch":
          // Generic, not "this invite is for a different email" — never
          // confirm to an authenticated-but-wrong caller that the token
          // itself was otherwise valid.
          throw ApiError.notFound("This invitation is invalid or no longer available");
        case "already-member":
          throw ApiError.conflict("You already belong to a Chakusa business");
        case "seats-full":
          throw ApiError.limitReached("staffSeats", "team seats", { limit: 0, current: 0, plan: "BUSINESS" });
        default:
          throw ApiError.notFound("This invitation is invalid or no longer available");
      }
    },
  );
}
