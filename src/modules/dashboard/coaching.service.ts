import { getDashboardSummary } from "./dashboard.service.js";
import { getBusinessInsights } from "./insights.service.js";
import { generateBusinessCoaching } from "../../lib/businessCoaching.js";
import { getAudienceCenter } from "../customers/audiences.service.js";

/**
 * The Business Assistant Foundation's only entry point — fetches the
 * already-existing intelligence sources exactly once each (passing the
 * fetched summary into getBusinessInsights rather than letting it fetch a
 * second copy of the same data), then hands both to the pure,
 * deterministic coaching engine. No new SQL lives here or in
 * businessCoaching.ts — every number in the output traces back to the
 * existing Dashboard, Insights, or Audience services.
 */
export async function getBusinessCoaching(businessId: string) {
  const summary = await getDashboardSummary(businessId);
  const [insights, audienceCenter] = await Promise.all([
    getBusinessInsights(businessId, summary),
    getAudienceCenter(businessId),
  ]);

  return {
    insights: generateBusinessCoaching({ summary, insights, audiences: audienceCenter.audiences }),
    generatedAt: new Date(),
  };
}
