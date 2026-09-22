import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";

/**
 * Platform-admin CRUD for FeatureFlag rows. This is what lets a platform
 * admin turn on things like `ai.customer_agent` (see
 * src/lib/ai/agent/customerAgent.ts's isCustomerAgentEnabled) from the admin
 * console, without a direct database edit or a new deploy.
 */
export async function adminListFeatureFlags() {
  return prisma.featureFlag.findMany({ orderBy: [{ key: "asc" }, { scope: "asc" }] });
}

export async function adminUpsertFeatureFlag(input: {
  key: string;
  scope: "PLATFORM" | "BUSINESS" | "USER";
  businessId?: string;
  userId?: string;
  enabled: boolean;
  rolloutPercent?: number;
}) {
  if (input.scope === "BUSINESS" && !input.businessId) throw ApiError.badRequest("businessId is required for a BUSINESS-scoped flag");
  if (input.scope === "USER" && !input.userId) throw ApiError.badRequest("userId is required for a USER-scoped flag");

  const existing = await prisma.featureFlag.findFirst({
    where: { key: input.key, scope: input.scope, businessId: input.scope === "BUSINESS" ? input.businessId : null, userId: input.scope === "USER" ? input.userId : null },
  });

  const data = {
    enabled: input.enabled,
    status: input.enabled ? "ENABLED" : "DISABLED",
    rolloutPercent: input.rolloutPercent ?? 100,
  };

  if (existing) {
    return prisma.featureFlag.update({ where: { id: existing.id }, data });
  }
  return prisma.featureFlag.create({
    data: {
      key: input.key,
      scope: input.scope,
      businessId: input.scope === "BUSINESS" ? input.businessId : undefined,
      userId: input.scope === "USER" ? input.userId : undefined,
      ...data,
    },
  });
}

export async function adminDeleteFeatureFlag(id: string) {
  const existing = await prisma.featureFlag.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound("Feature flag not found");
  await prisma.featureFlag.delete({ where: { id } });
  return existing;
}
