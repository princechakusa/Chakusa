import type { RootStackParamList } from '../types';

export type DirectNotificationTarget =
  | { screen: 'LeadDetail'; params: RootStackParamList['LeadDetail'] }
  | { screen: 'ReviewDetail'; params: RootStackParamList['ReviewDetail'] }
  | { screen: 'AppointmentEditor'; params: RootStackParamList['AppointmentEditor'] };

interface DirectNotificationData {
  type?: unknown;
  leadId?: unknown;
  reviewRequestId?: unknown;
  appointmentId?: unknown;
}

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

export function directNotificationTarget(data: unknown): DirectNotificationTarget | null {
  if (!data || typeof data !== 'object') return null;
  const payload = data as DirectNotificationData;
  if (payload.type === 'lead' && isNonEmptyString(payload.leadId)) return { screen: 'LeadDetail', params: { leadId: payload.leadId } };
  if (payload.type === 'review_request' && isNonEmptyString(payload.reviewRequestId)) return { screen: 'ReviewDetail', params: { reviewId: payload.reviewRequestId } };
  if (payload.type === 'appointment' && isNonEmptyString(payload.appointmentId)) return { screen: 'AppointmentEditor', params: { appointmentId: payload.appointmentId } };
  return null;
}
