import { describe, expect, it } from 'vitest';
import type { CustomerAIConversationDto, CustomerAIMessageDto, CustomerAIRecommendationDto, CustomerAISettingsDto } from '../apiTypes';
import {
  applySettingsPatch,
  assistantStatusLabel,
  canNavigateAssistant,
  DEFAULT_ASSISTANT_SETTINGS,
  deriveConversationTitle,
  effectiveSettings,
  filterConversations,
  groupMessagesByDay,
  hasMore,
  isExplainable,
  isProhibitedAssistantRoute,
  mergePage,
  partitionConversations,
  recommendationHeadline,
  sortConversations,
  sortRecommendations,
  toolCallSummary,
  toolLabel,
} from './customerAssistant';

const conv = (over: Partial<CustomerAIConversationDto> = {}): CustomerAIConversationDto => ({
  id: over.id ?? 'c1',
  title: over.title ?? 'Booking help',
  businessId: over.businessId ?? null,
  pinned: over.pinned ?? false,
  archivedAt: over.archivedAt ?? null,
  lastMessageAt: over.lastMessageAt ?? '2026-08-30T10:00:00.000Z',
  messageCount: over.messageCount ?? 2,
  createdAt: over.createdAt ?? '2026-08-29T10:00:00.000Z',
  ...over,
});

const msg = (over: Partial<CustomerAIMessageDto> = {}): CustomerAIMessageDto => ({
  id: over.id ?? 'm1',
  role: over.role ?? 'user',
  content: over.content ?? 'hi',
  toolCalls: over.toolCalls ?? null,
  createdAt: over.createdAt ?? '2026-08-30T10:00:00.000Z',
  ...over,
});

const rec = (over: Partial<CustomerAIRecommendationDto> = {}): CustomerAIRecommendationDto => ({
  type: over.type ?? 'highly_rated',
  slug: over.slug ?? 'bloom-hair',
  name: over.name ?? 'Bloom Hair',
  category: over.category ?? 'hair',
  reason: over.reason ?? 'Verified and rated 4.8.',
  rating: over.rating ?? 4.8,
  dueInDays: over.dueInDays,
  ...over,
});

