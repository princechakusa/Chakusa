import { Prisma } from "@prisma/client";

// PROGRAM 3 / Financial Management (roadmap stage 8, master directive s18).
//
// Pure derivation for the money-in / money-out view. No Prisma queries, no
// I/O. Everything here works in exact decimals (Prisma.Decimal) and never
// mixes currencies: callers pass already-fetched rows, this module groups
// them by currency and rolls each currency up independently (money rule s16).
//
// This module holds NO tax, VAT, or deductibility logic. "revenue",
// "expenses" and "net" are plain arithmetic on money the business has
// actually recorded or been paid.

const TWO_DP = 2;
const round2 = (value: Prisma.Decimal) => value.toDecimalPlaces(TWO_DP, Prisma.Decimal.ROUND_HALF_UP);
const ZERO = new Prisma.Decimal(0);

const toDecimal = (value: Prisma.Decimal | string | number | null | undefined): Prisma.Decimal =>
  value == null ? ZERO : value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);

const normaliseCurrency = (value: string): string => value.trim().toUpperCase();

// A ledger row only counts toward money-in once the provider has actually
// settled it. "pending" / "failed" never move the balance. Mirrors
// invoicePayments.domain.ts's SETTLED set.
const SETTLED_STATUSES = new Set(["paid", "partially_refunded", "refunded"]);

// ---------------------------------------------------------------------------
// Expense category slugs (descriptive, not tax categories)
// ---------------------------------------------------------------------------

// Unicode combining diacritical marks, stripped after NFKD decomposition.
const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * Deterministic, URL-safe slug for an expense-category name, unique per
 * business via the DB unique index on (businessId, slug). Collapses to
 * ASCII lowercase words joined by "-"; callers must handle the empty-string
 * result (a name with no sluggable characters) as a validation error.
 */
export function toCategorySlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/**
 * Seeded when a business first touches the expenses feature. Descriptive
 * operating-cost buckets only - no accounting or tax meaning is implied by
 * these names or their presence.
 */
export const DEFAULT_EXPENSE_CATEGORIES: readonly string[] = [
  "Supplies",
  "Equipment",
  "Rent and premises",
  "Utilities",
  "Travel and vehicle",
  "Marketing",
  "Software and subscriptions",
  "Fees and charges",
  "Insurance",
  "Other",
];

// ---------------------------------------------------------------------------
// Mileage
// ---------------------------------------------------------------------------

/**
 * The money value of a mileage trip = distance * owner-set reimbursement
 * rate, rounded to 2dp. Returns null when no rate is recorded - a trip
 * logged only for distance carries no money and never enters a currency
 * rollup. `ratePerUnit` is an owner reimbursement rate, never a government
 * mileage allowance.
 */
export function computeMileageAmount(input: {
  distance: Prisma.Decimal | string | number;
  ratePerUnit: Prisma.Decimal | string | number | null | undefined;
}): string | null {
  if (input.ratePerUnit == null) return null;
  const distance = toDecimal(input.distance);
  const rate = toDecimal(input.ratePerUnit);
  return round2(distance.mul(rate)).toFixed(TWO_DP);
}

// ---------------------------------------------------------------------------
// Money-in / money-out rollup
// ---------------------------------------------------------------------------

export interface SettledLedgerRow {
  status: string;
  amount: Prisma.Decimal | string | number;
  refundedAmount: Prisma.Decimal | string | number;
  currency: string;
}

export interface ExpenseRollupRow {
  amount: Prisma.Decimal | string | number;
  currency: string;
  categoryId: string | null;
  categoryName: string | null;
}

export interface MileageRollupRow {
  amount: Prisma.Decimal | string | number | null;
  currency: string | null;
}

export interface OutstandingRollupRow {
  outstandingBalance: Prisma.Decimal | string | number;
  currency: string;
}

export interface ExpenseCategoryBreakdown {
  categoryId: string | null;
  name: string;
  amount: string;
}

