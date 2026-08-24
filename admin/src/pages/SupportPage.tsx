import { useQuery } from "@tanstack/react-query";
import { CircleHelp } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch, queryString, type PageEnvelope } from "../api";
import { DataTable, ErrorState, formatDate, LoadingState, PageHeader, Pagination, SearchInput, StatusBadge } from "../components/ui";

interface Ticket { id: string; category: string; subject: string; message: string; status: string; expectedResponseAt: string | null; resolvedAt: string | null; createdAt: string; updatedAt: string; business: { id: string; name: string }; createdByUser: { fullName: string; email: string } }

export default function SupportPage() {
  const [search, setSearch] = useState(""); const [status, setStatus] = useState(""); const [page, setPage] = useState(1);
  const params = { search: useDeferredValue(search) || undefined, status: status || undefined, page, pageSize: 25 };
  const query = useQuery({ queryKey: ["support", params], queryFn: () => apiFetch<PageEnvelope<Ticket>>(`/admin/support?${queryString(params)}`) }); const rows = query.data?.items ?? [];
  return <div className="page"><PageHeader eyebrow="Customer operations" title="Support center" description="Search cases and open the associated business context without changing product data." /><div className="toolbar panel"><SearchInput value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search case, business, or user email" /><div className="filters"><select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option><option>open</option><option>in_progress</option><option>resolved</option><option>closed</option></select></div></div><section className="panel table-panel">{query.isLoading ? <LoadingState label="Loading support cases" /> : query.error ? <ErrorState message={(query.error as Error).message} onRetry={() => void query.refetch()} /> : <><DataTable columns={["Case", "Business", "Requester", "Category", "Status", "Expected response", "Updated"]} rows={rows.map((ticket) => [<div className="primary-cell"><span className="entity-icon"><CircleHelp size={16} /></span><div><strong>{ticket.subject}</strong><span className="message-preview">{ticket.message}</span></div></div>, <Link className="inline-link" to={`/businesses/${ticket.business.id}`}>{ticket.business.name}</Link>, <div className="stacked-cell"><strong>{ticket.createdByUser.fullName}</strong><span>{ticket.createdByUser.email}</span></div>, ticket.category, <StatusBadge value={ticket.status} />, formatDate(ticket.expectedResponseAt), formatDate(ticket.updatedAt)])} empty={{ title: "No support cases", description: "No tickets match this view." }} /><Pagination page={query.data!.page} pageSize={query.data!.pageSize} total={query.data!.total} onPage={setPage} /></>}</section></div>;
}
