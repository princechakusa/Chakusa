import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { requireBusinessRole } from "../../lib/authorization.js";
import { getLoyaltyProgram, upsertLoyaltyProgram } from "../../lib/loyalty/program.js";
import { listRewards, createReward, updateReward, deleteReward, markRedemptionRedeemed, revokeRedemption } from "../../lib/loyalty/rewards.js";
import { listMembershipPlans, createMembershipPlan, updateMembershipPlan, deleteMembershipPlan } from "../../lib/loyalty/memberships.js";
import { listCampaigns, createCampaign, updateCampaign, deleteCampaign } from "../../lib/loyalty/campaigns.js";
import { adjustPoints } from "../../lib/loyalty/pointsEngine.js";
import { loyaltyBusinessAnalytics } from "./loyaltyAnalytics.js";

// PROGRAM 2 LOOP 5 — the business-facing loyalty management surface.
// authenticate + requireBusiness; mutations need OWNER/ADMIN. Businesses
// fully own their program, rewards, membership plans and campaigns.

const idParam = z.object({ id: z.string().uuid() });
const manage = (request: Parameters<typeof requireBusinessRole>[0]) => requireBusinessRole(request, ["OWNER", "ADMIN"]);

export default async function loyaltyBusinessRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", fastify.requireBusiness);

  // --- Program config ---
  fastify.get("/program", async (request) => (await getLoyaltyProgram(request.businessId!)) ?? { businessId: request.businessId, active: false, configured: false });
  fastify.put("/program", async (request) => {
    manage(request);
    const input = z.object({
      active: z.boolean().optional(),
      pointsPerCurrency: z.number().min(0).max(1000).optional(),
      pointsPerBookingBonus: z.number().int().min(0).max(100000).optional(),
      pointsPerReview: z.number().int().min(0).max(100000).optional(),
      pointsPerReferral: z.number().int().min(0).max(100000).optional(),
      pointExpiryDays: z.number().int().min(1).max(3650).nullable().optional(),
      currency: z.string().trim().max(8).nullable().optional(),
      welcomeBonus: z.number().int().min(0).max(100000).optional(),
      tierConfig: z.array(z.object({ key: z.string().trim().min(1).max(40), name: z.string().trim().min(1).max(60), minPoints: z.number().int().min(0), perks: z.array(z.string().trim().max(120)).max(20).optional() })).max(10).nullable().optional(),
    }).parse(request.body);
    return upsertLoyaltyProgram(request.businessId!, request.user.userId, {
      ...input,
      tierConfig: input.tierConfig ? input.tierConfig.map((t) => ({ ...t, perks: t.perks ?? [] })) : input.tierConfig,
    });
  });

  // --- Rewards ---
  fastify.get("/rewards", async (request) => listRewards(request.businessId!, z.object({ activeOnly: z.coerce.boolean().optional() }).parse(request.query).activeOnly ?? false));
  fastify.post("/rewards", async (request, reply) => {
    manage(request);
    const input = z.object({
      name: z.string().trim().min(1).max(120),
      description: z.string().trim().max(1000).optional(),
      type: z.enum(["free_service", "percent_discount", "fixed_discount", "promo", "birthday", "milestone"]),
      pointsCost: z.number().int().min(0).max(1_000_000).optional(),
      value: z.number().min(0).max(1_000_000).optional(),
      serviceOfferingId: z.string().uuid().optional(),
      minTierKey: z.string().trim().max(40).optional(),
      autoGrant: z.boolean().optional(),
      milestoneBookings: z.number().int().min(1).max(1000).optional(),
      membersOnly: z.boolean().optional(),
      startsAt: z.string().datetime({ offset: true }).optional(),
      endsAt: z.string().datetime({ offset: true }).optional(),
      redemptionValidityDays: z.number().int().min(1).max(365).optional(),
    }).parse(request.body);
    reply.status(201).send(await createReward(request.businessId!, request.user.userId, input));
  });
  fastify.patch<{ Params: { id: string } }>("/rewards/:id", async (request) => {
    manage(request);
    return updateReward(request.businessId!, idParam.parse(request.params).id, request.body as Record<string, unknown>);
  });
  fastify.delete<{ Params: { id: string } }>("/rewards/:id", async (request) => {
    manage(request);
    return deleteReward(request.businessId!, idParam.parse(request.params).id);
  });

  // --- Redemptions (scan / manage) ---
  fastify.get("/redemptions", async (request) => {
    const query = z.object({ status: z.string().max(20).optional(), code: z.string().trim().max(40).optional() }).parse(request.query);
    return prisma.rewardRedemption.findMany({
      where: { businessId: request.businessId!, ...(query.status ? { status: query.status } : {}), ...(query.code ? { code: query.code.toUpperCase() } : {}) },
      orderBy: { issuedAt: "desc" },
      take: 200,
      include: { reward: { select: { name: true, type: true, value: true } } },
    });
  });
  fastify.post<{ Params: { id: string } }>("/redemptions/:id/mark-redeemed", async (request) => {
    manage(request);
    const { appointmentId } = z.object({ appointmentId: z.string().uuid().optional() }).parse(request.body ?? {});
    return markRedemptionRedeemed(request.businessId!, idParam.parse(request.params).id, appointmentId);
  });
  fastify.post<{ Params: { id: string } }>("/redemptions/:id/revoke", async (request) => {
    manage(request);
    const { reason, refundPoints } = z.object({ reason: z.string().trim().max(500).default("Revoked by business"), refundPoints: z.boolean().optional() }).parse(request.body ?? {});
    return revokeRedemption(request.businessId!, idParam.parse(request.params).id, reason, refundPoints ?? true);
  });

  // --- Membership plans ---
  fastify.get("/membership-plans", async (request) => listMembershipPlans(request.businessId!, false));
  fastify.post("/membership-plans", async (request, reply) => {
    manage(request);
    const input = z.object({
      name: z.string().trim().min(1).max(120),
      description: z.string().trim().max(1000).optional(),
      billingInterval: z.enum(["monthly", "annual", "unlimited"]),
      priceAmount: z.number().min(0).max(1_000_000),
      currency: z.string().trim().max(8).optional(),
      priorityBooking: z.boolean().optional(),
      discountPercent: z.number().min(0).max(100).optional(),
      includedServiceIds: z.array(z.string().uuid()).max(100).optional(),
      perks: z.array(z.string().trim().max(120)).max(30).optional(),
    }).parse(request.body);
    reply.status(201).send(await createMembershipPlan(request.businessId!, request.user.userId, input));
  });
  fastify.patch<{ Params: { id: string } }>("/membership-plans/:id", async (request) => {
    manage(request);
    return updateMembershipPlan(request.businessId!, idParam.parse(request.params).id, request.body as Record<string, unknown>);
  });
  fastify.delete<{ Params: { id: string } }>("/membership-plans/:id", async (request) => {
    manage(request);
    return deleteMembershipPlan(request.businessId!, idParam.parse(request.params).id);
  });

  // --- Campaigns ---
  fastify.get("/campaigns", async (request) => listCampaigns(request.businessId!, z.object({ activeOnly: z.coerce.boolean().optional() }).parse(request.query).activeOnly ?? false));
  fastify.post("/campaigns", async (request, reply) => {
    manage(request);
    const input = z.object({
      name: z.string().trim().min(1).max(120),
      description: z.string().trim().max(1000).optional(),
      kind: z.enum(["bonus_points", "multiplier", "bonus_reward"]).optional(),
      multiplier: z.number().min(1).max(20).optional(),
      bonusPoints: z.number().int().min(0).max(100000).optional(),
      rewardId: z.string().uuid().optional(),
      startsAt: z.string().datetime({ offset: true }),
      endsAt: z.string().datetime({ offset: true }),
    }).parse(request.body);
    reply.status(201).send(await createCampaign(request.businessId!, request.user.userId, input));
  });
  fastify.patch<{ Params: { id: string } }>("/campaigns/:id", async (request) => {
    manage(request);
    return updateCampaign(request.businessId!, idParam.parse(request.params).id, request.body as Record<string, unknown>);
  });
  fastify.delete<{ Params: { id: string } }>("/campaigns/:id", async (request) => {
    manage(request);
    return deleteCampaign(request.businessId!, idParam.parse(request.params).id);
  });

  // --- Member roster + manual point adjustments ---
  fastify.get("/accounts", async (request) => {
    const query = z.object({ page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().min(1).max(100).optional(), tierKey: z.string().max(40).optional() }).parse(request.query);
    const take = query.pageSize ?? 25;
    const skip = ((query.page ?? 1) - 1) * take;
    const where = { businessId: request.businessId!, ...(query.tierKey ? { tierKey: query.tierKey } : {}) };
    const [items, total] = await Promise.all([
      prisma.loyaltyAccount.findMany({ where, orderBy: { lifetimePoints: "desc" }, skip, take, include: { customerProfile: { select: { id: true, displayName: true, user: { select: { fullName: true, email: true } } } } } }),
      prisma.loyaltyAccount.count({ where }),
    ]);
    return { items: items.map((a) => ({ id: a.id, customerProfileId: a.customerProfileId, name: a.customerProfile.displayName ?? a.customerProfile.user.fullName, email: a.customerProfile.user.email, pointsBalance: a.pointsBalance, lifetimePoints: a.lifetimePoints, tierKey: a.tierKey, lastActivityAt: a.lastActivityAt })), total, page: query.page ?? 1, pageSize: take };
  });
  fastify.post<{ Params: { customerProfileId: string } }>("/accounts/:customerProfileId/adjust", async (request) => {
    manage(request);
    const { customerProfileId } = z.object({ customerProfileId: z.string().uuid() }).parse(request.params);
    const { points, reason } = z.object({ points: z.number().int().min(-1_000_000).max(1_000_000).refine((v) => v !== 0, "points cannot be zero"), reason: z.string().trim().min(1).max(500) }).parse(request.body);
    const link = await prisma.customerBusinessLink.findFirst({ where: { businessId: request.businessId!, customerProfileId }, select: { id: true } });
    const account = await prisma.loyaltyAccount.findFirst({ where: { businessId: request.businessId!, customerProfileId }, select: { id: true } });
    if (!link && !account) throw ApiError.notFound("That customer is not a member of this business");
    return adjustPoints({ businessId: request.businessId!, customerProfileId, points, reason, createdByUserId: request.user.userId });
  });

  // --- Analytics ---
  fastify.get("/analytics", async (request) => loyaltyBusinessAnalytics(request.businessId!));
}
