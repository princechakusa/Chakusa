import type { AiConversationRunDto, AiDraftReviewDecision, AiEvaluationRunDto, AiRunStatus, AiValueCenterDto } from '../apiTypes';

// LOOP 3B-4: pure product rules for the mobile AI management surface —
// conversation history, draft review, human approval, suggestions, AI
// analytics, AI health, escalation review and evaluation summaries.

const RUN_STATUS_COPY: Record<string, string> = {
  RECEIVED: 'Received',
  CONTEXT_READY: 'Preparing',
  CLASSIFIED: 'Understanding',
  PLANNED: 'Planning',
  TOOL_SELECTION: 'Choosing tools',
  TOOL_EXECUTION: 'Working',
  DRAFT_RESPONSE: 'Drafting',
  HUMAN_APPROVAL: 'Waiting for your approval',
  RESPONDING: 'Sending',
  COMPLETED: 'Handled',
  ESCALATED: 'Escalated to you',
  FAILED: 'Could not complete',
};

export function aiRunStatusCopy(status: AiRunStatus | string): string {
  return RUN_STATUS_COPY[status] ?? 'Status unavailable';
}

export function isAwaitingApproval(run: Pick<AiConversationRunDto, 'status'>): boolean {
  return run.status === 'HUMAN_APPROVAL';
}

export function isEscalated(run: Pick<AiConversationRunDto, 'status'>): boolean {
  return run.status === 'ESCALATED';
}

export function isTerminalRun(status: AiRunStatus | string): boolean {
  return status === 'COMPLETED' || status === 'ESCALATED' || status === 'FAILED';
}

/** The drafted reply text a human is being asked to review, if any. */
export function draftFromRun(run: Pick<AiConversationRunDto, 'state'>): string | null {
  const response = (run.state as { response?: unknown })?.response;
  if (typeof response === 'string') return response;
  if (response && typeof response === 'object') {
    const text = (response as { text?: unknown }).text;
    if (typeof text === 'string') return text;
    return JSON.stringify(response);
  }
  return null;
}

export function policyOutcomeFromRun(run: Pick<AiConversationRunDto, 'state'>): string | null {
  const outcome = (run.state as { policyOutcome?: unknown })?.policyOutcome;
  return typeof outcome === 'string' ? outcome : null;
}

/** Maps a review decision to the API action + whether it needs edited text. */
export function resolveDraftReview(decision: AiDraftReviewDecision): { action: 'approve' | 'escalate' | 'none'; requiresText: boolean } {
  switch (decision) {
    case 'approve':
      return { action: 'approve', requiresText: false };
    case 'edit':
      return { action: 'approve', requiresText: true };
    case 'escalate':
      return { action: 'escalate', requiresText: false };
    case 'reject':
    default:
      return { action: 'none', requiresText: false };
  }
}

export interface AiSuggestion {
  id: string;
  kind: string;
  confidence: number;
  createdAt: string;
}

/** Deterministic suggestion ordering: highest confidence, then most recent. */
export function rankAiSuggestions<T extends AiSuggestion>(suggestions: T[]): T[] {
  return [...suggestions].sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

export function percent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

export function approvalRatePercent(analytics: Pick<AiValueCenterDto, 'humanApprovalRate'>): string {
  return percent(analytics.humanApprovalRate);
}

export function escalationRatePercent(analytics: Pick<AiValueCenterDto, 'escalationRate'>): string {
  return percent(analytics.escalationRate);
}

export interface AiAnalyticsSummary {
  conversations: number;
  assistedRevenue: string;
  cost: string;
  costPerConversation: string;
  roi: string;
  approvalRate: string;
  escalationRate: string;
}

export function summarizeAiAnalytics(analytics: AiValueCenterDto): AiAnalyticsSummary {
  return {
    conversations: analytics.aiConversations,
    assistedRevenue: analytics.aiAssistedRevenue.toFixed(2),
    cost: analytics.aiCost.toFixed(2),
    costPerConversation: analytics.costPerConversation.toFixed(2),
    roi: analytics.aiRoi == null ? 'n/a' : `${(analytics.aiRoi * 100).toFixed(0)}%`,
    approvalRate: approvalRatePercent(analytics),
    escalationRate: escalationRatePercent(analytics),
  };
}

export type AiHealthLabel = 'Healthy' | 'Degraded' | 'Down' | 'Unknown';

export function aiHealthLabel(input: { circuitBreaker?: Array<{ health?: string; circuit?: string }>; aiFailureRate?: number }): AiHealthLabel {
  const breakers = input.circuitBreaker ?? [];
  if (breakers.some((b) => b.circuit === 'OPEN' || b.health === 'DOWN')) return 'Down';
  if ((input.aiFailureRate ?? 0) > 0.2 || breakers.some((b) => b.health === 'DEGRADED')) return 'Degraded';
  if (!breakers.length && !input.aiFailureRate) return 'Unknown';
  return 'Healthy';
}

/** Escalations needing attention, newest first. */
export function escalationQueue(runs: AiConversationRunDto[]): AiConversationRunDto[] {
  return runs.filter((run) => run.status === 'ESCALATED').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Draft-review queue: runs blocked on human approval, oldest first (FIFO). */
export function approvalQueue(runs: AiConversationRunDto[]): AiConversationRunDto[] {
  return runs.filter((run) => run.status === 'HUMAN_APPROVAL').sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
}

export function evaluationSummaryCopy(run: Pick<AiEvaluationRunDto, 'passedCases' | 'totalCases' | 'score' | 'status'>): string {
  if (run.status !== 'COMPLETED') return `Evaluation ${run.status.toLowerCase()}`;
  return `${run.passedCases}/${run.totalCases} cases passed · score ${run.score.toFixed(2)}`;
}

export function evaluationTrend(runs: AiEvaluationRunDto[]): { direction: 'up' | 'down' | 'flat'; delta: number } {
  const completed = runs.filter((run) => run.status === 'COMPLETED').sort((a, b) => a.runNumber - b.runNumber);
  if (completed.length < 2) return { direction: 'flat', delta: 0 };
  const delta = Number((completed[completed.length - 1].score - completed[completed.length - 2].score).toFixed(4));
  return { direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat', delta };
}
