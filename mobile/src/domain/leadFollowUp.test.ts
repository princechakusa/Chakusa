import { describe, expect, it } from 'vitest';
import type { LeadAutomationRunDto, MessageDto } from '../apiTypes';
import { leadFollowUpTimeline } from './leadFollowUp';

const fmt = (iso: string | null) => iso ?? '-';
const run = (overrides: Partial<LeadAutomationRunDto>): LeadAutomationRunDto => ({ id: 'r1', status: 'PENDING', scheduledFor: '2026-10-15T19:21:00Z', completedAt: null, cancelledAt: null, errorMessage: null, automationRule: { channel: 'WHATSAPP' }, ...overrides });
const message = (overrides: Partial<MessageDto>): MessageDto => ({ id: 'm1', body: 'Sorry we missed your call', status: 'sent', channel: 'whatsapp', sentAt: '2026-10-15T19:21:05Z', createdAt: '2026-10-15T19:21:05Z', ...overrides });

describe('leadFollowUpTimeline', () => {
  it('tells the owner when a missed call got no automatic follow-up', () => {
    const items = leadFollowUpTimeline({ source: 'missed_call', messages: [], automationRuns: [] }, fmt);
    expect(items).toEqual([expect.objectContaining({ id: 'no-follow-up', title: 'No automatic follow-up was sent' })]);
  });

  it('shows a scheduled WhatsApp follow-up', () => {
    expect(leadFollowUpTimeline({ source: 'missed_call', messages: [], automationRuns: [run({})] }, fmt)[0]).toMatchObject({ date: 'SCHEDULED', title: 'Automatic WhatsApp follow-up' });
  });

  it('explains why a follow-up was skipped', () => {
    const items = leadFollowUpTimeline({ source: 'missed_call', messages: [], automationRuns: [run({ status: 'CANCELLED', errorMessage: 'Customer has opted out of WHATSAPP' })] }, fmt);
    expect(items[0]).toMatchObject({ date: 'NOT SENT', detail: 'Customer has opted out of WHATSAPP' });
  });

  it('shows the sent message once (not also the completed run) and the customer reply', () => {
    const items = leadFollowUpTimeline({
      source: 'missed_call',
      automationRuns: [run({ status: 'COMPLETED', completedAt: '2026-10-15T19:21:05Z' })],
      messages: [message({ id: 'reply', direction: 'INBOUND', body: 'Can I book for tomorrow?', createdAt: '2026-10-15T19:25:00Z', sentAt: null }), message({ automationRunId: 'r1', direction: 'OUTBOUND' })],
    }, fmt);
    expect(items.map(item => item.title)).toEqual(['WhatsApp message sent', 'Customer replied on WhatsApp']);
  });

  it('flags an undelivered message', () => {
    const items = leadFollowUpTimeline({ source: 'missed_call', automationRuns: [], messages: [message({ status: 'undelivered' as MessageDto['status'], channel: 'sms' })] }, fmt);
    expect(items[0]).toMatchObject({ date: 'NOT DELIVERED', title: 'SMS message not delivered', tone: 'attention' });
  });
});
