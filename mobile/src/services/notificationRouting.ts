import { RootStackParamList } from '../types';
import { directNotificationTarget } from '../domain/notificationTarget';
import { feedbackApi } from './endpoints';

export type NotificationTarget =
  | { screen: 'LeadDetail'; params: RootStackParamList['LeadDetail'] }
  | { screen: 'ReviewDetail'; params: RootStackParamList['ReviewDetail'] }
  | { screen: 'CustomerProfile'; params: RootStackParamList['CustomerProfile'] }
  | { screen: 'AppointmentEditor'; params: RootStackParamList['AppointmentEditor'] };

interface RawNotificationData {
  type?: unknown;
  leadId?: unknown;
  feedbackId?: unknown;
  reviewRequestId?: unknown;
  appointmentId?: unknown;
}

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

/**
 * There is no dedicated feedback screen — feedback is only ever displayed
 * embedded in ReviewDetail (when linked to a review request) or in
 * CustomerProfile's activity timeline (when linked to a customer). This
 * looks the feedback row up through the existing authenticated /feedback
 * list endpoint (the only way to resolve a feedbackId to its parent) and
 * picks whichever existing screen actually shows it. Returns null — never
 * throws — so a stale id, a network failure, or a feedback row with neither
 * link fails safely into "no navigation" instead of a crash.
 */
async function resolveFeedbackTarget(feedbackId: string): Promise<NotificationTarget | null> {
  try {
    const items = await feedbackApi.list();
    const match = items.find(item => item.id === feedbackId);
    if (!match) return null;
    if (match.reviewRequestId) return { screen: 'ReviewDetail', params: { reviewId: match.reviewRequestId } };
    if (match.customerId) return { screen: 'CustomerProfile', params: { customerId: match.customerId } };
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolves a tapped push notification's `data` payload to an existing
 * screen + params, or null for anything malformed/unknown. Never throws —
 * the notification payload is untrusted input (it's just routing data, not
 * an authorization grant; the destination screens themselves fetch through
 * the normal authenticated API and enforce tenant isolation server-side).
 */
export async function resolveNotificationTarget(data: unknown): Promise<NotificationTarget | null> {
  if (!data || typeof data !== 'object') return null;
  const payload = data as RawNotificationData;
  const directTarget = directNotificationTarget(payload);
  if (directTarget) return directTarget;

  switch (payload.type) {
    case 'feedback':
      return isNonEmptyString(payload.feedbackId) ? resolveFeedbackTarget(payload.feedbackId) : null;
    default:
      return null;
  }
}
