// Build-time FALLBACK for plan prices and trial lengths, used only until the
// live values load. The real numbers live in the admin console (Settings →
// App configuration: "Starter/Pro/Business price", "free trial days") and are
// applied to every [data-cfg-price] / [data-cfg-trial-days] element by
// scripts/siteConfig.ts from the API's public /app-config. Keep this equal to
// the API's defaults (src/modules/appConfig/appConfig.service.ts) so a visitor
// who is offline still sees honest numbers.
export type PlanKey = "STARTER" | "PRO" | "BUSINESS";

export interface PricingConfig {
  currency: string;
  monthly: Record<PlanKey, number>;
  trialDays: Record<PlanKey, number>;
}

export const PRICING_FALLBACK: PricingConfig = {
  currency: "USD",
  monthly: { STARTER: 3, PRO: 8, BUSINESS: 13 },
  trialDays: { STARTER: 7, PRO: 0, BUSINESS: 0 },
};

/** "$3", "$7.99", "€8" - whole amounts drop the decimals. */
export function formatPlanPrice(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}
