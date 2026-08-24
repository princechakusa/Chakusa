import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SlidersHorizontal } from "lucide-react";
import { apiFetch } from "../api";
import { useAuth } from "../auth";
import { ErrorState, LoadingState, PageHeader, StatusBadge } from "../components/ui";

interface Setting { key: string; value: unknown; description: string | null; updatedAt: string }

export default function SettingsPage() {
  const auth = useAuth(); const client = useQueryClient();
  const query = useQuery({ queryKey: ["admin-settings"], queryFn: () => apiFetch<{ items: Setting[] }>("/admin/settings") });
  const mutation = useMutation({ mutationFn: (input: { key: string; enabled: boolean }) => apiFetch("/admin/settings", { method: "PATCH", body: JSON.stringify(input) }), onSuccess: async () => { await client.invalidateQueries({ queryKey: ["admin-settings"] }); } });
  if (query.isLoading) return <LoadingState label="Loading platform settings" />;
  if (query.error || !query.data) return <ErrorState message={(query.error as Error)?.message ?? "Settings unavailable"} onRetry={() => void query.refetch()} />;
  return <div className="page"><PageHeader eyebrow="Platform controls" title="Settings" description="Manage guarded platform flags. Every change is permission-checked and audited." /><section className="panel settings-list">{query.data.items.map((setting) => { const enabled = setting.value === true; return <div className="setting-row" key={setting.key}><div className="setting-icon"><SlidersHorizontal size={17} /></div><div className="setting-copy"><strong>{setting.key.replaceAll("_", " ")}</strong><span>{setting.description}</span></div><StatusBadge value={enabled ? "enabled" : "disabled"} /><button className={`button ${enabled ? "danger-outline" : "secondary"}`} disabled={!auth.hasPermission("settings.manage") || mutation.isPending} onClick={() => mutation.mutate({ key: setting.key, enabled: !enabled })}>{enabled ? "Disable" : "Enable"}</button></div>; })}</section>{mutation.error instanceof Error && <p className="error-copy">{mutation.error.message}</p>}</div>;
}
