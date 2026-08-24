import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquareText } from "lucide-react";
import { useState } from "react";
import { apiFetch, queryString, type PageEnvelope } from "../api";
import { DataTable, ErrorState, formatDate, LoadingState, PageHeader, Pagination, SearchInput, StatusBadge } from "../components/ui";

interface Feedback { id: string; rating: number; category: string; title: string; description: string; status: string; createdAt: string; business: { id: string; name: string; industry: string | null } }
export default function FeedbackPage() {
  const [status, setStatus] = useState(""); const [search, setSearch] = useState(""); const [page, setPage] = useState(1); const client = useQueryClient();
  const params = { status: status || undefined, search: search || undefined, page, pageSize: 25 };
  const query = useQuery({ queryKey: ["feedback", params], queryFn: () => apiFetch<PageEnvelope<Feedback>>(`/admin/feedback?${queryString(params)}`) });
  const mutation = useMutation({ mutationFn: ({ id }: { id: string }) => apiFetch(`/admin/feedback/${id}`, { method: "PATCH", body: JSON.stringify({ status: "RESOLVED", internalNotes: null }) }), onSuccess: () => client.invalidateQueries({ queryKey: ["feedback"] }) });
  if (query.isLoading) return <LoadingState label="Loading beta feedback" />;
  if (query.error || !query.data) return <ErrorState message={(query.error as Error)?.message ?? "Feedback unavailable"} onRetry={() => void query.refetch()} />;
  return <div className="page"><PageHeader eyebrow="Commercial beta" title="Beta feedback" description="Review structured feedback from beta businesses. Status changes are audited." /><div className="toolbar panel"><SearchInput value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search business or feedback" /><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option><option>OPEN</option><option>IN_REVIEW</option><option>RESOLVED</option><option>CLOSED</option></select></div><section className="panel table-panel"><DataTable columns={["Feedback", "Business", "Rating", "Category", "Status", "Created", "Action"]} rows={query.data.items.map(item => [<div className="primary-cell"><span className="entity-icon"><MessageSquareText size={16} /></span><div><strong>{item.title}</strong><span className="message-preview">{item.description}</span></div></div>, item.business.name, `${item.rating}/5`, item.category, <StatusBadge value={item.status} />, formatDate(item.createdAt), item.status === "RESOLVED" ? "Resolved" : <button className="button secondary small" onClick={() => mutation.mutate({ id: item.id })}>Resolve</button>])} empty={{ title: "No beta feedback", description: "No feedback matches this view." }} /><Pagination page={query.data.page} pageSize={query.data.pageSize} total={query.data.total} onPage={setPage} /></section></div>;
}
