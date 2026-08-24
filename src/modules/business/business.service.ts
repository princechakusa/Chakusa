import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";

export async function completeBusinessOnboarding(businessId: string) {
  const business = await prisma.business.findUnique({ where: { id: businessId } });
  if (!business) throw ApiError.notFound("Business not found");

  const services = Array.isArray(business.defaultServices) ? business.defaultServices.filter(value => typeof value === "string" && value.trim()) : [];
  const hours = business.workingHours && typeof business.workingHours === "object" && !Array.isArray(business.workingHours)
    ? business.workingHours as Record<string, unknown>
    : null;
  const missing = [
    !business.name.trim() && "business name",
    !business.industry?.trim() && "industry",
    !business.phone?.trim() && "business phone",
    services.length === 0 && "at least one service",
    !hours || Object.keys(hours).length === 0 ? "working hours" : false,
  ].filter(Boolean);

  if (missing.length) throw ApiError.badRequest(`Finish setup before continuing: ${missing.join(", ")}`);
  return prisma.business.update({ where: { id: businessId }, data: { onboardingCompletedAt: new Date() } });
}
