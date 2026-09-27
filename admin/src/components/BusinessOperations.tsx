import { useQuery } from "@tanstack/react-query";
import { Eye } from "lucide-react";
import { useState } from "react";
import { apiFetch } from "../api";
import { useAuth } from "../auth";
import { DataTable, ErrorState, formatDate, formatMoney, LoadingState, StatusBadge } from "./ui";

// Read-only operations snapshot (GET /admin/businesses/:id/operations).
// Loaded only on an explicit click because every view is audited; the API
// returns no customer names, contact details, notes, or message bodies.
type Counts = Record<string, number>;
interface Snapshot {
  leads: { byStatus: Counts; recent: { id: string; source: string | null; status: string; urgency: string; serviceRequested: string | null; paymentStatus: string; createdAt: string }[] };
  reviewRequests: { byStatus: Counts; recent: { id: string; status: string; serviceName: string | null; sentAt: string | null; createdAt: string }[] };
  invoices: { byStatus: Counts; recent: { id: string; invoiceNumber: string; status: string; currency: string; dueDate: string | null; createdAt: string }[] };
  quotes: { byStatus: Counts; recent: { id: string; documentNumber: string; documentType: string; status: string; expiresAt: string | null; createdAt: string }[] };
  services: { id: string; name: string; category: string | null; durationMinutes: number; price: number | null; active: boolean; publiclyBookable: boolean }[];
  inventory: { total: number; active: number };
  reminders: { byStatus: Counts; upcoming: { id: string; status: string; serviceName: string | null; dueDate: string }[] };
}

function CountChips({ counts }: { counts: Counts }) {
  const entries = Object.entries(counts);
  if (!entries.length) return <span className="muted">None yet</span>;
  return <span className="chip-row">{entries.map(([status, n]) => <span key={status} className="count-chip"><StatusBadge value={status} /> {n}</span>)}</span>;
}

export function BusinessOperations({ businessId, currency }: { businessId: string; currency: string }) {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const query = useQuery({ queryKey: ["business-operations", businessId], queryFn: () => apiFetch<Snapshot>(`/admin/businesses/${businessId}/operations`), enabled: open, staleTime: 60_000 });
  if (!auth.hasPermission("support.impersonate.read")) return null;

  return <section className="panel table-panel detail-section">
    <div className="panel-heading"><div><p className="eyebrow">Operations</p><h2>Leads, reviews, billing documents and services</h2></div>
      {!open && <button className="button secondary" onClick={() => setOpen(true)}><Eye size={16} />Open read-only snapshot</button>}</div>
    {!open ? <p className="muted">Shows workflow status for this business without customer personal data. Opening it is recorded in the audit log.</p>
      : query.isLoading ? <LoadingState label="Loading operations" />
      : query.error || !query.data ? <ErrorState message={(query.error as Error)?.message ?? "Operations unavailable"} onRetry={() => void query.refetch()} />
      : <OperationsBody data={query.data} currency={currency} />}
  </section>;
}

function OperationsBody({ data, currency }: { data: Snapshot; currency: string }) {
  return <div className="ops-grid">
    <dl className="definition-list">
      <div><dt>Leads</dt><dd><CountChips counts={data.leads.byStatus} /></dd></div>
      <div><dt>Review requests</dt><dd><CountChips counts={data.reviewRequests.byStatus} /></dd></div>
      <div><dt>Invoices</dt><dd><CountChips counts={data.invoices.byStatus} /></dd></div>
      <div><dt>Quotes</dt><dd><CountChips counts={data.quotes.byStatus} /></dd></div>
      <div><dt>Reminders</dt><dd><CountChips counts={data.reminders.byStatus} /></dd></div>
      <div><dt>Inventory</dt><dd>{data.inventory.active} active of {data.inventory.total} items</dd></div>
    </dl>
    <h3>Recent leads</h3>
    <DataTable columns={["Source", "Service", "Status", "Urgency", "Payment", "Created"]} rows={data.leads.recent.map((l) => [l.source ?? "Manual", l.serviceRequested ?? "—", <StatusBadge value={l.status} />, l.urgency, <StatusBadge value={l.paymentStatus} />, formatDate(l.createdAt)])} empty={{ title: "No leads", description: "This business has no leads yet." }} />
    <h3>Recent review requests</h3>
    <DataTable columns={["Service", "Status", "Sent", "Created"]} rows={data.reviewRequests.recent.map((r) => [r.serviceName ?? "—", <StatusBadge value={r.status} />, formatDate(r.sentAt), formatDate(r.createdAt)])} empty={{ title: "No review requests", description: "None sent yet." }} />
    <h3>Recent invoices and quotes</h3>
    <DataTable columns={["Document", "Type", "Status", "Due / expires", "Created"]} rows={[
      ...data.invoices.recent.map((i) => [i.invoiceNumber, "Invoice", <StatusBadge value={i.status} />, formatDate(i.dueDate, false), formatDate(i.createdAt)]),
      ...data.quotes.recent.map((q) => [q.documentNumber, q.documentType.toLowerCase(), <StatusBadge value={q.status} />, formatDate(q.expiresAt, false), formatDate(q.createdAt)]),
    ]} empty={{ title: "No billing documents", description: "No invoices or quotes yet." }} />
    <h3>Services</h3>
    <DataTable columns={["Service", "Category", "Duration", "Price", "Bookable", "Active"]} rows={data.services.map((s) => [s.name, s.category ?? "—", `${s.durationMinutes} min`, s.price == null ? "—" : formatMoney(s.price, currency), s.publiclyBookable ? "Public" : "Internal", <StatusBadge value={s.active ? "active" : "inactive"} />])} empty={{ title: "No services", description: "The service catalogue is empty." }} />
    <h3>Upcoming reminders</h3>
    <DataTable columns={["Service", "Status", "Due"]} rows={data.reminders.upcoming.map((r) => [r.serviceName ?? "—", <StatusBadge value={r.status} />, formatDate(r.dueDate, false)])} empty={{ title: "No upcoming reminders", description: "Nothing scheduled." }} />
  </div>;
}
