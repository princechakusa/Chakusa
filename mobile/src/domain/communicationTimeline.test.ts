import { describe, expect, it, vi } from 'vitest';
import { CommunicationTimelineEntryDto } from '../apiTypes';
import { availableCommunicationTabs, communicationTabLabel, filterCommunicationEntries, toTimelineItem } from './communicationTimeline';

function entry(overrides: Partial<CommunicationTimelineEntryDto> = {}): CommunicationTimelineEntryDto {
  return {
    id: 'entry-1',
    kind: 'lead_created',
    at: '2026-06-01T10:00:00Z',
    title: 'Lead created',
    detail: 'Haircut',
    tone: 'default',
    filters: ['recovery'],
    source: { type: 'lead', leadId: 'lead-1' },
    ...overrides,
  };
}

describe('availableCommunicationTabs', () => {
  it('always includes "all"', () => {
    expect(availableCommunicationTabs([])).toEqual(['all']);
  });

  it('only includes tabs that at least one entry actually carries', () => {
    const tabs = availableCommunicationTabs([entry({ filters: ['recovery'] }), entry({ id: 'e2', filters: ['payments'] })]);
    expect(tabs).toContain('recovery');
    expect(tabs).toContain('payments');
    expect(tabs).not.toContain('reviews');
    expect(tabs).not.toContain('manual');
  });

  it('never duplicates a tab shared by multiple entries', () => {
    const tabs = availableCommunicationTabs([entry({ filters: ['recovery'] }), entry({ id: 'e2', filters: ['recovery'] })]);
    expect(tabs.filter((t) => t === 'recovery')).toHaveLength(1);
  });
});

describe('filterCommunicationEntries', () => {
  it('returns everything for the "all" tab', () => {
    const entries = [entry({ filters: ['recovery'] }), entry({ id: 'e2', filters: ['payments'] })];
    expect(filterCommunicationEntries(entries, 'all')).toEqual(entries);
  });

  it('returns only entries carrying the selected filter', () => {
    const entries = [entry({ id: 'e1', filters: ['recovery'] }), entry({ id: 'e2', filters: ['payments'] })];
    expect(filterCommunicationEntries(entries, 'payments').map((e) => e.id)).toEqual(['e2']);
  });
});

describe('communicationTabLabel', () => {
  it('labels every tab in plain English', () => {
    expect(communicationTabLabel('needs_action')).toBe('Needs Action');
    expect(communicationTabLabel('all')).toBe('All');
  });
});

describe('toTimelineItem', () => {
  it('offers a "View lead" action for a lead-sourced entry', () => {
    const onViewLead = vi.fn();
    const item = toTimelineItem(entry({ source: { type: 'lead', leadId: 'lead-42' } }), { onViewLead, onViewReview: vi.fn() });
    expect(item.actionLabel).toBe('View lead');
    item.onPressAction?.();
    expect(onViewLead).toHaveBeenCalledWith('lead-42');
  });

  it('offers a "View review" action for a reviewRequest-sourced entry', () => {
    const onViewReview = vi.fn();
    const item = toTimelineItem(entry({ source: { type: 'reviewRequest', reviewRequestId: 'review-9' } }), { onViewLead: vi.fn(), onViewReview });
    expect(item.actionLabel).toBe('View review');
    item.onPressAction?.();
    expect(onViewReview).toHaveBeenCalledWith('review-9');
  });

  it('offers no action for a message-sourced entry', () => {
    const item = toTimelineItem(entry({ source: { type: 'message' } }), { onViewLead: vi.fn(), onViewReview: vi.fn() });
    expect(item.actionLabel).toBeUndefined();
    expect(item.onPressAction).toBeUndefined();
  });

  it('carries the title, detail, and tone through unchanged', () => {
    const item = toTimelineItem(entry({ title: 'Payment recorded', detail: '$50.00', tone: 'success' }), { onViewLead: vi.fn(), onViewReview: vi.fn() });
    expect(item.title).toBe('Payment recorded');
    expect(item.detail).toBe('$50.00');
    expect(item.tone).toBe('success');
  });
});
