import type { LeadAutomationRunDto, LeadDto, MessageDto } from '../apiTypes';
import type { TimelineItem } from '../types';

// What the owner needs to see on a missed-call lead: did the automatic
// follow-up go out, on which channel, and if not, why — plus the messages
// exchanged on the lead. Pure so it can be unit tested.

const channelName = (channel: string) => (channel.toUpperCase() === 'WHATSAPP' ? 'WhatsApp' : 'SMS');

function runItem(run: LeadAutomationRunDto, format: (iso: string | null) => string): TimelineItem {
  const channel = channelName(run.automationRule.channel);
  switch (run.status) {
    case 'PENDING':
    case 'RUNNING':
      return { id: `run:${run.id}`, date: 'SCHEDULED', title: `Automatic ${channel} follow-up`, detail: `Sending ${format(run.scheduledFor)}` };
    case 'COMPLETED':
      return { id: `run:${run.id}`, date: 'SENT', title: `Automatic ${channel} follow-up sent`, detail: format(run.completedAt), tone: 'success' };
    case 'CANCELLED':
      return { id: `run:${run.id}`, date: 'NOT SENT', title: `Automatic ${channel} follow-up skipped`, detail: run.errorMessage ?? undefined };
    default:
      return { id: `run:${run.id}`, date: 'FAILED', title: `Automatic ${channel} follow-up failed`, detail: run.errorMessage ?? undefined, tone: 'attention' };
  }
}

function messageItem(message: MessageDto, format: (iso: string | null) => string): TimelineItem {
  const inbound = message.direction === 'INBOUND';
  const channel = channelName(message.channel);
  // The server also reports carrier outcomes (delivered/undelivered) beyond MessageStatus.
  const status: string = message.status;
  const failed = status === 'failed' || status === 'undelivered';
  return {
    id: `msg:${message.id}`,
    date: inbound ? 'REPLY' : failed ? 'NOT DELIVERED' : status === 'delivered' ? 'DELIVERED' : 'SENT',
    title: inbound ? `Customer replied on ${channel}` : `${channel} message ${failed ? 'not delivered' : 'sent'}`,
    detail: `${format(message.sentAt ?? message.createdAt)} · ${message.body}`,
    tone: failed ? 'attention' : inbound ? 'success' : 'default',
  };
}

export function leadFollowUpTimeline(lead: Pick<LeadDto, 'source' | 'messages' | 'automationRuns'>, format: (iso: string | null) => string): TimelineItem[] {
  const runs = lead.automationRuns ?? [];
  // A sent run already has its message below; show the run itself only when
  // there is no message to show for it (scheduled, skipped, failed).
  const messageRunIds = new Set((lead.messages ?? []).map(message => message.automationRunId).filter(Boolean));
  const items = runs.filter(run => !(run.status === 'COMPLETED' && messageRunIds.has(run.id))).map(run => runItem(run, format));
  const messages = [...(lead.messages ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(message => messageItem(message, format));
  if (lead.source === 'missed_call' && runs.length === 0 && messages.length === 0) {
    items.push({ id: 'no-follow-up', date: 'NO FOLLOW-UP', title: 'No automatic follow-up was sent', detail: 'Turn on missed-call follow-up in More → Automation to message callers automatically.' });
  }
  return [...items, ...messages];
}