describe('customer assistant domain (Program 2, Loop 4)', () => {
  describe('navigation — no payment/loyalty/wallet', () => {
    it('allows the four assistant routes', () => {
      for (const route of ['AIAssistant', 'AIConversation', 'AIRecommendations', 'AISettings']) {
        expect(canNavigateAssistant(route)).toBe(true);
      }
    });
    it('rejects prohibited routes', () => {
      for (const route of ['Payment', 'Checkout', 'LoyaltyHome', 'Rewards', 'Wallet', 'MembershipTiers', 'RedeemPoints']) {
        expect(isProhibitedAssistantRoute(route)).toBe(true);
        expect(canNavigateAssistant(route)).toBe(false);
      }
    });
  });

  describe('conversation list', () => {
    it('sorts pinned first then by recent activity, hiding archived', () => {
      const list = [
        conv({ id: 'old', lastMessageAt: '2026-08-01T00:00:00.000Z' }),
        conv({ id: 'pinned', pinned: true, lastMessageAt: '2026-07-01T00:00:00.000Z' }),
        conv({ id: 'fresh', lastMessageAt: '2026-08-30T00:00:00.000Z' }),
        conv({ id: 'archived', archivedAt: '2026-08-15T00:00:00.000Z' }),
      ];
      expect(sortConversations(list).map((c) => c.id)).toEqual(['pinned', 'fresh', 'old']);
      const parts = partitionConversations(list);
      expect(parts.active.map((c) => c.id)).toEqual(['pinned', 'fresh', 'old']);
      expect(parts.archived.map((c) => c.id)).toEqual(['archived']);
    });
    it('filters by title', () => {
      const list = [conv({ id: 'a', title: 'Haircut booking' }), conv({ id: 'b', title: 'Dentist question' })];
      expect(filterConversations(list, 'dent').map((c) => c.id)).toEqual(['b']);
      expect(filterConversations(list, '')).toHaveLength(2);
    });
    it('derives a title from the first message when none is set', () => {
      expect(deriveConversationTitle(conv({ title: null }), 'Can you book me a haircut on Friday afternoon please')).toBe('Can you book me a haircut on Friday afternoon…');
      expect(deriveConversationTitle(conv({ title: null }), '')).toBe('New conversation');
      expect(deriveConversationTitle(conv({ title: 'Set' }), 'x')).toBe('Set');
    });
  });

  describe('messages', () => {
    it('groups by local day chronologically', () => {
      const groups = groupMessagesByDay([
        msg({ id: 'b', createdAt: '2026-08-30T09:00:00.000Z' }),
        msg({ id: 'a', createdAt: '2026-08-29T22:00:00.000Z' }),
        msg({ id: 'c', createdAt: '2026-08-30T18:00:00.000Z' }),
      ], 'UTC');
      expect(groups.map((g) => g.date)).toEqual(['2026-08-29', '2026-08-30']);
      expect(groups[1].messages.map((m) => m.id)).toEqual(['b', 'c']);
    });
    it('summarizes tool calls and labels tools', () => {
      expect(toolCallSummary([{ tool: 'create_booking', ok: true }, { tool: 'cancel_booking', ok: false, denied: true }])).toBe('2 actions: 1 ok, 1 blocked');
      expect(toolCallSummary(null)).toBe('');
      expect(toolLabel('check_availability')).toBe('Checked availability');
      expect(toolLabel('mystery_tool')).toBe('mystery tool');
    });
    it('labels turn status', () => {
      expect(assistantStatusLabel('ESCALATED')).toBe('Handed to the business');
    });
  });

  describe('recommendations — explainable, ranked', () => {
    it('requires a reason and a target', () => {
      expect(isExplainable(rec())).toBe(true);
      expect(isExplainable(rec({ reason: '   ' }))).toBe(false);
      expect(isExplainable(rec({ reason: 'ok', slug: null, name: '' }))).toBe(false);
    });
    it('ranks repeat bookings first (soonest due), drops unexplainable', () => {
      const recs = [
        rec({ type: 'highly_rated', name: 'Top', rating: 5 }),
        rec({ type: 'repeat_booking', name: 'DueSoon', dueInDays: 1, reason: 'every 30 days' }),
        rec({ type: 'repeat_booking', name: 'DueLater', dueInDays: 10, reason: 'every 30 days' }),
        rec({ type: 'promotion', name: 'Promo', reason: 'Active offer: -20%' }),
        rec({ type: 'nearby_top_rated', name: 'Bad', reason: '' }),
      ];
      expect(sortRecommendations(recs).map((r) => r.name)).toEqual(['DueSoon', 'DueLater', 'Promo', 'Top']);
    });
    it('builds a headline per type', () => {
      expect(recommendationHeadline(rec({ type: 'repeat_booking', name: 'Bloom' }))).toBe('Time to rebook Bloom');
      expect(recommendationHeadline(rec({ type: 'promotion', name: 'Bloom' }))).toBe('Offer at Bloom');
    });
  });

  describe('settings', () => {
    it('patches and derives effective settings', () => {
      const patched = applySettingsPatch(DEFAULT_ASSISTANT_SETTINGS, { personalizationEnabled: false });
      expect(patched.personalizationEnabled).toBe(false);
      const eff = effectiveSettings(patched);
      expect(eff.memoryEnabled).toBe(false);
      expect(eff.recommendationsEnabled).toBe(false);
      expect(effectiveSettings(DEFAULT_ASSISTANT_SETTINGS as CustomerAISettingsDto).memoryEnabled).toBe(true);
    });
  });

  describe('pagination', () => {
    it('merges pages without duplicates and reports more', () => {
      expect(mergePage([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }]).map((x) => x.id)).toEqual(['a', 'b', 'c']);
      expect(hasMore('cursor')).toBe(true);
      expect(hasMore(null)).toBe(false);
    });
  });
});
