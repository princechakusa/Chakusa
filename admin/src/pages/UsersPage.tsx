import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, UserRound } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, queryString, type PageEnvelope } from "../api";
import { DataTable, ErrorState, formatDate, LoadingState, PageHeader, Pagination, SearchInput, StatusBadge } from "../components/ui";

interface UserRow { id: string; email: string; fullName: string; emailVerifiedAt: string | null; createdAt: string; adminMembership: { role: string; status: string; mfaRequired: boolean } | null; memberships: { role: string; status: string; business: { id: string; name: string } }[]; _count: { authSessions: number; deviceTokens: number } }

export default function UsersPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("");
  const [page, setPage] = useState(1);
  const deferredSearch = useDeferredValue(search);
  const params = { search: deferredSearch || undefined, adminOnly: kind === "admins" ? true : kind === "product" ? false : undefined, page, pageSize: 25 };
  const query = useQuery({ queryKey: ["users", params], queryFn: () => apiFetch<PageEnvelope<UserRow>>(`/admin/users?${queryString(params)}`) });
  const rows = query.data?.items ?? [];
  return <div className="page"><PageHeader eyebrow="Identity directory" title="Users" description="Review account access, memberships, devices, and active sessions." /><div className="toolbar panel"><SearchInput value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search name or email" /><div className="filters"><select value={kind} onChange={(event) => { setKind(event.target.value); setPage(1); }}><option value="">All users</option><option value="admins">Admin users</option><option value="product">Product users</option></select></div></div><section className="panel table-panel">{query.isLoading ? <LoadingState label="Loading users" /> : query.error ? <ErrorState message={(query.error as Error).message} onRetry={() => void query.refetch()} /> : <><DataTable columns={["User", "Access", "Businesses", "Sessions", "Devices", "Joined"]} rows={rows.map((item) => [<div className="primary-cell"><span className="entity-icon">{item.adminMembership ? <ShieldCheck size={16} /> : <UserRound size={16} />}</span><div><strong>{item.fullName}</strong><span>{item.email}</span></div></div>, item.adminMembership ? <div className="badge-stack"><StatusBadge value={item.adminMembership.role} /><StatusBadge value={item.adminMembership.status} /></div> : <StatusBadge value={item.emailVerifiedAt ? "verified" : "pending"} />, item.memberships.length, item._count.authSessions, item._count.deviceTokens, formatDate(item.createdAt, false)])} empty={{ title: "No users found", description: "Try changing the current search or filter." }} onRow={(index) => navigate(`/users/${rows[index].id}`)} /><Pagination page={query.data!.page} pageSize={query.data!.pageSize} total={query.data!.total} onPage={setPage} /></>}</section></div>;
}
