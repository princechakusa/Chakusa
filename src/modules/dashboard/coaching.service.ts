import { getDashboardSummary } from "./dashboard.service.js";
import { getBusinessInsights } from "./insights.service.js";
import { generateBusinessCoaching } from "../../lib/businessCoaching.js";
import { getAudienceSummaries } from "../customers/audiences.service.js";
import { prisma } from "../../lib/prisma.js";

/**
 * The Business Assistant Foundation's only entry point — fetches the
 * already-existing intelligence sources exactly once each (passing the
 * fetched summary into getBusinessInsights rather than letting it fetch a
 * second copy of the same data), then hands both to the pure,
 * deterministic coaching engine. No new SQL lives here or in
 * businessCoaching.ts (only the business currency is read here, for the
 * copy) — every number in the output traces back to the
 * existing Dashboard, Insights, or Audience services.
 */
export async function getBusinessCoaching(businessId: string) {
  const summary = await getDashboardSummary(businessId);
  const [insights, audiences, business] = await Promise.all([
    getBusinessInsights(businessId, summary),
    getAudienceSummaries(businessId),
    prisma.business.findUnique({ where: { id: businessId }, select: { currency: true } }),
  ]);

  return {
    insights: generateBusinessCoaching({ summary, insights, audiences, currency: business?.currency ?? "USD" }),
    generatedAt: new Date(),
  };
}
