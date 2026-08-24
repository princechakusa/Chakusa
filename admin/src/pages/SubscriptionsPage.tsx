import { useQuery } from "@tanstack/react-query";
import { CreditCard } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, queryString, type PageEnvelope } from "../api";
import { DataTable, ErrorState, formatDate, LoadingState, PageHeader, Pagination, SearchInput, StatusBadge } from "../components/ui";

interface Subscription { id: string; plan: string; status: string; provider: string | null; environment: string; currentPeriodEnd: string | null; trialEndsAt: string | null; cancelAtPeriodEnd: boolean; updatedAt: string; business: { id: string; name: string; country: string | null; owner: { fullName: string; email: string } } }

export default function SubscriptionsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState(""); const [plan, setPlan] = useState(""); const [status, setStatus] = useState(""); const [page, setPage] = useState(1);
  const params = { search: useDeferredValue(search) || undefined, plan: plan || undefined, status: status || undefined, page, pageSize: 25 };
  const query = useQuery({ queryKey: ["subscriptions", params], queryFn: () => apiFetch<PageEnvelope<Subscription>>(`/admin/subscriptions?${queryString(params)}`) });
  const rows = query.data?.items ?? [];
  return <div className="page"><PageHeader eyebrow="Revenue operations" title="Subscriptions" description="Inspect plan state, renewals, trials, cancellations, and provider synchronization." /><div className="toolbar panel"><SearchInput value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search business or owner email" /><div className="filters"><select value={plan} onChange={(e) => { setPlan(e.target.value); setPage(1); }}><option value="">All plans</option><option>FREE</option><option>PRO</option><option>BUSINESS</option></select><select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option><option>ACTIVE</option><option>TRIALING</option><option>GRACE_PERIOD</option><option>EXPIRED</option><option>CANCELED</option></select></div></div><section className="panel table-panel">{query.isLoading ? <LoadingState label="Loading subscriptions" /> : query.error ? <ErrorState message={(query.error as Error).message} onRetry={() => void query.refetch()} /> : <><DataTable columns={["Business", "Plan", "Status", "Provider", "Renewal / expiry", "Cancellation", "Updated"]} rows={rows.map((item) => [<div className="primary-cell"><span className="entity-icon"><CreditCard size={16} /></span><div><strong>{item.business.name}</strong><span>{item.business.owner.email}</span></div></div>, <StatusBadge value={item.plan} />, <StatusBadge value={item.status} />, item.provider ?? "Internal", formatDate(item.currentPeriodEnd ?? item.trialEndsAt, false), item.cancelAtPeriodEnd ? <StatusBadge value="pending" /> : "No", formatDate(item.updatedAt)])} empty={{ title: "No subscriptions found", description: "No records match the selected filters." }} onRow={(index) => navigate(`/businesses/${rows[index].business.id}`)} /><Pagination page={query.data!.page} pageSize={query.data!.pageSize} total={query.data!.total} onPage={setPage} /></>}</section></div>;
}
