import { describe, expect, it } from 'vitest';
import type { AiConversationRunDto, AiEvaluationRunDto, AiValueCenterDto } from '../apiTypes';
import {
  aiHealthLabel,
  aiRunStatusCopy,
  approvalQueue,
  approvalRatePercent,
  draftFromRun,
  escalationQueue,
  evaluationSummaryCopy,
  evaluationTrend,
  isAwaitingApproval,
  isTerminalRun,
  policyOutcomeFromRun,
  rankAiSuggestions,
  resolveDraftReview,
  summarizeAiAnalytics,
} from './aiManagement';

const run = (over: Partial<AiConversationRunDto>): AiConversationRunDto => ({
  id: 'run',
  businessId: 'biz',
  customerId: null,
  conversationId: 'conv',
  status: 'HUMAN_APPROVAL',
  mode: 'DRAFT',
  state: {},
  lastError: null,
  createdAt: '2026-08-31T10:00:00Z',
  updatedAt: '2026-08-31T10:00:00Z',
  ...over,
});

const analytics: AiValueCenterDto = {
  aiConversations: 10,
  completedConversations: 7,
  aiAssistedBookings: 3,
  aiAssistedPayments: 2,
  aiAssistedReviews: 1,
  aiAssistedQuotes: 0,
  aiAssistedRevenue: 240,
  aiCost: 12,
  tokens: { input: 1000, output: 500 },
  costPerConversation: 1.2,
  costPerBooking: 4,
  humanApprovalRate: 0.4,
  escalationRate: 0.1,
  aiRoi: 19,
  verifiedEventsOnly: true,
};

describe('AI management product rules (3B-4)', () => {
  it('maps run status to human copy and fails safe', () => {
    expect(aiRunStatusCopy('HUMAN_APPROVAL')).toBe('Waiting for your approval');
    expect(aiRunStatusCopy('COMPLETED')).toBe('Handled');
    expect(aiRunStatusCopy('FUTURE')).toBe('Status unavailable');
  });

  it('detects approval-awaiting and terminal runs', () => {
    expect(isAwaitingApproval(run({ status: 'HUMAN_APPROVAL' }))).toBe(true);
    expect(isAwaitingApproval(run({ status: 'COMPLETED' }))).toBe(false);
    expect(isTerminalRun('ESCALATED')).toBe(true);
    expect(isTerminalRun('DRAFT_RESPONSE')).toBe(false);
  });

  it('extracts the drafted reply and policy outcome from run state', () => {
    expect(draftFromRun(run({ state: { response: 'Hello there' } }))).toBe('Hello there');
    expect(draftFromRun(run({ state: { response: { text: 'hi' } } }))).toBe('hi');
    expect(draftFromRun(run({ state: {} }))).toBeNull();
    expect(policyOutcomeFromRun(run({ state: { policyOutcome: 'REQUIRE_APPROVAL' } }))).toBe('REQUIRE_APPROVAL');
  });

  it('resolves draft review decisions to API actions', () => {
    expect(resolveDraftReview('approve')).toEqual({ action: 'approve', requiresText: false });
    expect(resolveDraftReview('edit')).toEqual({ action: 'approve', requiresText: true });
    expect(resolveDraftReview('escalate')).toEqual({ action: 'escalate', requiresText: false });
    expect(resolveDraftReview('reject')).toEqual({ action: 'none', requiresText: false });
  });

  it('ranks suggestions deterministically by confidence then recency', () => {
    const ranked = rankAiSuggestions([
      { id: 'a', kind: 'x', confidence: 0.5, createdAt: '2026-08-01' },
      { id: 'b', kind: 'x', confidence: 0.9, createdAt: '2026-07-01' },
      { id: 'c', kind: 'x', confidence: 0.9, createdAt: '2026-08-01' },
    ]);
    expect(ranked.map((s) => s.id)).toEqual(['c', 'b', 'a']);
  });

  it('summarizes analytics and formats rates', () => {
    const summary = summarizeAiAnalytics(analytics);
    expect(summary).toMatchObject({ conversations: 10, assistedRevenue: '240.00', cost: '12.00', roi: '1900%', approvalRate: '40%', escalationRate: '10%' });
    expect(approvalRatePercent({ humanApprovalRate: 0.333 })).toBe('33%');
  });

  it('labels AI health from breaker state and failure rate', () => {
    expect(aiHealthLabel({ circuitBreaker: [{ circuit: 'CLOSED', health: 'HEALTHY' }], aiFailureRate: 0.01 })).toBe('Healthy');
    expect(aiHealthLabel({ circuitBreaker: [{ circuit: 'OPEN', health: 'DOWN' }] })).toBe('Down');
    expect(aiHealthLabel({ circuitBreaker: [{ circuit: 'CLOSED', health: 'DEGRADED' }] })).toBe('Degraded');
    expect(aiHealthLabel({})).toBe('Unknown');
  });

  it('builds the escalation and approval queues', () => {
    const runs = [
      run({ id: '1', status: 'ESCALATED', updatedAt: '2026-08-31T09:00:00Z' }),
      run({ id: '2', status: 'ESCALATED', updatedAt: '2026-08-31T11:00:00Z' }),
      run({ id: '3', status: 'HUMAN_APPROVAL', updatedAt: '2026-08-31T08:00:00Z' }),
      run({ id: '4', status: 'HUMAN_APPROVAL', updatedAt: '2026-08-31T12:00:00Z' }),
      run({ id: '5', status: 'COMPLETED' }),
    ];
    expect(escalationQueue(runs).map((r) => r.id)).toEqual(['2', '1']);
    expect(approvalQueue(runs).map((r) => r.id)).toEqual(['3', '4']);
  });

  it('summarizes evaluation runs and detects a trend', () => {
    const evalRun = (over: Partial<AiEvaluationRunDto>): AiEvaluationRunDto => ({
      id: 'e', suiteId: 's', runNumber: 1, label: null, status: 'COMPLETED', totalCases: 10, passedCases: 8, failedCases: 2, score: 0.8, metrics: null, startedAt: '', completedAt: '', ...over,
    });
    expect(evaluationSummaryCopy(evalRun({}))).toBe('8/10 cases passed · score 0.80');
    expect(evaluationSummaryCopy(evalRun({ status: 'RUNNING' }))).toBe('Evaluation running');
    const trend = evaluationTrend([evalRun({ runNumber: 1, score: 0.7 }), evalRun({ runNumber: 2, score: 0.85 })]);
    expect(trend).toEqual({ direction: 'up', delta: 0.15 });
    expect(evaluationTrend([evalRun({})]).direction).toBe('flat');
  });
});
