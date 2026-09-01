import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { getWallet, getLoyaltyAccountSummary, listLoyaltyTransactions } from "../../lib/loyalty/wallet.js";
import { listAvailableRewards, redeemReward, listMyRedemptions } from "../../lib/loyalty/rewards.js";
import { enrolMembership, cancelMembership, listMyMemberships, listMembershipPlans } from "../../lib/loyalty/memberships.js";
import { getOrCreateReferralCode, redeemReferralCode, myReferrals } from "../../lib/loyalty/referrals.js";
import { enrolInLoyalty } from "../../lib/loyalty/accrual.js";

// PROGRAM 2 LOOP 5 — customer-facing loyalty surface. authenticateCustomer
// only; every handler is scoped to request.customer.profileId.

const businessIdParam = z.object({ businessId: z.string().uuid() });

async function resolveBusinessBySlug(slug: string) {
  const business = await prisma.business.findFirst({ where: { publicSlug: slug, platformStatus: "ACTIVE" }, select: { id: true } });
  if (!business) throw ApiError.notFound("Business not found");
  return business.id;
}

export default async function customerLoyaltyRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticateCustomer);

  // --- Wallet & accounts ---
  fastify.get("/wallet", async (request) => getWallet(request.customer!.profileId));

  fastify.get("/accounts", async (request) => {
    const wallet = await getWallet(request.customer!.profileId);
    return wallet.accounts;
  });

  fastify.get<{ Params: { businessId: string } }>("/accounts/:businessId", async (request) => {
    const { businessId } = businessIdParam.parse(request.params);
    return getLoyaltyAccountSummary(request.customer!.profileId, businessId);
  });

  fastify.get<{ Params: { businessId: string } }>("/accounts/:businessId/transactions", async (request) => {
    const { businessId } = businessIdParam.parse(request.params);
    const query = z.object({ cursor: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(100).optional() }).parse(request.query);
    return listLoyaltyTransactions(request.customer!.profileId, businessId, query);
  });

  fastify.post<{ Params: { businessId: string } }>("/accounts/:businessId/enrol", async (request, reply) => {
    const { businessId } = businessIdParam.parse(request.params);
    const account = await enrolInLoyalty(businessId, request.customer!.profileId);
    if (!account) throw ApiError.conflict("This business does not have an active loyalty program");
    reply.status(201).send(account);
  });

  // --- Rewards ---
  fastify.get<{ Params: { businessId: string } }>("/accounts/:businessId/rewards", async (request) => {
    const { businessId } = businessIdParam.parse(request.params);
    return listAvailableRewards(businessId, request.customer!.profileId);
  });

  fastify.post<{ Params: { businessId: string; rewardId: string } }>("/accounts/:businessId/rewards/:rewardId/redeem", async (request, reply) => {
    const { businessId, rewardId } = z.object({ businessId: z.string().uuid(), rewardId: z.string().uuid() }).parse(request.params);
    reply.status(201).send(await redeemReward(businessId, request.customer!.profileId, rewardId));
  });

  fastify.get("/rewards", async (request) => {
    const { status } = z.object({ status: z.enum(["issued", "reserved", "redeemed", "expired", "revoked"]).optional() }).parse(request.query);
    return listMyRedemptions(request.customer!.profileId, status);
  });

  // --- Memberships ---
  fastify.get("/memberships", async (request) => listMyMemberships(request.customer!.profileId));

  fastify.get<{ Params: { slug: string } }>("/businesses/:slug/membership-plans", async (request) => {
    const { slug } = z.object({ slug: z.string().trim().min(1).max(200) }).parse(request.params);
    const businessId = await resolveBusinessBySlug(slug);
    return listMembershipPlans(businessId, true);
  });

  fastify.post<{ Params: { slug: string } }>("/businesses/:slug/memberships", async (request, reply) => {
    const { slug } = z.object({ slug: z.string().trim().min(1).max(200) }).parse(request.params);
    const { planId } = z.object({ planId: z.string().uuid() }).parse(request.body);
    const businessId = await resolveBusinessBySlug(slug);
    reply.status(201).send(await enrolMembership(request.customer!.profileId, businessId, planId));
  });

  fastify.post<{ Params: { id: string } }>("/memberships/:id/cancel", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { immediate } = z.object({ immediate: z.boolean().optional() }).parse(request.body ?? {});
    return cancelMembership(request.customer!.profileId, id, immediate ?? false);
  });

  // --- Referrals ---
  fastify.get("/referrals", async (request) => myReferrals(request.customer!.profileId));

  fastify.post("/referrals/code", async (request, reply) => {
    const { businessSlug } = z.object({ businessSlug: z.string().trim().max(200).optional() }).parse(request.body ?? {});
    const businessId = businessSlug ? await resolveBusinessBySlug(businessSlug) : null;
    reply.status(201).send(await getOrCreateReferralCode(request.customer!.profileId, businessId));
  });

  fastify.post("/referrals/redeem", async (request, reply) => {
    const { code } = z.object({ code: z.string().trim().min(3).max(40) }).parse(request.body);
    reply.status(201).send(await redeemReferralCode(request.customer!.profileId, code));
  });
}
