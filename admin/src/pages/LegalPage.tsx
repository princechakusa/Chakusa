import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArchiveRestore, FileText, Plus, RotateCcw, ShieldAlert, Undo2 } from "lucide-react";
import { useState } from "react";
import { apiFetch } from "../api";
import { useAuth } from "../auth";
import { DataTable, ErrorState, LoadingState, MetricCard, PageHeader, StatusBadge, formatDate } from "../components/ui";

type LegalDocumentType = "PRIVACY_POLICY" | "TERMS_OF_SERVICE" | "COOKIE_POLICY" | "AI_DISCLOSURE";
interface LegalVersion { id: string; type: LegalDocumentType; version: number; status: "DRAFT" | "PUBLISHED" | "ARCHIVED"; title: string; content: string; summary: string | null; requiresReacceptance: boolean; effectiveAt: string | null; publishedAt: string | null; archivedAt: string | null; createdAt: string }
interface CookieAnalytics { total: number; bySource: Record<string, number>; categoryCounts: { analytics: number; functional: number; marketing: number } }

const TYPES: { value: LegalDocumentType; label: string }[] = [
  { value: "PRIVACY_POLICY", label: "Privacy Policy" },
  { value: "TERMS_OF_SERVICE", label: "Terms of Service" },
  { value: "COOKIE_POLICY", label: "Cookie Policy" },
  { value: "AI_DISCLOSURE", label: "AI Disclosure" },
];

// PROGRAM 2 LOOP 4: the admin console's own surface for a platform that has
// been API-complete (src/modules/admin/admin.routes.ts's /legal/* routes,
// legalAdmin.service.ts) since Phase 1, but had no UI anywhere to actually
// use it from. Every mutation here already exists server-side; this page
// only exercises it.
export default function LegalPage() {
  const auth = useAuth();
  const client = useQueryClient();
  const [type, setType] = useState<LegalDocumentType>("PRIVACY_POLICY");
  const [draftOpen, setDraftOpen] = useState(false);

  const versions = useQuery({ queryKey: ["legal-versions", type], queryFn: () => apiFetch<{ items: LegalVersion[] }>(`/admin/legal/versions?type=${type}`) });
  const published = versions.data?.items.find((v) => v.status === "PUBLISHED") ?? null;
  const stats = useQuery({ queryKey: ["legal-stats", published?.id], queryFn: () => apiFetch<{ versionId: string; acceptanceCount: number }>(`/admin/legal/versions/${published!.id}/stats`), enabled: Boolean(published) });
  const cookieStats = useQuery({ queryKey: ["legal-cookie-stats", published?.id], queryFn: () => apiFetch<CookieAnalytics>(`/admin/legal/versions/${published!.id}/cookie-analytics`), enabled: Boolean(published) && type === "COOKIE_POLICY" });

  const invalidate = () => client.invalidateQueries({ queryKey: ["legal-versions", type] });
  const publish = useMutation({ mutationFn: (id: string) => apiFetch(`/admin/legal/versions/${id}/publish`, { method: "POST" }), onSuccess: invalidate });
  const archive = useMutation({ mutationFn: (id: string) => apiFetch(`/admin/legal/versions/${id}/archive`, { method: "POST" }), onSuccess: invalidate });
  const rollback = useMutation({ mutationFn: (id: string) => apiFetch(`/admin/legal/versions/${id}/rollback`, { method: "POST" }), onSuccess: invalidate });
  const forceReacceptance = useMutation({ mutationFn: (id: string) => apiFetch(`/admin/legal/versions/${id}/force-reacceptance`, { method: "POST" }), onSuccess: invalidate });
  const createDraft = useMutation({
    mutationFn: (input: { title: string; content: string; summary?: string }) => apiFetch<LegalVersion>("/admin/legal/versions", { method: "POST", body: JSON.stringify({ type, ...input }) }),
    onSuccess: () => { invalidate(); setDraftOpen(false); },
  });

  const canManage = auth.hasPermission("legal.manage");
  const rows = versions.data?.items ?? [];

  return <div className="page">
    <PageHeader eyebrow="Trust & compliance" title="Legal documents" description="Draft, publish, roll back, and audit acceptance of the Privacy Policy, Terms of Service, Cookie Policy, and AI Disclosure." actions={canManage ? <button className="button primary" onClick={() => setDraftOpen(true)}><Plus size={15} />New draft</button> : undefined} />
    <div className="toolbar panel"><div className="filters">{TYPES.map((t) => <button key={t.value} className={`button ${type === t.value ? "primary" : "secondary"} small`} onClick={() => setType(t.value)}>{t.label}</button>)}</div></div>

    {published ? <section className="metric-grid">
      <MetricCard label="Currently published" value={`v${published.version}`} detail={published.publishedAt ? `Since ${formatDate(published.publishedAt, false)}` : undefined} />
      <MetricCard label="Acceptances recorded" value={stats.data ? stats.data.acceptanceCount : "…"} tone="good" />
      {type === "COOKIE_POLICY" && cookieStats.data ? <MetricCard label="Accepted all cookies" value={cookieStats.data.bySource.accept_all ?? 0} detail={`of ${cookieStats.data.total} choices recorded`} /> : null}
      {type === "COOKIE_POLICY" && cookieStats.data ? <MetricCard label="Analytics opted in" value={cookieStats.data.categoryCounts.analytics} detail={`of ${cookieStats.data.total}`} /> : null}
    </section> : <div className="audit-callout panel"><ShieldAlert size={20} /><div><strong>Nothing published yet</strong><p>{TYPES.find((t) => t.value === type)?.label} has no live version. Public visitors and the app will see a 404 until one is published.</p></div></div>}

    <section className="panel table-panel">
      {versions.isLoading ? <LoadingState label="Loading versions" /> : versions.error ? <ErrorState message={(versions.error as Error).message} onRetry={() => void versions.refetch()} /> : <DataTable
        columns={["Version", "Status", "Title", "Re-acceptance", "Published", "Archived", "Controls"]}
        rows={rows.map((v) => [
          <div className="stacked-cell"><strong>v{v.version}</strong><span>{v.id.slice(0, 8)}</span></div>,
          <StatusBadge value={v.status} />,
          <div className="stacked-cell"><strong>{v.title}</strong>{v.summary ? <span className="truncate-cell" title={v.summary}>{v.summary}</span> : null}</div>,
          v.requiresReacceptance ? "Required" : "Not required",
          formatDate(v.publishedAt, false),
          formatDate(v.archivedAt, false),
          <div className="page-actions">
            {canManage && v.status === "DRAFT" ? <button className="button ghost small" disabled={publish.isPending} onClick={() => publish.mutate(v.id)}><FileText size={13} />Publish</button> : null}
            {canManage && v.status === "PUBLISHED" ? <button className="button ghost small" disabled={archive.isPending} onClick={() => archive.mutate(v.id)}><ArchiveRestore size={13} />Archive</button> : null}
            {canManage && v.status === "PUBLISHED" && !v.requiresReacceptance ? <button className="button ghost small" disabled={forceReacceptance.isPending} onClick={() => forceReacceptance.mutate(v.id)}><ShieldAlert size={13} />Force re-acceptance</button> : null}
            {canManage && v.status === "ARCHIVED" ? <button className="button ghost small" disabled={rollback.isPending} onClick={() => rollback.mutate(v.id)}><Undo2 size={13} />Roll back to this</button> : null}
          </div>,
        ])}
        empty={{ title: "No versions yet", description: "Create the first draft for this document type." }}
      />}
      {(publish.error || archive.error || rollback.error || forceReacceptance.error) instanceof Error ? <p className="error-copy">{((publish.error ?? archive.error ?? rollback.error ?? forceReacceptance.error) as Error).message}</p> : null}
    </section>

    {draftOpen ? <NewDraftDialog typeLabel={TYPES.find((t) => t.value === type)!.label} pending={createDraft.isPending} error={createDraft.error instanceof Error ? createDraft.error.message : undefined} onCancel={() => setDraftOpen(false)} onSubmit={(input) => createDraft.mutate(input)} /> : null}
  </div>;
}

