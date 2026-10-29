import type { BusinessInsightsDto, MonthlyTrendPointDto, ServicePerformanceRowDto } from '../apiTypes';

// Everything the Business Insights screen derives from the API's numbers:
// month-over-month change, chart bar sizes, plain-language summaries. Kept out
// of the screen so it is unit-tested and the screen only lays things out.

export type TrendMetric = 'recoveredRevenue' | 'newLeads' | 'newCustomers' | 'wonLeads';
export const TREND_METRICS: Array<{ key: TrendMetric; label: string; money: boolean }> = [
  { key: 'recoveredRevenue', label: 'Revenue', money: true },
  { key: 'newLeads', label: 'Leads', money: false },
  { key: 'wonLeads', label: 'Won', money: false },
  { key: 'newCustomers', label: 'New customers', money: false },
];

export interface Change { current: number; previous: number | null; /** Fraction (0.25 = +25%); null when there is no earlier month to compare, or it was zero. */ fraction: number | null; direction: 'up' | 'down' | 'flat' | 'none' }

/** This month against last month for one metric. The newest point is the current month. */
export function monthChange(trend: MonthlyTrendPointDto[], metric: TrendMetric): Change {
  const current = trend.at(-1)?.[metric] ?? 0;
  const previousPoint = trend.length > 1 ? trend.at(-2) : undefined;
  const previous = previousPoint ? previousPoint[metric] : null;
  if (previous === null) return { current, previous, fraction: null, direction: 'none' };
  if (previous === 0) return { current, previous, fraction: null, direction: current > 0 ? 'up' : 'flat' };
  const fraction = (current - previous) / previous;
  return { current, previous, fraction, direction: Math.abs(fraction) < 0.005 ? 'flat' : fraction > 0 ? 'up' : 'down' };
}

/** "+25%", "-8%", "No change", or "New" when last month was zero. */
export function changeLabel(change: Change): string | null {
  if (change.direction === 'none') return null;
  if (change.direction === 'flat') return 'No change';
  if (change.fraction === null) return 'New this month';
  const percent = Math.round(Math.abs(change.fraction) * 100);
  return `${change.fraction > 0 ? '+' : '-'}${percent}%`;
}

/** Bar heights as 0-1 of the tallest, with a visible stub for non-zero values and none for zero. */
export function barFractions(values: number[], minimum = 0.06): number[] {
  const max = Math.max(0, ...values);
  if (max === 0) return values.map(() => 0);
  return values.map((value) => (value <= 0 ? 0 : Math.max(minimum, value / max)));
}

/** Short month label for the chart axis ("Oct"). */
export function shortMonth(month: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));
}

export function percent(value: number | null | undefined): string { return value == null ? '-' : `${Math.round(value * 100)}%`; }

/** One plain sentence about the current month, or null when there is nothing to say yet. */
export function monthHeadline(insights: BusinessInsightsDto): string | null {
  const revenue = monthChange(insights.monthlyTrend, 'recoveredRevenue');
  const customers = monthChange(insights.monthlyTrend, 'newCustomers');
  if (revenue.direction === 'up' && revenue.fraction !== null) return `Revenue is up ${Math.round(revenue.fraction * 100)}% on last month. Keep going.`;
  if (revenue.direction === 'down' && revenue.fraction !== null) return `Revenue is down ${Math.round(Math.abs(revenue.fraction) * 100)}% on last month. The actions below are the fastest way to recover it.`;
  if (customers.current > 0) return `${customers.current} new customer${customers.current === 1 ? '' : 's'} so far this month.`;
  if (insights.monthlyTrend.some((point) => point.newLeads > 0 || point.recoveredRevenue > 0)) return 'A quiet month so far. Follow up with recent leads to get it moving.';
  return null;
}

export interface BarRow { label: string; value: string; fraction: number }
/** Service rows ready to draw: the top few, each bar scaled to the best one. */
export function serviceBars(rows: ServicePerformanceRowDto[], pick: (row: ServicePerformanceRowDto) => number, format: (value: number) => string, limit = 5): BarRow[] {
  const top = rows.slice(0, limit);
  const fractions = barFractions(top.map(pick));
  return top.map((row, index) => ({ label: row.service.replace(/_/g, ' ').replace(/(^|\s)\S/g, (letter) => letter.toUpperCase()), value: format(pick(row)), fraction: fractions[index] ?? 0 }));
}

export const LIFECYCLE_STAGES = [
  { key: 'new_lead', label: 'New leads' }, { key: 'contacted', label: 'Contacted' }, { key: 'first_customer', label: 'First visit' },
  { key: 'returning', label: 'Returning' }, { key: 'loyal', label: 'Loyal' }, { key: 'vip', label: 'VIP' },
  { key: 'dormant', label: 'Slipping away' }, { key: 'lost', label: 'Lost' },
] as const;

/** Lifecycle stages with customers in them, as a share of everyone (shares sum to 1). */
export function lifecycleShares(counts: Record<string, number>, total: number) {
  if (total <= 0) return [];
  return LIFECYCLE_STAGES.filter((stage) => (counts[stage.key] ?? 0) > 0).map((stage) => ({ ...stage, count: counts[stage.key] ?? 0, share: (counts[stage.key] ?? 0) / total }));
}

/** "On average a lead becomes a customer in 3 days" ("within a day" under one day). */
export function recoveryTimeCopy(averageDays: number): string {
  const days = Math.round(averageDays);
  if (days < 1) return 'On average a lead becomes a customer within a day.';
  return `On average a lead becomes a customer in ${days} day${days === 1 ? '' : 's'}.`;
}
