import { CommunicationFilter, CommunicationTimelineEntryDto } from '../apiTypes';
import { TimelineItem } from '../types';
import { formatDate } from '../utils/format';

/**
 * The Conversation & Communication Center's filter tabs (Stage 9, Part 5) —
 * "all" plus whichever CommunicationFilter values the backend's timeline
 * entries actually carry. Kept in domain (not the screen) so the ordering
 * and tab→label mapping have one home, matching the architecture standard
 * of business logic living outside screens.
 */
export type CommunicationTab = 'all' | CommunicationFilter;

const TAB_LABELS: Record<CommunicationTab, string> = {
  all: 'All',
  needs_action: 'Needs Action',
  automated: 'Automated',
  manual: 'Manual',
  reviews: 'Reviews',
  payments: 'Payments',
  recovery: 'Recovery',
};

const TAB_ORDER: CommunicationTab[] = ['all', 'needs_action', 'recovery', 'reviews', 'payments', 'automated', 'manual'];

export function communicationTabLabel(tab: CommunicationTab): string {
  return TAB_LABELS[tab];
}

/** Only ever offers a tab when at least one timeline entry actually carries it — "Only expose filters backed by repository data" (Part 5). */
export function availableCommunicationTabs(entries: CommunicationTimelineEntryDto[]): CommunicationTab[] {
  const present = new Set<CommunicationTab>(['all']);
  for (const entry of entries) {
    for (const filter of entry.filters) present.add(filter);
  }
  return TAB_ORDER.filter((tab) => present.has(tab));
}

export function filterCommunicationEntries(entries: CommunicationTimelineEntryDto[], tab: CommunicationTab): CommunicationTimelineEntryDto[] {
  if (tab === 'all') return entries;
  return entries.filter((entry) => entry.filters.includes(tab));
}

export interface CommunicationEntryActions {
  onViewLead: (leadId: string) => void;
  onViewReview: (reviewRequestId: string) => void;
}

/**
 * Reuses the existing Timeline component (mobile/src/components/ui.tsx) —
 * this only shapes data into the TimelineItem it already accepts, adding
 * an optional per-row "View" action (Part 3) that deep-links to the exact
 * existing detail screen for that entry's source, never a new screen.
 */
export function toTimelineItem(entry: CommunicationTimelineEntryDto, actions: CommunicationEntryActions): TimelineItem {
  const source = entry.source;
  const action =
    source.type === 'lead'
      ? { actionLabel: 'View lead', onPressAction: () => actions.onViewLead(source.leadId) }
      : source.type === 'reviewRequest'
        ? { actionLabel: 'View review', onPressAction: () => actions.onViewReview(source.reviewRequestId) }
        : {};

  return {
    id: entry.id,
    date: formatDate(entry.at, { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase(),
    title: entry.title,
    detail: entry.detail ?? undefined,
    tone: entry.tone,
    ...action,
  };
}
