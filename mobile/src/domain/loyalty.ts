import type {
  CustomerMembershipDto,
  LoyaltyAccountSummaryDto,
  LoyaltyRewardDto,
  LoyaltyTransactionDto,
  MembershipPlanDto,
  ReferralOverviewDto,
  WalletDto,
} from '../apiTypes';

// PROGRAM 2 LOOP 5: pure product rules for the loyalty / membership / reward
// / wallet / referral mobile surface — points + tier formatting, reward
// affordability, redemption code display, membership savings, referral
// progress, wallet aggregation, transaction labels, navigation guards. No
// networking, no payment / stored-value / redemption-of-cash logic.

// --- Navigation --------------------------------------------------------------

export type LoyaltyRoute = 'Loyalty' | 'Membership' | 'Rewards' | 'Wallet' | 'Referrals';
export const LOYALTY_ROUTES: readonly LoyaltyRoute[] = ['Loyalty', 'Membership', 'Rewards', 'Wallet', 'Referrals'];

/** Payment / checkout / stored-value / cash-out routes are out of scope this loop. */
export function isProhibitedLoyaltyRoute(route: string): boolean {
  return /^(Payment|Pay|Checkout|CashOut|Withdraw|TopUp|AddFunds|BuyPoints|StoredValue|GiftCard)/i.test(route);
}
export function canNavigateLoyalty(route: string): route is LoyaltyRoute {
  return (LOYALTY_ROUTES as readonly string[]).includes(route) && !isProhibitedLoyaltyRoute(route);
}

// --- Points & tiers -------------------------------------------------------

export function formatPoints(points: number): string {
  return `${points.toLocaleString('en-US')} pt${Math.abs(points) === 1 ? '' : 's'}`;
}

export interface TierProgress {
  currentTier: string;
  nextTier: string | null;
  pointsAway: number;
  /** 0..1 progress through the current tier band. */
  ratio: number;
}

export function tierProgress(account: Pick<LoyaltyAccountSummaryDto, 'lifetimePoints' | 'tier' | 'nextTier' | 'allTiers'>): TierProgress {
  const tiers = [...(account.allTiers ?? [])].sort((a, b) => (a.minPoints ?? 0) - (b.minPoints ?? 0));
  const currentMin = tiers.find((t) => t.key === account.tier.key)?.minPoints ?? 0;
  if (!account.nextTier) return { currentTier: account.tier.name, nextTier: null, pointsAway: 0, ratio: 1 };
  const span = account.nextTier.pointsAway + (account.lifetimePoints - currentMin);
  const done = account.lifetimePoints - currentMin;
  return {
    currentTier: account.tier.name,
    nextTier: account.nextTier.name,
    pointsAway: account.nextTier.pointsAway,
    ratio: span > 0 ? Math.max(0, Math.min(1, done / span)) : 0,
  };
}

// --- Rewards ------------------------------------------------------------------

export function rewardValueLabel(reward: Pick<LoyaltyRewardDto, 'type' | 'value'>): string {
  switch (reward.type) {
    case 'free_service': return 'Free service';
    case 'percent_discount': return reward.value != null ? `${reward.value}% off` : 'Discount';
    case 'fixed_discount': return reward.value != null ? `${reward.value} off` : 'Discount';
    case 'promo': return 'Promotional reward';
    case 'birthday': return 'Birthday reward';
    case 'milestone': return 'Milestone reward';
  }
}

export function rewardCtaLabel(reward: Pick<LoyaltyRewardDto, 'redeemable' | 'affordable' | 'pointsShort' | 'tierEligible' | 'memberEligible' | 'type'>): string {
  if (reward.type === 'milestone') return 'Earned automatically';
  if (!reward.memberEligible) return 'Members only';
  if (!reward.tierEligible) return 'Reach a higher tier';
  if (!reward.affordable) return `${formatPoints(reward.pointsShort)} to go`;
  return reward.redeemable ? 'Redeem' : 'Unavailable';
}

/** Sorts: redeemable first, then closest to affordable, then cheapest. */
export function sortRewards(rewards: LoyaltyRewardDto[]): LoyaltyRewardDto[] {
  return [...rewards].sort((a, b) => {
    if (a.redeemable !== b.redeemable) return a.redeemable ? -1 : 1;
    if (a.pointsShort !== b.pointsShort) return a.pointsShort - b.pointsShort;
    return a.pointsCost - b.pointsCost;
  });
}

