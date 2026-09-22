import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, SlidersHorizontal, ToggleLeft } from "lucide-react";
import { apiFetch } from "../api";
import { useAuth } from "../auth";
import { ErrorState, LoadingState, PageHeader, StatusBadge, formatDate } from "../components/ui";

interface Setting { key: string; value: unknown; description: string | null; updatedAt: string }

function PlatformSettingsSection() {
  const auth = useAuth(); const client = useQueryClient();
  const query = useQuery({ queryKey: ["admin-settings"], queryFn: () => apiFetch<{ items: Setting[] }>("/admin/settings") });
  const mutation = useMutation({ mutationFn: (input: { key: string; enabled: boolean }) => apiFetch("/admin/settings", { method: "PATCH", body: JSON.stringify(input) }), onSuccess: async () => { await client.invalidateQueries({ queryKey: ["admin-settings"] }); } });
  if (query.isLoading) return <LoadingState label="Loading platform settings" />;
  if (query.error || !query.data) return <ErrorState message={(query.error as Error)?.message ?? "Settings unavailable"} onRetry={() => void query.refetch()} />;
  return <section className="panel settings-list">{query.data.items.map((setting) => { const enabled = setting.value === true; return <div className="setting-row" key={setting.key}><div className="setting-icon"><SlidersHorizontal size={17} /></div><div className="setting-copy"><strong>{setting.key.replaceAll("_", " ")}</strong><span>{setting.description}</span></div><StatusBadge value={enabled ? "enabled" : "disabled"} /><button className={`button ${enabled ? "danger-outline" : "secondary"}`} disabled={!auth.hasPermission("settings.manage") || mutation.isPending} onClick={() => mutation.mutate({ key: setting.key, enabled: !enabled })}>{enabled ? "Disable" : "Enable"}</button></div>; })}{mutation.error instanceof Error && <p className="error-copy">{mutation.error.message}</p>}</section>;
}

interface FeatureFlag { id: string; key: string; scope: "PLATFORM" | "BUSINESS" | "USER"; businessId: string | null; userId: string | null; enabled: boolean; rolloutPercent: number; updatedAt: string }