function NewDraftDialog({ typeLabel, pending, error, onCancel, onSubmit }: { typeLabel: string; pending: boolean; error?: string; onCancel: () => void; onSubmit: (input: { title: string; content: string; summary?: string }) => void }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [summary, setSummary] = useState("");
  const valid = title.trim().length > 0 && content.trim().length > 0;
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) onCancel(); }}>
    <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="draft-title">
      <div className="dialog-icon"><RotateCcw size={20} /></div>
      <h2 id="draft-title">New {typeLabel} draft</h2>
      <p>Creates a DRAFT version. Nothing changes for users until you publish it — see the version list's Publish action.</p>
      <label><span>Title</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder={typeLabel} /></label>
      <label><span>Summary (optional, shown to reviewers only)</span><input value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="What changed in this draft" /></label>
      <label><span>Content (Markdown-ish — see publicDocument.ts's renderer)</span><textarea style={{ height: 220 }} value={content} onChange={(event) => setContent(event.target.value)} placeholder="## Section&#10;Paragraph text.&#10;- Bullet point" /></label>
      {error ? <div className="dialog-error">{error}</div> : null}
      <div className="dialog-actions"><button className="button secondary" onClick={onCancel} disabled={pending}>Cancel</button><button className="button primary" disabled={pending || !valid} onClick={() => onSubmit({ title: title.trim(), content: content.trim(), summary: summary.trim() || undefined })}>{pending ? "Creating..." : "Create draft"}</button></div>
    </section>
  </div>;
}