export function redemptionCodeDisplay(code: string): string {
  return code.replace(/(.{4})/g, '$1 ').trim().toUpperCase();
}

// --- Transactions -------------------------------------------------------

export function transactionLabel(txn: Pick<LoyaltyTransactionDto, 'kind' | 'points' | 'reason'>): string {
  const sign = txn.points >= 0 ? '+' : '';
  const base = txn.reason ?? { earn: 'Points earned', redeem: 'Points redeemed', expire: 'Points expired', adjust: 'Adjustment', revoke: 'Points removed' }[txn.kind];
  return `${base} (${sign}${txn.points})`;
}

export function groupTransactionsByMonth(txns: LoyaltyTransactionDto[]): Array<{ month: string; items: LoyaltyTransactionDto[] }> {
  const byMonth = new Map<string, LoyaltyTransactionDto[]>();
  for (const txn of [...txns].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const month = txn.createdAt.slice(0, 7);
    (byMonth.get(month) ?? byMonth.set(month, []).get(month)!).push(txn);
  }
  return [...byMonth.entries()].map(([month, items]) => ({ month, items }));
}

// --- Memberships ------------------------------------------------------

export function membershipSavings(plan: Pick<MembershipPlanDto, 'discountPercent' | 'priceAmount' | 'billingInterval'>, monthlySpend: number): number {
  if (plan.discountPercent <= 0) return 0;
  const periodMonths = plan.billingInterval === 'annual' ? 12 : plan.billingInterval === 'unlimited' ? 12 : 1;
  const discountValue = monthlySpend * periodMonths * (plan.discountPercent / 100);
  return Number((discountValue - plan.priceAmount).toFixed(2));
}

export function membershipStatusLabel(m: Pick<CustomerMembershipDto, 'status' | 'cancelAtPeriodEnd' | 'currentPeriodEnd'>): string {
  if (m.status === 'active' && m.cancelAtPeriodEnd) return 'Ends at period end';
  return { active: 'Active', cancelled: 'Cancelled', expired: 'Expired', paused: 'Paused' }[m.status];
}

export function isMembershipActive(m: Pick<CustomerMembershipDto, 'status'>): boolean {
  return m.status === 'active';
}

/** Member price for a list price, given an active membership discount (0 when none). */
export function memberPrice(listPrice: number, discountPercent: number): number {
  if (discountPercent <= 0) return listPrice;
  return Number((listPrice * (1 - discountPercent / 100)).toFixed(2));
}

// --- Wallet aggregation ----------------------------------------------

export interface WalletSummary {
  totalPoints: number;
  businessCount: number;
  topTier: string | null;
  activeMemberships: number;
  unusedRewards: number;
  referralsCompleted: number;
}

export function walletSummary(wallet: WalletDto): WalletSummary {
  const tierOrder = ['bronze', 'silver', 'gold', 'platinum'];
  const topTier = wallet.accounts
    .map((a) => a.tier.key)
    .sort((a, b) => tierOrder.indexOf(b) - tierOrder.indexOf(a))[0] ?? null;
  return {
    totalPoints: wallet.totalPoints,
    businessCount: wallet.accounts.length,
    topTier,
    activeMemberships: wallet.activeMemberships,
    unusedRewards: wallet.rewards.issued,
    referralsCompleted: wallet.referrals.completed,
  };
}

// --- Referrals -------------------------------------------------------

export function referralProgress(overview: ReferralOverviewDto): { invited: number; joined: number; completed: number; conversionRate: number } {
  const { total, joined, completed } = overview.summary;
  return { invited: total, joined, completed, conversionRate: total > 0 ? Number((completed / total).toFixed(2)) : 0 };
}

export function referralStatusLabel(status: ReferralOverviewDto['referrals'][number]['status']): string {
  return { pending: 'Invite sent', joined: 'Signed up', completed: 'Completed', expired: 'Expired', rejected: 'Not eligible' }[status];
}

export function shareInviteMessage(code: string, inviteUrl: string): string {
  return `Join me on Chakusa — use my code ${code}: ${inviteUrl}`;
}