export interface CurrencyRollup {
  currency: string;
  /** Provider-settled money in, net of refunds, over the requested window. */
  revenue: string;
  /** Recorded expenses over the requested window. */
  expenses: string;
  /** Recorded mileage money over the requested window. */
  mileage: string;
  /** revenue minus expenses minus mileage. May be negative. */
  net: string;
  /** Point-in-time balance still owed on SENT invoices (window-independent). */
  outstanding: string;
  expensesByCategory: ExpenseCategoryBreakdown[];
}

export interface FinancialSummary {
  currencies: CurrencyRollup[];
}

const UNCATEGORISED = "Uncategorised";

/**
 * Groups every input row by currency and produces one independent rollup
 * per currency. No value is ever added across currencies.
 */
export function summariseFinancials(input: {
  revenueRows: readonly SettledLedgerRow[];
  expenseRows: readonly ExpenseRollupRow[];
  mileageRows: readonly MileageRollupRow[];
  outstandingRows: readonly OutstandingRollupRow[];
}): FinancialSummary {
  interface Bucket {
    revenue: Prisma.Decimal;
    expenses: Prisma.Decimal;
    mileage: Prisma.Decimal;
    outstanding: Prisma.Decimal;
    byCategory: Map<string, { categoryId: string | null; name: string; amount: Prisma.Decimal }>;
  }
  const buckets = new Map<string, Bucket>();
  const bucket = (currency: string): Bucket => {
    const key = normaliseCurrency(currency);
    let existing = buckets.get(key);
    if (!existing) {
      existing = { revenue: ZERO, expenses: ZERO, mileage: ZERO, outstanding: ZERO, byCategory: new Map() };
      buckets.set(key, existing);
    }
    return existing;
  };

  for (const row of input.revenueRows) {
    if (!SETTLED_STATUSES.has(row.status)) continue;
    const net = toDecimal(row.amount).minus(toDecimal(row.refundedAmount));
    const b = bucket(row.currency);
    b.revenue = b.revenue.plus(Prisma.Decimal.max(net, ZERO));
  }

  for (const row of input.expenseRows) {
    const amount = toDecimal(row.amount);
    const b = bucket(row.currency);
    b.expenses = b.expenses.plus(amount);
    const catKey = row.categoryId ?? "__uncategorised__";
    const entry = b.byCategory.get(catKey) ?? {
      categoryId: row.categoryId,
      name: row.categoryName ?? UNCATEGORISED,
      amount: ZERO,
    };
    entry.amount = entry.amount.plus(amount);
    b.byCategory.set(catKey, entry);
  }

  for (const row of input.mileageRows) {
    if (row.amount == null || row.currency == null) continue;
    const b = bucket(row.currency);
    b.mileage = b.mileage.plus(toDecimal(row.amount));
  }

  for (const row of input.outstandingRows) {
    const b = bucket(row.currency);
    b.outstanding = b.outstanding.plus(Prisma.Decimal.max(toDecimal(row.outstandingBalance), ZERO));
  }

  const currencies = [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, b]) => {
      const revenue = round2(b.revenue);
      const expenses = round2(b.expenses);
      const mileage = round2(b.mileage);
      return {
        currency,
        revenue: revenue.toFixed(TWO_DP),
        expenses: expenses.toFixed(TWO_DP),
        mileage: mileage.toFixed(TWO_DP),
        net: round2(revenue.minus(expenses).minus(mileage)).toFixed(TWO_DP),
        outstanding: round2(b.outstanding).toFixed(TWO_DP),
        expensesByCategory: [...b.byCategory.values()]
          .sort((x, y) => y.amount.comparedTo(x.amount) || x.name.localeCompare(y.name))
          .map(entry => ({
            categoryId: entry.categoryId,
            name: entry.name,
            amount: round2(entry.amount).toFixed(TWO_DP),
          })),
      };
    });

  return { currencies };
}
