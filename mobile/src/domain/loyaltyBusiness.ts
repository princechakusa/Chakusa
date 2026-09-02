import type {
  BusinessRewardDto,
  LoyaltyBusinessAnalyticsDto,
  LoyaltyCampaignDto,
  LoyaltyCampaignKind,
  LoyaltyProgramInput,
  LoyaltyRewardType,
  MembershipBillingInterval,
} from '../apiTypes';

// PROGRAM 2 LOOP 6: pure product rules for the business loyalty management
// mobile experience. Client-side validation for UX only — the backend
// (/loyalty/*) stays authoritative. No engine, no networking, no payment.

// --- Program config -------------------------------------------------------

export interface ProgramFormDraft {
  active: boolean;
  pointsPerCurrency: string;
  pointsPerBookingBonus: string;
  pointsPerReview: string;
  pointsPerReferral: string;
  pointExpiryDays: string; // '' = never
  welcomeBonus: string;
}

export function programStatusLabel(program: { active?: boolean; configured?: boolean } | null | undefined): 'Not set up' | 'Paused' | 'Active' {
  if (!program || program.configured === false) return 'Not set up';
  return program.active ? 'Active' : 'Paused';
}

const nonNegInt = (raw: string) => {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

export function validateProgramDraft(draft: ProgramFormDraft): { ok: boolean; errors: Partial<Record<keyof ProgramFormDraft, string>>; input?: LoyaltyProgramInput } {
  const errors: Partial<Record<keyof ProgramFormDraft, string>> = {};
  const ppc = Number(draft.pointsPerCurrency);
  if (!(ppc >= 0 && ppc <= 1000)) errors.pointsPerCurrency = 'Enter a number between 0 and 1000';
  for (const key of ['pointsPerBookingBonus', 'pointsPerReview', 'pointsPerReferral', 'welcomeBonus'] as const) {
    if (nonNegInt(draft[key]) == null) errors[key] = 'Whole number, 0 or more';
  }
  if (draft.pointExpiryDays.trim() !== '') {
    const d = Number(draft.pointExpiryDays);
    if (!(Number.isInteger(d) && d >= 1 && d <= 3650)) errors.pointExpiryDays = 'Days between 1 and 3650, or leave blank';
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    errors: {},
    input: {
      active: draft.active,
      pointsPerCurrency: ppc,
      pointsPerBookingBonus: nonNegInt(draft.pointsPerBookingBonus)!,
      pointsPerReview: nonNegInt(draft.pointsPerReview)!,
      pointsPerReferral: nonNegInt(draft.pointsPerReferral)!,
      welcomeBonus: nonNegInt(draft.welcomeBonus)!,
      pointExpiryDays: draft.pointExpiryDays.trim() === '' ? null : Number(draft.pointExpiryDays),
    },
  };
}

// --- Tier config ---------------------------------------------------------

export interface TierDraft { key: string; name: string; minPoints: string }

export function validateTiers(rows: TierDraft[]): { ok: boolean; error: string | null; tiers?: Array<{ key: string; name: string; minPoints: number; perks: string[] }> } {
  if (rows.length === 0) return { ok: true, error: null, tiers: [] };
  if (rows.length > 10) return { ok: false, error: 'A program can have at most 10 tiers' };
  const keys = new Set<string>();
  const parsed: Array<{ key: string; name: string; minPoints: number; perks: string[] }> = [];
  let lastMin = -1;
  for (const row of rows) {
    const key = row.key.trim().toLowerCase().replace(/\s+/g, '_');
    if (!key) return { ok: false, error: 'Every tier needs a key' };
    if (keys.has(key)) return { ok: false, error: `Duplicate tier key "${key}"` };
    keys.add(key);
    if (!row.name.trim()) return { ok: false, error: 'Every tier needs a name' };
    const minPoints = Number(row.minPoints);
    if (!(Number.isInteger(minPoints) && minPoints >= 0)) return { ok: false, error: `"${row.name}" needs a whole minimum-points value` };
    if (minPoints <= lastMin) return { ok: false, error: 'Tiers must be ordered by increasing minimum points' };
    lastMin = minPoints;
    parsed.push({ key, name: row.name.trim(), minPoints, perks: [] });
  }
  if (parsed[0].minPoints !== 0) return { ok: false, error: 'The first tier must start at 0 points' };
  return { ok: true, error: null, tiers: parsed };
}

// --- Reward type labels (never expose raw enum) -------------------------

export function rewardTypeLabel(type: LoyaltyRewardType): string {
  return {
    free_service: 'Free service',
    percent_discount: 'Percentage discount',
    fixed_discount: 'Fixed amount off',
    promo: 'Promotional reward',
    birthday: 'Birthday reward',
    milestone: 'Milestone reward',
  }[type];
}

/** Human summary of a reward's value, e.g. "20% off", "$10 off", "Free service". */
export function rewardValueSummary(reward: Pick<BusinessRewardDto, 'type' | 'value'>, currency = 'USD'): string {
  switch (reward.type) {
    case 'percent_discount': return reward.value != null ? `${reward.value}% off` : 'Percentage discount';
    case 'fixed_discount': return reward.value != null ? `${formatCurrency(reward.value, currency)} off` : 'Fixed discount';
    case 'free_service': return 'Free service';
    case 'birthday': return 'Birthday reward';
    case 'milestone': return 'Milestone reward';
    case 'promo': return 'Promotional reward';
  }
}

function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

export interface RewardFormDraft {
  name: string;
  description: string;
  type: LoyaltyRewardType;
  pointsCost: string;
  value: string;
  minTierKey: string;
  membersOnly: boolean;
  autoGrant: boolean;
  milestoneBookings: string;
  redemptionValidityDays: string;
}

export function validateRewardDraft(draft: RewardFormDraft): { ok: boolean; error: string | null } {
  if (!draft.name.trim()) return { ok: false, error: 'A reward needs a name' };
  const cost = Number(draft.pointsCost || '0');
  if (!(Number.isInteger(cost) && cost >= 0)) return { ok: false, error: 'Points cost must be a whole number, 0 or more' };
  if ((draft.type === 'percent_discount' || draft.type === 'fixed_discount') && draft.value.trim() === '') {
    return { ok: false, error: draft.type === 'percent_discount' ? 'Enter the discount percentage' : 'Enter the discount amount' };
  }
  if (draft.type === 'percent_discount' && draft.value.trim() !== '') {
    const pct = Number(draft.value);
    if (!(pct > 0 && pct <= 100)) return { ok: false, error: 'Percentage must be between 1 and 100' };
  }
  if (draft.value.trim() !== '' && Number(draft.value) < 0) return { ok: false, error: 'Value cannot be negative' };
  if (draft.type === 'milestone') {
    const n = Number(draft.milestoneBookings);
    if (!(Number.isInteger(n) && n >= 1)) return { ok: false, error: 'Milestone rewards need a completed-bookings target' };
  }
  if (draft.redemptionValidityDays.trim() !== '') {
    const d = Number(draft.redemptionValidityDays);
    if (!(Number.isInteger(d) && d >= 1 && d <= 365)) return { ok: false, error: 'Validity must be 1–365 days, or leave blank' };
  }
  return { ok: true, error: null };
}

// --- Membership plans --------------------------------------------------

export function billingIntervalLabel(interval: MembershipBillingInterval): string {
  return { monthly: 'Monthly', annual: 'Annual', unlimited: 'One-off / unlimited' }[interval];
}

export interface PlanFormDraft {
  name: string;
  description: string;
  billingInterval: MembershipBillingInterval;
  priceAmount: string;
  priorityBooking: boolean;
  discountPercent: string;
}

export function validatePlanDraft(draft: PlanFormDraft): { ok: boolean; error: string | null } {
  if (!draft.name.trim()) return { ok: false, error: 'A plan needs a name' };
  const price = Number(draft.priceAmount || '0');
  if (!(price >= 0)) return { ok: false, error: 'Price cannot be negative' };
  const disc = Number(draft.discountPercent || '0');
  if (!(disc >= 0 && disc <= 100)) return { ok: false, error: 'Discount must be between 0 and 100' };
  return { ok: true, error: null };
}

/**
 * The membership backend records an entitlement — it does NOT take a
 * payment. Every plan surface must say so.
 */
export const MEMBERSHIP_NO_PAYMENT_NOTE =
  'Enrolling a customer records the membership entitlement. Chakusa does not collect payment here — arrange billing with the customer directly.';

// --- Campaigns --------------------------------------------------------

export function campaignKindLabel(kind: LoyaltyCampaignKind): string {
  return { bonus_points: 'Bonus points', multiplier: 'Points multiplier', bonus_reward: 'Bonus reward' }[kind];
}

export interface CampaignFormDraft {
  name: string;
  description: string;
  kind: LoyaltyCampaignKind;
  multiplier: string;
  bonusPoints: string;
  startsAt: string; // ISO
  endsAt: string; // ISO
}

export function validateCampaignDraft(draft: CampaignFormDraft): { ok: boolean; error: string | null } {
  if (!draft.name.trim()) return { ok: false, error: 'A campaign needs a name' };
  const start = new Date(draft.startsAt).getTime();
  const end = new Date(draft.endsAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { ok: false, error: 'Choose start and end dates' };
  if (end <= start) return { ok: false, error: 'The end date must be after the start date' };
  if (draft.kind === 'multiplier') {
    const m = Number(draft.multiplier);
    if (!(m >= 1 && m <= 20)) return { ok: false, error: 'Multiplier must be between 1 and 20' };
  }
  if (draft.kind === 'bonus_points') {
    const b = Number(draft.bonusPoints);
    if (!(Number.isInteger(b) && b >= 0)) return { ok: false, error: 'Bonus points must be a whole number' };
  }
  return { ok: true, error: null };
}

export function campaignWindowLabel(campaign: Pick<LoyaltyCampaignDto, 'startsAt' | 'endsAt' | 'active'>, now: Date = new Date()): 'Scheduled' | 'Running' | 'Ended' | 'Off' {
  if (!campaign.active) return 'Off';
  const t = now.getTime();
  if (t < new Date(campaign.startsAt).getTime()) return 'Scheduled';
  if (t >= new Date(campaign.endsAt).getTime()) return 'Ended';
  return 'Running';
}

// --- Manual point adjustment ----------------------------------------

export interface AdjustmentDraft { amount: string; direction: 'add' | 'remove'; reason: string }

export function resolveAdjustment(draft: AdjustmentDraft): { ok: boolean; error: string | null; points?: number; reason?: string } {
  const magnitude = Number(draft.amount);
  if (!(Number.isInteger(magnitude) && magnitude > 0)) return { ok: false, error: 'Enter a whole number of points greater than 0' };
  if (magnitude > 1_000_000) return { ok: false, error: 'That is more than 1,000,000 points' };
  if (draft.reason.trim().length < 3) return { ok: false, error: 'A reason is required for every adjustment' };
  return { ok: true, error: null, points: draft.direction === 'remove' ? -magnitude : magnitude, reason: draft.reason.trim() };
}

export function projectedBalance(current: number, signedPoints: number): number {
  return Math.max(0, current + signedPoints);
}

// --- Analytics shaping --------------------------------------------

export interface AnalyticsTile { key: string; label: string; value: string; detail?: string }

export function analyticsTiles(a: LoyaltyBusinessAnalyticsDto): AnalyticsTile[] {
  const net30 = a.last30Days.pointsEarned - a.last30Days.pointsRedeemed;
  return [
    { key: 'members', label: 'Members', value: a.members.toLocaleString('en-US') },
    { key: 'outstanding', label: 'Outstanding points', value: a.outstandingPoints.toLocaleString('en-US'), detail: 'Points customers hold now' },
    { key: 'earned30', label: 'Points earned (30d)', value: a.last30Days.pointsEarned.toLocaleString('en-US'), detail: `${a.last30Days.earnEvents} events` },
    { key: 'redeemed30', label: 'Points redeemed (30d)', value: a.last30Days.pointsRedeemed.toLocaleString('en-US'), detail: `${a.last30Days.redeemEvents} redemptions` },
    { key: 'net30', label: 'Net points (30d)', value: `${net30 >= 0 ? '+' : ''}${net30.toLocaleString('en-US')}` },
    { key: 'campaigns', label: 'Active campaigns', value: String(a.activeCampaigns) },
  ];
}

export function tierBreakdownRows(a: LoyaltyBusinessAnalyticsDto): Array<{ tier: string; count: number; share: number }> {
  const entries = Object.entries(a.tierBreakdown);
  const total = entries.reduce((sum, [, n]) => sum + n, 0) || 1;
  return entries
    .map(([tier, count]) => ({ tier: tier || 'bronze', count, share: Number((count / total).toFixed(3)) }))
    .sort((x, y) => y.count - x.count);
}

// --- Redemption status --------------------------------------------

export function redemptionStatusLabel(status: string): string {
  return ({ issued: 'Issued', reserved: 'Reserved', redeemed: 'Redeemed', expired: 'Expired', revoked: 'Revoked' } as Record<string, string>)[status] ?? status;
}

export function canMarkRedeemed(status: string, expiresAt: string | null, now: Date = new Date()): boolean {
  if (status !== 'issued' && status !== 'reserved') return false;
  if (expiresAt && new Date(expiresAt).getTime() < now.getTime()) return false;
  return true;
}
export function canRevoke(status: string): boolean {
  return status === 'issued' || status === 'reserved' || status === 'expired';
}

export function normaliseRedemptionCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}
