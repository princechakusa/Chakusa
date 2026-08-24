import { useQuery } from "@tanstack/react-query";
import { FileClock } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { apiFetch, queryString, type PageEnvelope } from "../api";
import { DataTable, ErrorState, formatDate, LoadingState, PageHeader, Pagination, SearchInput, StatusBadge } from "../components/ui";

interface AuditEntry { id: string; adminEmail: string; adminRole: string; action: string; targetType: string; targetId: string | null; ipAddress: string | null; userAgent: string | null; createdAt: string }

export default function AuditPage() {
  const [search, setSearch] = useState(""); const [page, setPage] = useState(1); const params = { search: useDeferredValue(search) || undefined, page, pageSize: 25 };
  const query = useQuery({ queryKey: ["audit", params], queryFn: () => apiFetch<PageEnvelope<AuditEntry>>(`/admin/audit?${queryString(params)}`) }); const rows = query.data?.items ?? [];
  return <div className="page"><PageHeader eyebrow="Security record" title="Audit log" description="Immutable records of administration authentication and platform actions." /><div className="audit-callout panel"><FileClock size={20} /><div><strong>Append-only history</strong><p>Audit records cannot be updated or deleted through the application or database roles.</p></div></div><div className="toolbar panel"><SearchInput value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search admin, action, target type, or target ID" /></div><section className="panel table-panel">{query.isLoading ? <LoadingState label="Loading audit history" /> : query.error ? <ErrorState message={(query.error as Error).message} onRetry={() => void query.refetch()} /> : <><DataTable columns={["Administrator", "Action", "Target", "Role", "IP address", "Device", "Timestamp"]} rows={rows.map((entry) => [<div className="stacked-cell"><strong>{entry.adminEmail}</strong><span>{entry.id.slice(0, 8)}</span></div>, <StatusBadge value={entry.action} />, <div className="stacked-cell"><strong>{entry.targetType}</strong><span>{entry.targetId ?? "—"}</span></div>, entry.adminRole.replaceAll("_", " "), entry.ipAddress ?? "Not recorded", <span className="truncate-cell" title={entry.userAgent ?? "Unknown device"}>{entry.userAgent ?? "Unknown device"}</span>, formatDate(entry.createdAt)])} empty={{ title: "No audit records", description: "No admin activity matches this search." }} /><Pagination page={query.data!.page} pageSize={query.data!.pageSize} total={query.data!.total} onPage={setPage} /></>}</section></div>;
}
