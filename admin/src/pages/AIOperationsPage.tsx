import { useQuery } from "@tanstack/react-query";
import { Bot, BrainCircuit } from "lucide-react";
import { apiFetch } from "../api";
import { DataTable, ErrorState, formatMoney, formatNumber, formatPercent, LoadingState, MetricCard, PageHeader, StatusBadge } from "../components/ui";

interface Analytics { conversations: Record<string, number>; invocations: number; cost: number; tokens: { input: number; output: number }; byProvider: Array<{ provider: string; cost: number; calls: number }> }
interface Health { aiRequests: number; aiFailureRate: number; providerHealth: Array<{ provider?: string; key?: string; status?: string; healthy?: boolean }>; circuitBreakerEvents: number; killSwitches: unknown; maintenance: unknown }
interface Memory { retrievals: number; avgLatencyMs: number; avgCompressionRatio: number; avgContextTokens: number; avgFreshness: number; avgAttributionCoverage: number; recordsByScope: Record<string, number> }
interface Policy { totalDecisions: number; byOutcome: Record<string, number>; activePolicies: number; draftPolicies: number; denialRate: number }

export default function AIOperationsPage() {
  const analytics = useQuery({ queryKey: ["admin-ai-analytics"], queryFn: () => apiFetch<Analytics>("/admin/ai/analytics") });
  const health = useQuery({ queryKey: ["admin-ai-health"], queryFn: () => apiFetch<Health>("/admin/ai/health") });
  const memory = useQuery({ queryKey: ["admin-ai-memory"], queryFn: () => apiFetch<Memory>("/admin/ai/memory-monitoring") });
  const policy = useQuery({ queryKey: ["admin-ai-policy"], queryFn: () => apiFetch<Policy>("/admin/ai/policy-monitoring") });
  if (analytics.isLoading) return <div className="page"><LoadingState label="Loading AI operations" /></div>;
  if (analytics.error) return <div className="page"><ErrorState message={(analytics.error as Error).message} onRetry={() => void analytics.refetch()} /></div>;
  const data = analytics.data!; const providers = data.byProvider ?? [];
  return <div className="page"><PageHeader eyebrow="AI governance" title="AI operations" description="Usage, provider health, cost, memory quality, and policy controls for AI features used across Chakusa." actions={<button className="button secondary" onClick={() => { void analytics.refetch(); void health.refetch(); void memory.refetch(); void policy.refetch(); }}>Refresh data</button>} />
    <section className="metric-grid primary-metrics"><MetricCard label="Invocations" value={formatNumber(data.invocations)} /><MetricCard label="AI requests" value={formatNumber(health.data?.aiRequests)} /><MetricCard label="Failure rate" value={formatPercent(health.data?.aiFailureRate)} tone={health.data?.aiFailureRate ? "warning" : "good"} /><MetricCard label="Recorded cost" value={formatMoney(data.cost)} /><MetricCard label="Input tokens" value={formatNumber(data.tokens.input)} /><MetricCard label="Output tokens" value={formatNumber(data.tokens.output)} /></section>
    <section className="metric-grid secondary-metrics"><MetricCard label="Memory retrievals" value={formatNumber(memory.data?.retrievals)} detail={`${formatNumber(memory.data?.avgLatencyMs)} ms average`} /><MetricCard label="Context size" value={formatNumber(memory.data?.avgContextTokens)} detail="Average tokens" /><MetricCard label="Attribution coverage" value={formatPercent(memory.data?.avgAttributionCoverage)} /><MetricCard label="Policy decisions" value={formatNumber(policy.data?.totalDecisions)} /><MetricCard label="Active policies" value={formatNumber(policy.data?.activePolicies)} /><MetricCard label="Policy denial rate" value={formatPercent(policy.data?.denialRate)} /></section>
    <section className="panel table-panel"><div className="panel-heading"><div><p className="eyebrow">Providers</p><h2>Usage and cost</h2></div><BrainCircuit size={18} /></div><DataTable columns={["Provider", "Calls", "Recorded cost", "Ledger state"]} rows={providers.map((item) => [<div className="primary-cell"><span className="entity-icon"><Bot size={16} /></span><div><strong>{item.provider}</strong><span>AI provider</span></div></div>, formatNumber(item.calls), formatMoney(item.cost), <StatusBadge value="recorded" />])} empty={{ title: "No AI usage recorded", description: "Provider activity will appear after AI features are used." }} /></section>
  </div>;
}
