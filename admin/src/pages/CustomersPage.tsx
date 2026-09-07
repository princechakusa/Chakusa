import { useQuery } from "@tanstack/react-query";
import { UserRound } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { apiFetch, queryString, type PageEnvelope } from "../api";
import { DataTable, ErrorState, formatDate, formatNumber, LoadingState, MetricCard, PageHeader, Pagination, SearchInput, StatusBadge } from "../components/ui";

interface Customer { id: string; displayName: string | null; status: string; preferredLanguage: string; verifiedAt: string | null; lastSeenAt: string | null; createdAt: string; user: { email: string; fullName: string; emailVerifiedAt: string | null; accountStatus: string }; _count: { businessLinks: number } }
interface Analytics { totalCustomers: number; verifiedCustomers: number; newLast30Days: number; activeLast7Days: number; customersWithABusinessRelationship: number; totalBusinessRelationships: number; avgBusinessesPerCustomer: number }

export default function CustomersPage() {
  const [search, setSearch] = useState(""); const [status, setStatus] = useState(""); const [page, setPage] = useState(1);
  const params = { search: useDeferredValue(search) || undefined, status: status || undefined, page, pageSize: 25 };
  const list = useQuery({ queryKey: ["admin-customers", params], queryFn: () => apiFetch<PageEnvelope<Customer>>(`/admin/customers?${queryString(params)}`) });
  const analytics = useQuery({ queryKey: ["admin-customer-analytics"], queryFn: () => apiFetch<Analytics>("/admin/customers/analytics") });
  const rows = list.data?.items ?? []; const stats = analytics.data;
  return <div className="page"><PageHeader eyebrow="Customer app" title="Customers" description="A cross-business view of customer accounts, verification, activity, and business relationships." actions={<button className="button secondary" onClick={() => { void list.refetch(); void analytics.refetch(); }}>Refresh data</button>} />
    <section className="metric-grid primary-metrics"><MetricCard label="Total customers" value={formatNumber(stats?.totalCustomers)} /><MetricCard label="Verified" value={formatNumber(stats?.verifiedCustomers)} tone="good" /><MetricCard label="New in 30 days" value={formatNumber(stats?.newLast30Days)} /><MetricCard label="Active in 7 days" value={formatNumber(stats?.activeLast7Days)} /><MetricCard label="Linked customers" value={formatNumber(stats?.customersWithABusinessRelationship)} /><MetricCard label="Business relationships" value={formatNumber(stats?.totalBusinessRelationships)} detail={`${stats?.avgBusinessesPerCustomer ?? 0} average per customer`} /></section>
    <div className="toolbar panel"><SearchInput value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search name, email, or phone" /><div className="filters"><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option><option>ACTIVE</option><option>SUSPENDED</option><option>DELETED</option></select></div></div>
    <section className="panel table-panel">{list.isLoading ? <LoadingState label="Loading customers" /> : list.error ? <ErrorState message={(list.error as Error).message} onRetry={() => void list.refetch()} /> : <><DataTable columns={["Customer", "Status", "Verification", "Business links", "Language", "Last active", "Joined"]} rows={rows.map((item) => [<div className="primary-cell"><span className="entity-icon"><UserRound size={16} /></span><div><strong>{item.displayName || item.user.fullName}</strong><span>{item.user.email}</span></div></div>, <StatusBadge value={item.status} />, <StatusBadge value={item.verifiedAt && item.user.emailVerifiedAt ? "verified" : "pending"} />, formatNumber(item._count.businessLinks), item.preferredLanguage.toUpperCase(), formatDate(item.lastSeenAt), formatDate(item.createdAt, false)])} empty={{ title: "No customers found", description: "No customer accounts match the selected filters." }} /><Pagination page={list.data!.page} pageSize={list.data!.pageSize} total={list.data!.total} onPage={setPage} /></>}</section>
  </div>;
}
