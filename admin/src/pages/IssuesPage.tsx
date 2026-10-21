import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bug, ExternalLink, X } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch, queryString } from "../api";
import { useAuth } from "../auth";
import { DataTable, EmptyState, ErrorState, formatDate, formatNumber, LoadingState, MetricCard, PageHeader, SearchInput, StatusBadge } from "../components/ui";

type IssueStatus = "unresolved" | "resolved" | "ignored";
interface Issue { id: string; shortId: string; title: string; culprit: string; level: string; status: string; project: string; events: number; users: number; firstSeen: string; lastSeen: string; permalink: string }
interface IssueList { configured: boolean; org?: string; projects: Array<{ id: string; slug: string; name: string }>; items: Issue[] }
interface Frame { file: string; fn: string; line: number | null; inApp: boolean }
interface IssueDetail extends Issue { exception: Array<{ type: string; value: string; frames: Frame[] }>; tags: Array<{ key: string; value: string }>; release: string | null; environment: string | null; latestEventAt: string | null }

const STATUSES: Array<{ id: IssueStatus; label: string }> = [{ id: "unresolved", label: "Open" }, { id: "resolved", label: "Resolved" }, { id: "ignored", label: "Ignored" }];
const PERIODS = [{ id: "24h", label: "Last 24 hours" }, { id: "14d", label: "Last 14 days" }, { id: "90d", label: "Last 90 days" }];

export default function IssuesPage() {
  const [status, setStatus] = useState<IssueStatus>("unresolved");
  const [period, setPeriod] = useState("14d");
  const [project, setProject] = useState("");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const params = { status, period, project: project || undefined, search: useDeferredValue(search) || undefined };
  const query = useQuery({ queryKey: ["issues", params], queryFn: () => apiFetch<IssueList>(`/admin/issues?${queryString(params)}`), refetchInterval: 60_000 });
  const items = query.data?.items ?? [];

  return <div className="page">
    <PageHeader eyebrow="Reliability" title="Issues" description="Crashes and errors from the Chakusa apps and API, reported by Sentry. Fix them, then mark them resolved." />
    {query.data?.configured === false ? <section className="panel"><EmptyState title="Sentry is not connected" description="Create a Sentry auth token (scopes: org:read, project:read, event:read, event:write) and save it as SENTRY_AUTH_TOKEN under Settings → Provider credentials." /><p className="issues-settings-link"><Link className="inline-link" to="/settings">Open Settings</Link></p></section> : <>
      <div className="metric-grid issues-metrics">
        <MetricCard label={`${STATUSES.find((s) => s.id === status)!.label} issues`} value={formatNumber(items.length)} detail={PERIODS.find((p) => p.id === period)!.label} tone={status === "unresolved" && items.length ? "warning" : "good"} />
        <MetricCard label="Events" value={formatNumber(items.reduce((sum, issue) => sum + issue.events, 0))} detail="Times these errors happened" />
        <MetricCard label="People affected" value={formatNumber(items.reduce((sum, issue) => sum + issue.users, 0))} detail="Distinct users, summed per issue" />
        <MetricCard label="Fatal" value={formatNumber(items.filter((issue) => issue.level === "fatal").length)} detail="App crashes" tone={items.some((issue) => issue.level === "fatal") ? "danger" : "default"} />
      </div>
      <div className="toolbar panel">
        <SearchInput value={search} onChange={setSearch} placeholder="Search error text, screen or file" />
        <div className="filters">
          <select aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value as IssueStatus)}>{STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
          <select aria-label="Project" value={project} onChange={(event) => setProject(event.target.value)}><option value="">All projects</option>{query.data?.projects.map((p) => <option key={p.id} value={p.slug}>{p.name}</option>)}</select>
          <select aria-label="Period" value={period} onChange={(event) => setPeriod(event.target.value)}>{PERIODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
        </div>
      </div>
      <section className="panel table-panel">
        {query.isLoading ? <LoadingState label="Loading issues from Sentry" /> : query.error ? <ErrorState message={(query.error as Error).message} onRetry={() => void query.refetch()} /> :
          <DataTable
            columns={["Issue", "Project", "Level", "Events", "Users", "First seen", "Last seen"]}
            rows={items.map((issue) => [
              <div className="stacked-cell issue-title"><strong title={issue.title}>{issue.title}</strong><span>{issue.shortId}{issue.culprit ? ` · ${issue.culprit}` : ""}</span></div>,
              issue.project,
              <StatusBadge value={issue.level} />,
              formatNumber(issue.events),
              formatNumber(issue.users),
              formatDate(issue.firstSeen),
              formatDate(issue.lastSeen),
            ])}
            onRow={(index) => setOpenId(items[index].id)}
            empty={{ title: status === "unresolved" ? "No open issues" : "Nothing here", description: status === "unresolved" ? "Nothing has broken in this period." : "No issues match these filters." }}
          />}
      </section>
    </>}
    {openId && <IssueDrawer id={openId} onClose={() => setOpenId(null)} />}
  </div>;
}

function IssueDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const auth = useAuth(); const client = useQueryClient();
  const canManage = auth.hasPermission("support.manage");
  const detail = useQuery({ queryKey: ["issue", id], queryFn: () => apiFetch<IssueDetail>(`/admin/issues/${id}`) });
  const change = useMutation({
    mutationFn: (status: IssueStatus) => apiFetch(`/admin/issues/${id}/status`, { method: "PUT", body: JSON.stringify({ status }) }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["issues"] }); await client.invalidateQueries({ queryKey: ["issue", id] }); },
  });
  const issue = detail.data;

  return <div className="dialog-backdrop" onClick={onClose}>
    <aside className="issue-drawer" role="dialog" aria-label="Issue details" onClick={(event) => event.stopPropagation()}>
      <header className="issue-drawer-head">
        <div className="entity-icon danger"><Bug size={16} /></div>
        <div className="issue-drawer-title"><strong>{issue?.title ?? "Loading…"}</strong><span>{issue ? `${issue.shortId} · ${issue.project}` : ""}</span></div>
        <button className="icon-button" aria-label="Close" onClick={onClose}><X size={16} /></button>
      </header>
      {detail.isLoading ? <LoadingState label="Loading issue" /> : detail.error || !issue ? <ErrorState message={(detail.error as Error)?.message ?? "Issue unavailable"} onRetry={() => void detail.refetch()} /> : <div className="issue-drawer-body">
        <dl className="definition-list">
          <div><dt>Status</dt><dd><StatusBadge value={issue.status} /></dd></div>
          <div><dt>Level</dt><dd><StatusBadge value={issue.level} /></dd></div>
          <div><dt>Where</dt><dd>{issue.culprit || "—"}</dd></div>
          <div><dt>Happened</dt><dd>{formatNumber(issue.events)} times · {formatNumber(issue.users)} people</dd></div>
          <div><dt>First / last seen</dt><dd>{formatDate(issue.firstSeen)} → {formatDate(issue.lastSeen)}</dd></div>
          <div><dt>App version</dt><dd>{issue.release ?? "—"}</dd></div>
          <div><dt>Environment</dt><dd>{issue.environment ?? "—"}</dd></div>
        </dl>
        {issue.exception.map((error, index) => <section key={index} className="issue-stack">
          <h3>{error.type}{error.value ? `: ${error.value}` : ""}</h3>
          <ol>{error.frames.map((frame, i) => <li key={i} className={frame.inApp ? "in-app" : undefined}><code>{frame.fn}</code><span>{frame.file}{frame.line ? `:${frame.line}` : ""}</span></li>)}</ol>
        </section>)}
        {issue.tags.length > 0 && <section className="issue-tags">{issue.tags.map((tag) => <span key={tag.key}><b>{tag.key}</b> {tag.value}</span>)}</section>}
        <div className="issue-actions">
          {issue.permalink && <a className="button secondary" href={issue.permalink} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open in Sentry</a>}
          {canManage && issue.status !== "resolved" && <button className="button primary" disabled={change.isPending} onClick={() => change.mutate("resolved")}>Mark resolved</button>}
          {canManage && issue.status === "unresolved" && <button className="button secondary" disabled={change.isPending} onClick={() => change.mutate("ignored")}>Ignore</button>}
          {canManage && issue.status !== "unresolved" && <button className="button secondary" disabled={change.isPending} onClick={() => change.mutate("unresolved")}>Reopen</button>}
        </div>
        {change.error instanceof Error && <p className="error-copy">{change.error.message}</p>}
      </div>}
    </aside>
  </div>;
}
