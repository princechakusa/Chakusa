import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, BrainCircuit } from "lucide-react";
import { apiFetch } from "../api";
import { useAuth } from "../auth";
import { DataTable, ErrorState, formatMoney, formatNumber, formatPercent, LoadingState, MetricCard, PageHeader, StatusBadge } from "../components/ui";

interface Analytics { conversations: Record<string, number>; invocations: number; cost: number; tokens: { input: number; output: number }; byProvider: Array<{ provider: string; cost: number; calls: number }> }
interface Health { aiRequests: number; aiFailureRate: number; providerHealth: Array<{ provider?: string; key?: string; status?: string; healthy?: boolean }>; circuitBreakerEvents: number; killSwitches: unknown; maintenance: unknown }
interface Memory { retrievals: number; avgLatencyMs: number; avgCompressionRatio: number; avgContextTokens: number; avgFreshness: number; avgAttributionCoverage: number; recordsByScope: Record<string, number> }
interface Policy { totalDecisions: number; byOutcome: Record<string, number>; activePolicies: number; draftPolicies: number; denialRate: number }
interface AIModel { id: string; provider: string; model: string; version: string; capabilities: string[]; approvedUseCases: string[]; status: "ACTIVE" | "DISABLED" | "DEPRECATED"; healthStatus: string }

function ModelRegistrySection() {
  const auth = useAuth(); const client = useQueryClient();
  const canManage = auth.hasPermission("ai.manage");
  const query = useQuery({ queryKey: ["admin-ai-models"], queryFn: () => apiFetch<{ items: AIModel[] }>("/admin/ai/models") });
  const [form, setForm] = useState({ provider: "openai", model: "", version: "1", capabilities: "chat", approvedUseCases: "customer_agent" });
  const upsert = useMutation({
    mutationFn: () => apiFetch("/admin/ai/models", {
      method: "POST",
      body: JSON.stringify({
        provider: form.provider.trim(),
        model: form.model.trim(),
        version: form.version.trim(),
        capabilities: form.capabilities.split(",").map((value) => value.trim()).filter(Boolean),
        approvedUseCases: form.approvedUseCases.split(",").map((value) => value.trim()).filter(Boolean),
        status: "ACTIVE",
      }),
    }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["admin-ai-models"] }); setForm((prev) => ({ ...prev, model: "" })); },
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: AIModel["status"] }) => apiFetch(`/admin/ai/models/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["admin-ai-models"] }); },
  });

  if (query.isLoading) return <LoadingState label="Loading model registry" />;
  if (query.error || !query.data) return <ErrorState message={(query.error as Error)?.message ?? "Model registry unavailable"} onRetry={() => void query.refetch()} />;

  return <section className="panel table-panel">
    <div className="panel-heading"><div><p className="eyebrow">Model registry</p><h2>Which model actually answers</h2></div></div>
    <p className="muted">
      The provider (OpenAI/Anthropic) must have its API key set under Settings → Provider credentials, or the
      matching Render env var, before a model here can actually respond. Only one ACTIVE model per capability is
      used by routing.
    </p>
    <DataTable
      columns={["Provider", "Model", "Version", "Capabilities", "Status", "Health", ""]}
      rows={query.data.items.map((item) => [
        item.provider,
        item.model,
        item.version,
        item.capabilities.join(", "),
        <StatusBadge value={item.status} />,
        <StatusBadge value={item.healthStatus} />,
        canManage ? (
          item.status === "ACTIVE"
            ? <button className="button danger-outline" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: item.id, status: "DISABLED" })}>Disable</button>
            : <button className="button secondary" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: item.id, status: "ACTIVE" })}>Activate</button>
        ) : null,
      ])}
      empty={{ title: "No models registered", description: "Add a provider/model below to make it selectable at runtime." }}
    />
    {canManage && <form className="setting-row" onSubmit={(event) => { event.preventDefault(); if (form.model.trim()) upsert.mutate(); }}>
      <select value={form.provider} onChange={(event) => setForm((prev) => ({ ...prev, provider: event.target.value }))}>
        <option value="openai">openai</option>
        <option value="anthropic">anthropic</option>
      </select>
      <input placeholder="Model, e.g. gpt-4o-mini" value={form.model} onChange={(event) => setForm((prev) => ({ ...prev, model: event.target.value }))} />
      <input placeholder="Version, e.g. 1" value={form.version} onChange={(event) => setForm((prev) => ({ ...prev, version: event.target.value }))} style={{ maxWidth: 80 }} />
      <input placeholder="Capabilities, comma-separated" value={form.capabilities} onChange={(event) => setForm((prev) => ({ ...prev, capabilities: event.target.value }))} />
      <input placeholder="Approved use cases, comma-separated" value={form.approvedUseCases} onChange={(event) => setForm((prev) => ({ ...prev, approvedUseCases: event.target.value }))} />
      <button type="submit" className="button secondary" disabled={!form.model.trim() || upsert.isPending}>Add & activate</button>
    </form>}
    {(upsert.error instanceof Error || setStatus.error instanceof Error) && <p className="error-copy">{((upsert.error ?? setStatus.error) as Error).message}</p>}
  </section>;
}

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
    <ModelRegistrySection />
  </div>;
}
