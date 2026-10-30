import type { PlanDescriptionDto, PlanLimitsDto } from '../apiTypes';
import type { BillingPlan, PlanAction } from './billing';

// Plan presentation. What a plan includes always comes from the API's
// /plans (its enforcing entitlement tables) and prices from the store; this
// file only turns those into readable lines and picks the button copy.

/** One-line pitch per plan: positioning copy only, never prices or limits. */
export const PLAN_TAGLINES: Record<BillingPlan, string> = {
  STARTER: 'For solo pros getting organised.',
  PRO: 'For busy businesses that want Chakusa working for them.',
  BUSINESS: 'For teams running Chakusa together.',
};

const LIMIT_LINES: Array<[keyof PlanLimitsDto, (n: number) => string, string]> = [
  ['leadsPerMonth', (n) => `${n.toLocaleString('en-US')} leads a month`, 'Unlimited leads'],
  ['customers', (n) => `${n.toLocaleString('en-US')} customers`, 'Unlimited customers'],
  ['reviewRequestsPerMonth', (n) => `${n.toLocaleString('en-US')} review requests a month`, 'Unlimited review requests'],
  ['openReminders', (n) => `${n.toLocaleString('en-US')} open reminders`, 'Unlimited reminders'],
  ['customTemplatesPerType', (n) => `${n} custom message template${n === 1 ? '' : 's'} per type`, 'Unlimited message templates'],
];

/** Readable highlights for a plan, from the API's limits and features. */
export function planHighlights(plan: PlanDescriptionDto): string[] {
  const lines = LIMIT_LINES.map(([key, limited, unlimited]) => { const value = plan.limits[key]; return value == null ? unlimited : limited(value); });
  const seats = plan.limits.staffSeats;
  if (seats != null && seats > 1) lines.push(`Up to ${seats} team members with roles`);
  for (const feature of plan.features) if (feature.key !== 'UNLIMITED_TEMPLATES' && feature.key !== 'TEAM_MANAGEMENT') lines.push(feature.label);
  return lines;
}

/**
 * "7-day free trial, then $3.00 / month": the configured trial length, else
 * the store's own intro offer. Both stores require the price charged after a
 * trial or intro offer to be shown next to it, so it is added when known.
 */
export function trialLabel(storeOffer: string | null | undefined, configuredDays: number, price?: string | null): string | null {
  const then = price ? `, then ${price} / month` : '';
  if (configuredDays > 0) return `${configuredDays}-day free trial${then}`;
  return storeOffer ? `Intro offer: ${storeOffer}${then}` : null;
}

/**
 * Auto-renewal terms shown on the subscription screen (App Store Review
 * Guideline 3.1.2, Google Play Subscriptions policy): who charges, when it
 * renews, how to cancel, and what happens to an unused free trial.
 */
export function renewalTerms(platform: string): string {
  const store = platform === 'ios' ? 'App Store' : platform === 'android' ? 'Google Play' : 'app store';
  const account = platform === 'ios' ? 'Apple Account' : platform === 'android' ? 'Google Play account' : 'store account';
  return `Payment is charged to your ${account} when you confirm the purchase, or when a free trial ends. `
    + 'Plans are monthly and renew automatically at the same price unless you cancel at least 24 hours before the end of the current period. '
    + `You can manage or cancel anytime in your ${store} subscription settings; cancelling during a free trial means you are not charged. `
    + `Prices are shown and charged by ${platform === 'ios' ? 'the App Store' : platform === 'android' ? 'Google Play' : 'your app store'} in your local currency.`;
}

export function planButtonLabel(action: PlanAction, planName: string, trialDays: number): string {
  if (action === 'current') return 'Your current plan';
  if (action === 'upgrade') return `Upgrade to ${planName}`;
  if (action === 'downgrade') return `Switch to ${planName}`;
  return trialDays > 0 ? `Start ${trialDays}-day free trial` : `Subscribe to ${planName}`;
}

/** The admin-configured reference price ("$8", "$7.99"), shown only when the store has no price to show. */
export function referencePrice(amount: number, currency: string): string | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}
