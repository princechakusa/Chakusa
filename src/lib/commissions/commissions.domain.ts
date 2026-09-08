import { Prisma } from "@prisma/client";

// Advanced Team #12 — operational commissions (master directive s20:
// "operational commissions, no invented payroll").
//
// Pure derivation, no I/O. Given a business's active commission rules and its
// completed, priced appointments over a window, this computes the commission
// figure each team member would have earned. It is an internal planning
// number only: not payroll, not a payout instruction, no tax/withholding
// meaning, and never stored as a balance. Exact decimals throughout; a rule
// whose fixed-amount currency does not match the appointment's currency is
// skipped rather than converted (money rule s16 — no mixed-currency math).

const TWO_DP = 2;
const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);
const round2 = (value: Prisma.Decimal) => value.toDecimalPlaces(TWO_DP, Prisma.Decimal.ROUND_HALF_UP);
const toDecimal = (value: Prisma.Decimal | string | number | null | undefined): Prisma.Decimal =>
  value == null ? ZERO : value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
const normaliseCurrency = (value: string) => value.trim().toUpperCase();

export type CommissionBasis = "PERCENT_OF_SERVICE_PRICE" | "FIXED_PER_APPOINTMENT";

export interface CommissionRuleRow {
  businessMemberId: string;
  serviceOfferingId: string | null;
  basis: CommissionBasis;
  ratePercent: Prisma.Decimal | string | number | null;
  fixedAmount: Prisma.Decimal | string | number | null;
  fixedCurrency: string | null;
  active: boolean;
}

export interface CompletedAppointmentRow {
  id: string;
  assignedMemberId: string | null;
  serviceOfferingId: string | null;
  price: Prisma.Decimal | string | number | null;
  currency: string;
}

export interface CommissionMemberRow {
  businessMemberId: string;
  name: string;
}

export interface CommissionCurrencyTotals {
  currency: string;
  appointmentCount: number;
  serviceRevenue: string;
  commission: string;
}

export interface CommissionMemberReport {
  businessMemberId: string;
  name: string;
  currencies: CommissionCurrencyTotals[];
}

export interface CommissionReport {
  members: CommissionMemberReport[];
  /** Appointments that matched a member but no active rule. */
  appointmentsWithoutRule: number;
  /** Rules skipped for a currency mismatch against an appointment. */
  currencyMismatches: number;
  disclaimer: string;
}

const DISCLAIMER =
  "Operational estimate for planning only. Not payroll, not a payout, and no tax or withholding is applied.";

/** Picks the active rule for this member+service: a service-specific rule wins over the base rule. */
function resolveRule(rulesByMember: Map<string, CommissionRuleRow[]>, memberId: string, serviceOfferingId: string | null) {
  const rules = rulesByMember.get(memberId);
  if (!rules) return null;
  const specific = serviceOfferingId ? rules.find(r => r.active && r.serviceOfferingId === serviceOfferingId) : undefined;
  if (specific) return specific;
  return rules.find(r => r.active && r.serviceOfferingId === null) ?? null;
}

export function computeCommissionReport(input: {
  rules: readonly CommissionRuleRow[];
  appointments: readonly CompletedAppointmentRow[];
  members: readonly CommissionMemberRow[];
}): CommissionReport {
  const rulesByMember = new Map<string, CommissionRuleRow[]>();
  for (const rule of input.rules) {
    const list = rulesByMember.get(rule.businessMemberId) ?? [];
    list.push(rule);
    rulesByMember.set(rule.businessMemberId, list);
  }

  interface Bucket { appointmentCount: number; serviceRevenue: Prisma.Decimal; commission: Prisma.Decimal }
  const byMember = new Map<string, Map<string, Bucket>>();
  const bucket = (memberId: string, currency: string) => {
    const key = normaliseCurrency(currency);
    let currencies = byMember.get(memberId);
    if (!currencies) { currencies = new Map(); byMember.set(memberId, currencies); }
    let existing = currencies.get(key);
    if (!existing) { existing = { appointmentCount: 0, serviceRevenue: ZERO, commission: ZERO }; currencies.set(key, existing); }
    return existing;
  };

  let appointmentsWithoutRule = 0;
  let currencyMismatches = 0;

  for (const appt of input.appointments) {
    if (!appt.assignedMemberId || appt.price == null) continue;
    const rule = resolveRule(rulesByMember, appt.assignedMemberId, appt.serviceOfferingId);
    if (!rule) { appointmentsWithoutRule += 1; continue; }
    const price = toDecimal(appt.price);
    let commission: Prisma.Decimal;
    if (rule.basis === "PERCENT_OF_SERVICE_PRICE") {
      commission = round2(price.mul(toDecimal(rule.ratePercent)).div(HUNDRED));
    } else {
      if (!rule.fixedCurrency || normaliseCurrency(rule.fixedCurrency) !== normaliseCurrency(appt.currency)) { currencyMismatches += 1; continue; }
      commission = round2(toDecimal(rule.fixedAmount));
    }
    const b = bucket(appt.assignedMemberId, appt.currency);
    b.appointmentCount += 1;
    b.serviceRevenue = b.serviceRevenue.plus(price);
    b.commission = b.commission.plus(commission);
  }

  const nameById = new Map(input.members.map(m => [m.businessMemberId, m.name]));
  const members: CommissionMemberReport[] = [...byMember.entries()]
    .map(([memberId, currencies]) => ({
      businessMemberId: memberId,
      name: nameById.get(memberId) ?? "Former member",
      currencies: [...currencies.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([currency, b]) => ({
          currency,
          appointmentCount: b.appointmentCount,
          serviceRevenue: round2(b.serviceRevenue).toFixed(TWO_DP),
          commission: round2(b.commission).toFixed(TWO_DP),
        })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { members, appointmentsWithoutRule, currencyMismatches, disclaimer: DISCLAIMER };
}