function FeatureFlagsSection() {
  const auth = useAuth(); const client = useQueryClient();
  const canManage = auth.hasPermission("settings.manage");
  const query = useQuery({ queryKey: ["admin-feature-flags"], queryFn: () => apiFetch<{ items: FeatureFlag[] }>("/admin/feature-flags") });
  const [newKey, setNewKey] = useState("");
  const upsert = useMutation({
    mutationFn: (input: { key: string; scope: "PLATFORM"; enabled: boolean }) => apiFetch("/admin/feature-flags", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["admin-feature-flags"] }); setNewKey(""); },
  });
  const toggle = useMutation({
    mutationFn: (input: { key: string; scope: "PLATFORM"; enabled: boolean }) => apiFetch("/admin/feature-flags", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["admin-feature-flags"] }); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/admin/feature-flags/${id}`, { method: "DELETE" }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["admin-feature-flags"] }); },
  });

  if (query.isLoading) return <LoadingState label="Loading feature flags" />;
  if (query.error || !query.data) return <ErrorState message={(query.error as Error)?.message ?? "Feature flags unavailable"} onRetry={() => void query.refetch()} />;

  return <section className="panel settings-list">
    {query.data.items.length === 0 && <p className="muted">No feature flags yet.</p>}
    {query.data.items.map((flag) => <div className="setting-row" key={flag.id}>
      <div className="setting-icon"><ToggleLeft size={17} /></div>
      <div className="setting-copy"><strong>{flag.key}</strong><span>{flag.scope}{flag.businessId ? ` · business ${flag.businessId}` : ""}{flag.userId ? ` · user ${flag.userId}` : ""} · {flag.rolloutPercent}% rollout</span></div>
      <StatusBadge value={flag.enabled ? "enabled" : "disabled"} />
      <button className={`button ${flag.enabled ? "danger-outline" : "secondary"}`} disabled={!canManage || toggle.isPending} onClick={() => toggle.mutate({ key: flag.key, scope: "PLATFORM", enabled: !flag.enabled })}>{flag.enabled ? "Disable" : "Enable"}</button>
      {flag.scope === "PLATFORM" && <button className="button danger-outline" disabled={!canManage || remove.isPending} onClick={() => remove.mutate(flag.id)}>Delete</button>}
    </div>)}
    {canManage && <form className="setting-row" onSubmit={(event) => { event.preventDefault(); if (newKey.trim()) upsert.mutate({ key: newKey.trim(), scope: "PLATFORM", enabled: true }); }}>
      <div className="setting-icon"><ToggleLeft size={17} /></div>
      <input placeholder="New platform flag key, e.g. ai.customer_agent" value={newKey} onChange={(event) => setNewKey(event.target.value)} />
      <button type="submit" className="button secondary" disabled={!newKey.trim() || upsert.isPending}>Add & enable (platform-wide)</button>
    </form>}
    {(upsert.error instanceof Error || toggle.error instanceof Error || remove.error instanceof Error) && <p className="error-copy">{((upsert.error ?? toggle.error ?? remove.error) as Error).message}</p>}
  </section>;
}

interface ProviderSecretSummary { key: string; configured: boolean; updatedAt: string | null; updatedByAdminId: string | null }

function ProviderSecretsSection() {
  const auth = useAuth(); const client = useQueryClient();
  const canManage = auth.hasPermission("provider_secrets.manage");
  const query = useQuery({ queryKey: ["admin-provider-secrets"], queryFn: () => apiFetch<{ items: ProviderSecretSummary[] }>("/admin/provider-secrets") });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const set = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => apiFetch(`/admin/provider-secrets/${key}`, { method: "PUT", body: JSON.stringify({ value }) }),
    onSuccess: async (_data, variables) => { await client.invalidateQueries({ queryKey: ["admin-provider-secrets"] }); setDrafts((prev) => ({ ...prev, [variables.key]: "" })); },
  });
  const clear = useMutation({
    mutationFn: (key: string) => apiFetch(`/admin/provider-secrets/${key}`, { method: "DELETE" }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["admin-provider-secrets"] }); },
  });

  if (!auth.hasPermission("provider_secrets.manage") && !auth.hasPermission("platform.read")) return null;
  if (query.isLoading) return <LoadingState label="Loading provider credentials" />;
  if (query.error || !query.data) return <ErrorState message={(query.error as Error)?.message ?? "Provider credentials unavailable"} onRetry={() => void query.refetch()} />;

  return <section className="panel settings-list">
    <p className="muted">
      Values are encrypted at rest and never shown here once saved — only whether a key is configured. A saved
      change takes effect on the API's next restart (no new build required); ask Claude or your operator to
      restart the <code>chakusa-api</code> service after saving.
    </p>
    {query.data.items.map((secret) => <div className="setting-row" key={secret.key}>
      <div className="setting-icon"><KeyRound size={17} /></div>
      <div className="setting-copy">
        <strong>{secret.key}</strong>
        <span>{secret.configured ? `Configured · updated ${formatDate(secret.updatedAt)}` : "Not set"}</span>
      </div>
      {canManage && <>
        <input
          type="password"
          placeholder={secret.configured ? "Replace value…" : "Paste value…"}
          value={drafts[secret.key] ?? ""}
          onChange={(event) => setDrafts((prev) => ({ ...prev, [secret.key]: event.target.value }))}
          autoComplete="off"
        />
        <button
          className="button secondary"
          disabled={!drafts[secret.key]?.trim() || set.isPending}
          onClick={() => set.mutate({ key: secret.key, value: drafts[secret.key]!.trim() })}
        >
          Save
        </button>
        {secret.configured && <button className="button danger-outline" disabled={clear.isPending} onClick={() => clear.mutate(secret.key)}>Clear</button>}
      </>}
    </div>)}
    {(set.error instanceof Error || clear.error instanceof Error) && <p className="error-copy">{((set.error ?? clear.error) as Error).message}</p>}
  </section>;
}

export default function SettingsPage() {
  const auth = useAuth();
  return <div className="page">
    <PageHeader eyebrow="Platform controls" title="Settings" description="Manage guarded platform flags. Every change is permission-checked and audited." />
    <h2 className="section-title">Platform flags</h2>
    <PlatformSettingsSection />
    <h2 className="section-title">Feature flags</h2>
    <FeatureFlagsSection />
    {(auth.hasPermission("provider_secrets.manage")) && <>
      <h2 className="section-title">Provider credentials</h2>
      <ProviderSecretsSection />
    </>}
  </div>;
}
