import type {
  CustomerAIConversationDto,
  CustomerAIMessageDto,
  CustomerAIRecommendationDto,
  CustomerAISettingsDto,
  CustomerAIToolResultDto,
} from '../apiTypes';

// PROGRAM 2 LOOP 4: pure product rules for the Customer AI Assistant mobile
// surface — conversation list ordering, title derivation, message grouping,
// tool-call summaries, recommendation copy, settings toggle state, cursor
// pagination and navigation guards. No AI, no networking, no payment /
// loyalty / wallet logic.

// --- Navigation --------------------------------------------------------------

export type AssistantRoute = 'AIAssistant' | 'AIConversation' | 'AIRecommendations' | 'AISettings';
export const ASSISTANT_ROUTES: readonly AssistantRoute[] = ['AIAssistant', 'AIConversation', 'AIRecommendations', 'AISettings'];

/** Payment / loyalty / wallet / membership destinations are out of scope for this loop. */
export function isProhibitedAssistantRoute(route: string): boolean {
  return /^(Payment|Pay|Checkout|Loyalty|Rewards|Membership|Wallet|Referral|Points|Redeem)/i.test(route);
}
export function canNavigateAssistant(route: string): route is AssistantRoute {
  return (ASSISTANT_ROUTES as readonly string[]).includes(route) && !isProhibitedAssistantRoute(route);
}

// --- Conversation list -------------------------------------------------

/** Pinned first, then most-recent activity, then newest created. Archived/deleted excluded. */
export function sortConversations(list: CustomerAIConversationDto[]): CustomerAIConversationDto[] {
  return [...list]
    .filter((c) => !c.archivedAt)
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const at = a.lastMessageAt ?? a.createdAt;
      const bt = b.lastMessageAt ?? b.createdAt;
      if (at !== bt) return bt.localeCompare(at);
      return b.createdAt.localeCompare(a.createdAt);
    });
}

export function partitionConversations(list: CustomerAIConversationDto[]): { active: CustomerAIConversationDto[]; archived: CustomerAIConversationDto[] } {
  return {
    active: sortConversations(list),
    archived: list.filter((c) => c.archivedAt).sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? '')),
  };
}

export function filterConversations(list: CustomerAIConversationDto[], search: string): CustomerAIConversationDto[] {
  const q = search.trim().toLowerCase();
  if (!q) return list;
  return list.filter((c) => (c.title ?? 'Untitled').toLowerCase().includes(q));
}

/** Derives a thread title from the first user message when the server has none yet. */
export function deriveConversationTitle(conversation: CustomerAIConversationDto, firstUserMessage?: string): string {
  if (conversation.title && conversation.title.trim()) return conversation.title.trim();
  const text = (firstUserMessage ?? '').trim().replace(/\s+/g, ' ');
  if (!text) return 'New conversation';
  return text.length <= 48 ? text : `${text.slice(0, 45)}…`;
}

// --- Messages ---------------------------------------------------------------

export interface MessageGroup {
  date: string; // YYYY-MM-DD
  messages: CustomerAIMessageDto[];
}

export function groupMessagesByDay(messages: CustomerAIMessageDto[], timeZone = 'UTC'): MessageGroup[] {
  const byDay = new Map<string, CustomerAIMessageDto[]>();
  const key = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  for (const message of [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const k = key(message.createdAt);
    (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(message);
  }
  return [...byDay.entries()].map(([date, msgs]) => ({ date, messages: msgs }));
}

export function toolCallSummary(results: CustomerAIToolResultDto[] | null | undefined): string {
  if (!results || !results.length) return '';
  const ok = results.filter((r) => r.ok).length;
  const denied = results.filter((r) => r.denied).length;
  const failed = results.filter((r) => !r.ok && !r.denied).length;
  const parts = [`${ok} ok`];
  if (denied) parts.push(`${denied} blocked`);
  if (failed) parts.push(`${failed} failed`);
  return `${results.length} action${results.length === 1 ? '' : 's'}: ${parts.join(', ')}`;
}

const TOOL_LABELS: Record<string, string> = {
  search_businesses: 'Searched businesses',
  search_services: 'Searched services',
  find_business: 'Looked up a business',
  view_business_profile: 'Viewed a business profile',
  search_categories: 'Browsed categories',
  check_availability: 'Checked availability',
  list_services: 'Listed services',
  create_booking: 'Created a booking',
  reschedule_booking: 'Rescheduled a booking',
  cancel_booking: 'Cancelled a booking',
  booking_history: 'Reviewed booking history',
  next_booking: 'Found the next booking',
  favourite_businesses: 'Checked favourites',
  recently_viewed: 'Checked recently viewed',
  promotions: 'Checked promotions',
  reviews: 'Reviewed your reviews',
  recommendations: 'Generated recommendations',
};
export function toolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? tool.replace(/_/g, ' ');
}

export function assistantStatusLabel(status: 'COMPLETED' | 'ESCALATED' | 'FAILED'): string {
  return { COMPLETED: 'Answered', ESCALATED: 'Handed to the business', FAILED: 'Could not complete' }[status];
}

// --- Recommendations --------------------------------------------------

export function recommendationHeadline(rec: CustomerAIRecommendationDto): string {
  switch (rec.type) {
    case 'repeat_booking': return `Time to rebook ${rec.name}`;
    case 'similar_to_favourite': return `${rec.name} — like your favourites`;
    case 'nearby_top_rated': return `${rec.name} nearby`;
    case 'promotion': return `Offer at ${rec.name}`;
    case 'highly_rated': return `${rec.name} — highly rated`;
  }
}

/** Every recommendation must be explainable — this asserts the reason string is present. */
export function isExplainable(rec: CustomerAIRecommendationDto): boolean {
  return Boolean(rec.reason && rec.reason.trim().length > 0 && (rec.slug || rec.name));
}

export function sortRecommendations(recs: CustomerAIRecommendationDto[]): CustomerAIRecommendationDto[] {
  const rank: Record<CustomerAIRecommendationDto['type'], number> = {
    repeat_booking: 0, promotion: 1, similar_to_favourite: 2, nearby_top_rated: 3, highly_rated: 4,
  };
  return [...recs]
    .filter(isExplainable)
    .sort((a, b) => {
      if (a.type !== b.type) return rank[a.type] - rank[b.type];
      if (a.type === 'repeat_booking') return (a.dueInDays ?? 999) - (b.dueInDays ?? 999);
      return (b.rating ?? 0) - (a.rating ?? 0);
    });
}

// --- Settings -------------------------------------------------------------

export const DEFAULT_ASSISTANT_SETTINGS: CustomerAISettingsDto = {
  personalizationEnabled: true,
  memoryEnabled: true,
  recommendationsEnabled: true,
  language: 'en',
  notifyOnReply: true,
  notifyRecommendations: false,
};

export function applySettingsPatch(current: CustomerAISettingsDto, patch: Partial<CustomerAISettingsDto>): CustomerAISettingsDto {
  return { ...current, ...patch };
}

/** When personalization is off, memory and recommendations are implied off too. */
export function effectiveSettings(settings: CustomerAISettingsDto): CustomerAISettingsDto {
  if (settings.personalizationEnabled) return settings;
  return { ...settings, memoryEnabled: false, recommendationsEnabled: false };
}

// --- Pagination ----------------------------------------------------------

export function mergePage<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const seen = new Set(existing.map((item) => item.id));
  return [...existing, ...incoming.filter((item) => !seen.has(item.id))];
}

export function hasMore(nextCursor: string | null): boolean {
  return nextCursor !== null && nextCursor !== undefined;
}
