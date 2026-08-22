import { getDashboardSummary } from "./dashboard.service.js";
import { getBusinessInsights } from "./insights.service.js";
import { generateBusinessCoaching } from "../../lib/businessCoaching.js";

/**
 * The Business Assistant Foundation's only entry point — fetches the two
 * already-existing intelligence sources exactly once each (passing the
 * fetched summary into getBusinessInsights rather than letting it fetch a
 * second copy of the same data), then hands both to the pure,
 * deterministic coaching engine. No new SQL lives here or in
 * businessCoaching.ts — every number in the output traces back to
 * dashboard.service.ts or insights.service.ts's existing queries.
 */
export async function getBusinessCoaching(businessId: string) {
  const summary = await getDashboardSummary(businessId);
  const insights = await getBusinessInsights(businessId, summary);

  return {
    insights: generateBusinessCoaching({ summary, insights }),
    generatedAt: new Date(),
  };
}
