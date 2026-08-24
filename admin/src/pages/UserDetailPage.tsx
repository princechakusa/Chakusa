import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Laptop, ShieldCheck, ShieldX } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiFetch } from "../api";
import { useAuth } from "../auth";
import { ConfirmationDialog, DataTable, ErrorState, formatDate, LoadingState, StatusBadge } from "../components/ui";

export default function UserDetailPage() {
  const { id } = useParams();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const query = useQuery({ queryKey: ["user", id], queryFn: () => apiFetch<any>(`/admin/users/${id}`), enabled: Boolean(id) });
  const revokeMutation = useMutation({
    mutationFn: (email: string) => apiFetch<{ revokedSessionCount: number }>(`/admin/users/${id}/revoke-sessions`, { method: "POST", body: JSON.stringify({ confirmation: email }) }),
    onSuccess: async () => { setDialogOpen(false); setConfirmation(""); await queryClient.invalidateQueries({ queryKey: ["user", id] }); },
  });
  if (query.isLoading) return <LoadingState label="Loading identity profile" />;
  if (query.error || !query.data) return <ErrorState message={(query.error as Error)?.message ?? "User not found"} />;
  const user = query.data;
  const activeSessions = user.authSessions.filter((session: any) => session.status === "active").length;

  return <div className="page detail-page">
    <Link className="back-link" to="/users"><ArrowLeft size={16} />Back to users</Link>
    <header className="detail-header"><div className="detail-identity"><span className="entity-hero">{user.fullName[0]}</span><div><div className="detail-title-line"><h1>{user.fullName}</h1>{user.adminMembership && <StatusBadge value={user.adminMembership.role} />}</div><p>{user.email}</p></div></div>{auth.hasPermission("user.session.revoke") && activeSessions > 0 ? <button className="button danger-outline" onClick={() => setDialogOpen(true)}><ShieldX size={15} />Revoke sessions</button> : <div className="read-only-notice">Read-only identity</div>}</header>
    <section className="detail-grid">
      <article className="panel detail-card"><div className="panel-heading"><div><p className="eyebrow">Identity</p><h2>Account information</h2></div></div><dl className="definition-list"><div><dt>Email status</dt><dd><StatusBadge value={user.emailVerifiedAt ? "verified" : "pending"} /></dd></div><div><dt>Created</dt><dd>{formatDate(user.createdAt)}</dd></div><div><dt>Last updated</dt><dd>{formatDate(user.updatedAt)}</dd></div><div><dt>Sign-in providers</dt><dd>{user.authIdentities.map((identity: any) => identity.provider).join(", ") || "Password"}</dd></div></dl></article>
      <article className="panel detail-card"><div className="panel-heading"><div><p className="eyebrow">Administration</p><h2>Admin access</h2></div><ShieldCheck size={18} /></div>{user.adminMembership ? <dl className="definition-list"><div><dt>Role</dt><dd><StatusBadge value={user.adminMembership.role} /></dd></div><div><dt>Status</dt><dd><StatusBadge value={user.adminMembership.status} /></dd></div><div><dt>MFA required</dt><dd>{user.adminMembership.mfaRequired ? "Yes" : "No"}</dd></div><div><dt>MFA enrolled</dt><dd>{formatDate(user.adminMembership.mfaEnrolledAt)}</dd></div></dl> : <p className="quiet-copy">This user has no administration membership.</p>}</article>
    </section>
    <section className="panel table-panel detail-section"><div className="panel-heading"><div><p className="eyebrow">Product access</p><h2>Business memberships</h2></div></div><DataTable columns={["Business", "Role", "Status", "Joined"]} rows={user.memberships.map((membership: any) => [<Link className="inline-link" to={`/businesses/${membership.business.id}`}>{membership.business.name}</Link>, <StatusBadge value={membership.role} />, <StatusBadge value={membership.status} />, formatDate(membership.createdAt, false)])} empty={{ title: "No business memberships", description: "This user does not belong to a business." }} /></section>
    <section className="panel table-panel detail-section"><div className="panel-heading"><div><p className="eyebrow">Security</p><h2>Recent sessions</h2></div><span>{activeSessions} active</span></div><DataTable columns={["Scope", "Status", "IP address", "Device", "Last used", "Expires"]} rows={user.authSessions.map((session: any) => [<StatusBadge value={session.scope} />, <StatusBadge value={session.status} />, session.ipAddress ?? "Not recorded", <span className="truncate-cell" title={session.userAgent ?? "Unknown device"}>{session.userAgent ?? "Unknown device"}</span>, formatDate(session.lastUsedAt), formatDate(session.expiresAt)])} empty={{ title: "No sessions", description: "No session history is available." }} /></section>
    <ConfirmationDialog open={dialogOpen} title="Revoke all user sessions?" description="All product and administration sessions for this user will be revoked. They can sign in again with valid credentials." expected={user.email} value={confirmation} onChange={setConfirmation} onCancel={() => { setDialogOpen(false); setConfirmation(""); revokeMutation.reset(); }} onConfirm={() => revokeMutation.mutate(confirmation)} pending={revokeMutation.isPending} error={revokeMutation.error instanceof Error ? revokeMutation.error.message : undefined} confirmLabel="Revoke all sessions" />
  </div>;
}
