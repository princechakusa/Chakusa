// PROGRAM 2 LOOP 7: customer navigation rules — pure functions.
//
// Two jobs:
//  1. Parse an incoming deep link (chakusa://…) into a customer
//     destination, so a notification tap or a shared link lands on the
//     right screen.
//  2. Enforce the customer/business boundary: a customer build must never
//     resolve a link to a business-owner destination, even if a crafted
//     URL asks for one.

export type CustomerRouteName =
  | 'CustomerTabs'
  | 'CustomerHome'
  | 'CustomerExplore'
  | 'CustomerBookings'
  | 'CustomerAccount'
  | 'BusinessProfile'
  | 'BookingFlow'
  | 'BookingDetail'
  | 'CustomerNotifications'
  | 'CustomerAssistant'
  | 'CustomerRewards'
  | 'CustomerLoyaltyBusiness'
  | 'CustomerLoyaltyHistory'
  | 'CustomerRewardDetail'
  | 'CustomerRedemptions'
  | 'CustomerMemberships'
  | 'CustomerMembershipPlans'
  | 'CustomerReferrals'
  | 'EditCustomerProfile'
  | 'CustomerLegalDocument';

export const CUSTOMER_ROUTES: readonly CustomerRouteName[] = [
  'CustomerTabs', 'CustomerHome', 'CustomerExplore', 'CustomerBookings', 'CustomerAccount',
  'BusinessProfile', 'BookingFlow', 'BookingDetail', 'CustomerNotifications', 'CustomerAssistant',
  'CustomerRewards', 'CustomerLoyaltyBusiness', 'CustomerLoyaltyHistory', 'CustomerRewardDetail',
  'CustomerRedemptions', 'CustomerMemberships', 'CustomerMembershipPlans', 'CustomerReferrals',
  'EditCustomerProfile', 'CustomerLegalDocument',
];

// Anything the business owner app owns. A customer build has no screen for
// these and must never navigate to one. Kept as a broad prefix test so a
// future business route cannot silently slip through.
const BUSINESS_ONLY = /^(Dashboard|Calendar|Leads|Reviews|Customers|Settings|Team|Automation|Billing|Subscription|Loyalty(Management|Program|Rewards|Members|Membership|Campaign|Redemption)|Service(Catalog|Offering)|Appointment(s|Editor)|Messaging|Onboarding|Ftue|Plan|Value|Coaching|WeeklyReport)/i;

export function isBusinessOnlyRoute(route: string): boolean {
  return BUSINESS_ONLY.test(route);
}

/** A route is reachable from the customer app only if it is a known customer route and not a business route. */
export function canNavigateCustomer(route: string): route is CustomerRouteName {
  return (CUSTOMER_ROUTES as readonly string[]).includes(route) && !isBusinessOnlyRoute(route);
}

export type CustomerDeepLink =
  | { route: 'BusinessProfile'; params: { slug: string } }
  | { route: 'BookingFlow'; params: { slug: string } }
  | { route: 'BookingDetail'; params: { bookingId: string } }
  | { route: 'CustomerAssistant'; params: { conversationId?: string } }
  | { route: 'CustomerNotifications'; params: Record<string, never> }
  | { route: 'CustomerRewards'; params: Record<string, never> }
  | { route: 'CustomerLoyaltyBusiness'; params: { businessId: string } }
  | { route: 'CustomerRedemptions'; params: Record<string, never> }
  | { route: 'CustomerMemberships'; params: Record<string, never> }
  | { route: 'CustomerReferrals'; params: Record<string, never> }
  | { route: 'CustomerHome'; params: Record<string, never> };

function stripPrefix(raw: string): string {
  let path = raw.trim();
  path = path.replace(/^chakusa:\/\//i, '');
  path = path.replace(/^https?:\/\/[^/]+/i, '');
  path = path.replace(/[?#].*$/, '');
  path = path.replace(/^\/+/, '').replace(/\/+$/, '');
  return path;
}

/**
 * Parse a deep link into a customer destination, or null when it does not
 * map to one. Never returns a business destination: a link like
 * `chakusa://dashboard` resolves to null, not to a business screen.
 */
export function parseCustomerDeepLink(raw: string): CustomerDeepLink | null {
  if (!raw) return null;
  const path = stripPrefix(raw);
  if (!path) return null;
  const segments = path.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
  const [head, a] = segments;

  switch (head) {
    case 'business':
    case 'businesses':
      return a ? { route: 'BusinessProfile', params: { slug: a } } : null;
    case 'book':
    case 'booking':
      // `book/<slug>` starts a booking; `booking/<id>` opens an existing one.
      if (!a) return null;
      return head === 'book'
        ? { route: 'BookingFlow', params: { slug: a } }
        : { route: 'BookingDetail', params: { bookingId: a } };
    case 'bookings':
      return a ? { route: 'BookingDetail', params: { bookingId: a } } : { route: 'CustomerHome', params: {} };
    case 'assistant':
    case 'ai':
      return { route: 'CustomerAssistant', params: a ? { conversationId: a } : {} };
    case 'notifications':
      return { route: 'CustomerNotifications', params: {} };
    case 'rewards':
    case 'my-rewards':
      return { route: 'CustomerRewards', params: {} };
    case 'loyalty':
      // `loyalty/<businessId>` opens that business's loyalty detail. The
      // id is a public business id already used by /customer/loyalty/* —
      // no business-owner route is reachable from here.
      return a ? { route: 'CustomerLoyaltyBusiness', params: { businessId: a } } : { route: 'CustomerRewards', params: {} };
    case 'redemptions':
      return { route: 'CustomerRedemptions', params: {} };
    case 'memberships':
      return { route: 'CustomerMemberships', params: {} };
    case 'referrals':
      return { route: 'CustomerReferrals', params: {} };
    case 'home':
      return { route: 'CustomerHome', params: {} };
    default:
      // Business-owner deep links (dashboard, leads, team-invite, …) are
      // deliberately unhandled here.
      return null;
  }
}

/** Whether a deep link, if followed, would keep the customer inside their own app. */
export function isSafeCustomerDeepLink(raw: string): boolean {
  const parsed = parseCustomerDeepLink(raw);
  return parsed != null && canNavigateCustomer(parsed.route);
}
