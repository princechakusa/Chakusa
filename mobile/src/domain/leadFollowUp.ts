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

// Twilio error codes an owner can act on, in plain words.
const PROVIDER_ERRORS: Record<string, string> = {
  '63015': 'This number has not joined the WhatsApp test sender yet. Send the "join" code from that phone first.',
  '63016': 'WhatsApp needs an approved template to start a conversation (outside the 24-hour reply window).',
  '63003': 'This number is not on WhatsApp or cannot receive WhatsApp messages.',
  '63024': 'WhatsApp rejected the recipient as invalid.',
  '21408': 'SMS to this country is not enabled on the Twilio account.',
  '21659': 'The SMS sender number is not on the Twilio account (or cannot send to this country).',
  '21608': 'A trial Twilio account can only text verified numbers.',
  '21610': 'The customer has replied STOP to this number.',
  '21612': 'This route cannot send to that number (the sender cannot reach this country or carrier).',
  '21614': 'This number cannot receive SMS.',
  '30003': 'The phone is unreachable or switched off.',
  '30004': 'The message was blocked by the recipient or carrier.',
  '30005': 'Unknown or inactive number.',
  '30006': 'The number is a landline or cannot receive SMS.',
  '30007': 'The carrier filtered the message as spam.',
  '30008': 'Unknown delivery error from the carrier.',
};

export function providerErrorText(code: string | null | undefined): string | undefined {
  if (!code) return undefined;
  return `${PROVIDER_ERRORS[code] ?? 'The provider rejected this message.'} (error ${code})`;
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
    detail: [failed ? providerErrorText(message.providerErrorCode) : undefined, `${format(message.sentAt ?? message.createdAt)} · ${message.body}`].filter(Boolean).join(' · '),
    tone: failed ? 'attention' : inbound ? 'success' : 'default',
  };
}

export function leadFollowUpTimeline(lead: Pick<LeadDto, 'source' | 'messages' | 'automationRuns'>, format: (iso: string | null) => string): TimelineItem[] {
  const runs = lead.automationRuns ?? [];
    const messageRunIds = new Set((lead.messages ?? []).map(message => message.automationRunId).filter(Boolean));
  // A run that produced a message (sent or failed) is shown by that message.
  const items = runs.filter(run => !messageRunIds.has(run.id)).map(run => runItem(run, format));
  const messages = [...(lead.messages ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(message => messageItem(message, format));
  if (lead.source === 'missed_call' && runs.length === 0 && messages.length === 0) {
    items.push({ id: 'no-follow-up', date: 'NO FOLLOW-UP', title: 'No automatic follow-up was sent', detail: 'Turn on missed-call follow-up in More → Automation to message callers automatically.' });
  }
  return [...items, ...messages];
}
