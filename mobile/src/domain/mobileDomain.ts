import type { LeadStatus, SubscriptionStatusValue } from '../apiTypes';
const leadTransitions: Record<LeadStatus, Exclude<LeadStatus, 'new'>[]> = { new: ['contacted', 'won', 'lost'], contacted: ['booked', 'won', 'lost'], booked: ['won', 'lost'], won: [], lost: [] };
export const getAllowedLeadTransitions = (status: LeadStatus) => leadTransitions[status];
export const displayLimit = (limit: number | null) => limit === null ? 'Unlimited' : String(limit);
export const subscriptionStatusCopy = (status: SubscriptionStatusValue) => ({ ACTIVE: 'Active', TRIALING: 'Trial', GRACE_PERIOD: 'Payment issue', EXPIRED: 'Expired', CANCELED: 'Canceled' })[status];
export const clearPlanSnapshot = () => null;
export function mapEntitlementError(code?: string, details: { limit?: number } = {}) { if (code === 'LIMIT_REACHED') return { title: `You've reached your Free plan limit`, body: typeof details.limit === 'number' ? `You've used all ${details.limit} available on the Free plan.` : `You've reached the usage available on the Free plan.` }; if (code === 'FEATURE_NOT_AVAILABLE' || code === 'PLAN_REQUIRED') return { title: 'This is a Pro feature', body: 'This capability requires Chakusa Pro.' }; return null; }
