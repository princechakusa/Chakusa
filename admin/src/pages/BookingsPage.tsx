import { useQuery } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react";
import { useState } from "react";
import { apiFetch, queryString, type PageEnvelope } from "../api";
import { DataTable, ErrorState, formatDate, formatMoney, formatNumber, formatPercent, LoadingState, MetricCard, PageHeader, Pagination, StatusBadge } from "../components/ui";

interface Booking { id: string; businessId: string; businessName: string; customerName: string | null; bookingChannel: string; serviceName: string; staffName: string | null; startsAt: string; endsAt: string; status: string; price: number | null; paymentStatus: string }
interface Analytics { total: number; upcomingNext7Days: number; created30d: number; canceled30d: number; noShow30d: number; cancellationRate: number; noShowRate: number; byStatus: Record<string, number> }

export default function BookingsPage() {
  const [status, setStatus] = useState(""); const [channel, setChannel] = useState(""); const [page, setPage] = useState(1);
  const params = { status: status || undefined, channel: channel || undefined, page, pageSize: 25 };
  const list = useQuery({ queryKey: ["admin-bookings", params], queryFn: () => apiFetch<PageEnvelope<Booking>>(`/admin/bookings?${queryString(params)}`) });
  const analytics = useQuery({ queryKey: ["admin-booking-analytics"], queryFn: () => apiFetch<Analytics>("/admin/bookings/analytics") });
  const rows = list.data?.items ?? []; const stats = analytics.data;
  return <div className="page"><PageHeader eyebrow="Business dashboard" title="Bookings" description="Platform-wide booking activity, schedules, fulfillment, payment state, and service delivery." actions={<button className="button secondary" onClick={() => { void list.refetch(); void analytics.refetch(); }}>Refresh data</button>} />
    <section className="metric-grid primary-metrics"><MetricCard label="All bookings" value={formatNumber(stats?.total)} /><MetricCard label="Next 7 days" value={formatNumber(stats?.upcomingNext7Days)} tone="good" /><MetricCard label="Created in 30 days" value={formatNumber(stats?.created30d)} /><MetricCard label="Completed" value={formatNumber(stats?.byStatus.COMPLETED)} /><MetricCard label="Cancellation rate" value={formatPercent(stats?.cancellationRate)} tone={stats?.cancellationRate ? "warning" : "default"} /><MetricCard label="No-show rate" value={formatPercent(stats?.noShowRate)} tone={stats?.noShowRate ? "warning" : "default"} /></section>
    <div className="toolbar panel"><div><strong>Booking register</strong></div><div className="filters"><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option><option>SCHEDULED</option><option>CONFIRMED</option><option>COMPLETED</option><option>CANCELED</option><option>NO_SHOW</option></select><select value={channel} onChange={(event) => { setChannel(event.target.value); setPage(1); }}><option value="">All channels</option><option value="business">Business</option><option value="public">Public</option><option value="customer_app">Customer app</option></select></div></div>
    <section className="panel table-panel">{list.isLoading ? <LoadingState label="Loading bookings" /> : list.error ? <ErrorState message={(list.error as Error).message} onRetry={() => void list.refetch()} /> : <><DataTable columns={["Business", "Customer", "Service", "Start", "Status", "Payment", "Value", "Channel"]} rows={rows.map((item) => [<div className="primary-cell"><span className="entity-icon"><CalendarDays size={16} /></span><div><strong>{item.businessName}</strong><span>{item.staffName || "Unassigned"}</span></div></div>, item.customerName || "Guest", item.serviceName, formatDate(item.startsAt), <StatusBadge value={item.status} />, <StatusBadge value={item.paymentStatus} />, item.price == null ? "Not set" : formatMoney(item.price), item.bookingChannel.replaceAll("_", " ")])} empty={{ title: "No bookings found", description: "No booking records match the selected filters." }} /><Pagination page={list.data!.page} pageSize={list.data!.pageSize} total={list.data!.total} onPage={setPage} /></>}</section>
  </div>;
}
