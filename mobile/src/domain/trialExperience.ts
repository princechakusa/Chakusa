import type { SubscriptionStatusDto } from '../apiTypes';

export function trialDaysRemaining(trialEndsAt: string | null, now = new Date()): number | null {
  if (!trialEndsAt) return null;
  const milliseconds = new Date(trialEndsAt).getTime() - now.getTime();
  if (!Number.isFinite(milliseconds)) return null;
  return Math.max(0, Math.ceil(milliseconds / 86_400_000));
}

export function trialProgressCopy(subscription: Pick<SubscriptionStatusDto, 'status' | 'trialEndsAt' | 'value'>, now = new Date()) {
  if (subscription.status !== 'TRIALING') return null;
  const days = trialDaysRemaining(subscription.trialEndsAt, now);
  const outcomes = subscription.value.completedAppointmentsThisMonth + subscription.value.customerMessagesSentThisMonth + subscription.value.reviewsReceivedThisMonth;
  return {
    title: days === null ? 'Your Pro trial is active' : days === 0 ? 'Your Pro trial ends today' : `${days} day${days === 1 ? '' : 's'} left in your Pro trial`,
    message: outcomes > 0 ? `Chakusa has already recorded ${outcomes} customer result${outcomes === 1 ? '' : 's'} during this trial.` : 'Complete your first booking journey so you can judge Pro using real business results.',
  };
}
