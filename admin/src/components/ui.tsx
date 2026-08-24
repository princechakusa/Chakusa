import { AlertCircle, ChevronLeft, ChevronRight, LoaderCircle, Search, X } from "lucide-react";
import type { ReactNode } from "react";

export function StatusBadge({ value }: { value: string | null | undefined }) {
  const normalized = (value ?? "unknown").toLowerCase();
  const positive = ["active", "operational", "completed", "delivered", "paid", "reviewed", "resolved", "verified", "trialing"].includes(normalized);
  const danger = ["failed", "unavailable", "expired", "canceled", "cancelled", "undelivered", "suspended", "closed"].includes(normalized);
  const warning = ["pending", "running", "grace_period", "in_progress", "open", "queued"].includes(normalized);
  return <span className={`status-badge ${positive ? "positive" : danger ? "danger" : warning ? "warning" : "neutral"}`}><i />{normalized.replaceAll("_", " ")}</span>;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description: string; actions?: ReactNode }) {
  return <header className="page-header">
    <div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1><p>{description}</p></div>
    {actions && <div className="page-actions">{actions}</div>}
  </header>;
}

export function MetricCard({ label, value, detail, tone = "default" }: { label: string; value: ReactNode; detail?: ReactNode; tone?: "default" | "good" | "warning" | "danger" }) {
  return <article className={`metric-card ${tone}`}><p>{label}</p><strong>{value}</strong>{detail && <span>{detail}</span>}</article>;
}

export function SearchInput({ value, onChange, placeholder = "Search" }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <label className="search-input"><Search size={16} /><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />{value && <button type="button" aria-label="Clear search" onClick={() => onChange("")}><X size={14} /></button>}</label>;
}

export function LoadingState({ label = "Loading data" }: { label?: string }) {
  return <div className="state-panel"><LoaderCircle className="spin" size={22} /><p>{label}</p></div>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="state-panel error"><AlertCircle size={22} /><div><strong>Unable to load this view</strong><p>{message}</p></div>{onRetry && <button className="button secondary" onClick={onRetry}>Try again</button>}</div>;
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return <div className="empty-state"><div className="empty-mark" /><strong>{title}</strong><p>{description}</p></div>;
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const start = total ? (page - 1) * pageSize + 1 : 0;
  const end = Math.min(total, page * pageSize);
  return <div className="pagination"><span>{start}–{end} of {total.toLocaleString()}</span><div><button disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft size={16} /></button><span>Page {page} of {pages}</span><button disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight size={16} /></button></div></div>;
}

export function DataTable({ columns, rows, empty, onRow }: { columns: string[]; rows: ReactNode[][]; empty: { title: string; description: string }; onRow?: (index: number) => void }) {
  if (!rows.length) return <EmptyState {...empty} />;
  return <div className="table-scroll"><table><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((cells, index) => <tr key={index} className={onRow ? "clickable" : undefined} onClick={() => onRow?.(index)}>{cells.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div>;
}

export function formatDate(value: string | Date | null | undefined, withTime = true) {
  if (!value) return "—";
  const date = new Date(value);
  return new Intl.DateTimeFormat("en", withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" }).format(date);
}

export function formatNumber(value: number | null | undefined, digits = 0) {
  return value == null ? "—" : new Intl.NumberFormat("en", { maximumFractionDigits: digits }).format(value);
}

export function formatMoney(value: number | null | undefined, currency = "USD") {
  return value == null ? "—" : new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}

export function formatPercent(value: number | null | undefined) {
  return value == null ? "—" : new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 1 }).format(value);
}
