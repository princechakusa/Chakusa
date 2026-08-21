import type { LeadDto } from '../apiTypes';

export type RecoveryPriority = 'high' | 'medium' | 'standard';

export function recoverySourceLabel(source: string | null | undefined) {
  if (!source) return 'Customer opportunity';
  if (source === 'missed_call') return 'Missed call';
  return source.replace(/[_-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

export function recoveryPriority(lead: Pick<LeadDto, 'urgency' | 'status'>): RecoveryPriority {
  if (lead.status === 'new' && lead.urgency === 'high') return 'high';
  if (lead.status === 'new' || lead.urgency === 'high') return 'medium';
  return 'standard';
}

export function recoveryPriorityLabel(priority: RecoveryPriority) {
  return ({ high: 'Act now', medium: 'Needs attention', standard: 'On track' })[priority];
}

export function recoveryNextStep(lead: Pick<LeadDto, 'status' | 'generatedReply'>) {
  if (lead.status === 'new') return lead.generatedReply
    ? { title: 'Contact this customer', detail: 'Your follow-up message is ready to use.', action: 'Open message' }
    : { title: 'Prepare a follow-up', detail: 'Reply while this opportunity is still fresh.', action: 'Prepare message' };
  if (lead.status === 'contacted') return { title: 'Record the outcome', detail: 'Keep the recovery history accurate after the conversation.', action: 'Update status' };
  if (lead.status === 'booked') return { title: 'Close the loop', detail: 'Mark the outcome once the appointment is complete.', action: 'Update status' };
  return lead.status === 'won'
    ? { title: 'Recovered', detail: 'This opportunity is included in recovered revenue.', action: 'View timeline' }
    : { title: 'Recovery closed', detail: 'This opportunity is retained in the customer history.', action: 'View timeline' };
}
