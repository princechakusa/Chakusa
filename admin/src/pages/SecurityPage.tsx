import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Laptop, LogOut, ShieldCheck, Smartphone } from "lucide-react";
import { useState } from "react";
import { apiFetch } from "../api";
import { useAuth } from "../auth";
import { ConfirmationDialog, DataTable, ErrorState, formatDate, LoadingState, PageHeader, StatusBadge } from "../components/ui";

interface Session { id: string; ipAddress: string | null; userAgent: string | null; createdAt: string; lastUsedAt: string; expiresAt: string; status: string; current: boolean }

export default function SecurityPage() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Session | null>(null);
  const [logoutAllOpen, setLogoutAllOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const query = useQuery({ queryKey: ["admin-sessions"], queryFn: () => apiFetch<{ items: Session[] }>("/admin/auth/sessions") });
  const revokeMutation = useMutation({
    mutationFn: (sessionId: string) => apiFetch(`/admin/auth/sessions/${sessionId}`, { method: "DELETE", body: JSON.stringify({ confirmation: "REVOKE" }) }),
    onSuccess: async () => { setSelected(null); setConfirmation(""); await queryClient.invalidateQueries({ queryKey: ["admin-sessions"] }); },
  });
  const logoutAllMutation = useMutation({
    mutationFn: () => apiFetch("/admin/auth/logout-all", { method: "POST", body: JSON.stringify({ confirmation: auth.user!.email }) }),
    onSuccess: async () => { await auth.logout(); },
  });
  const close = () => { setSelected(null); setLogoutAllOpen(false); setConfirmation(""); revokeMutation.reset(); logoutAllMutation.reset(); };
  const sessions = query.data?.items ?? [];

  return <div className="page"><PageHeader eyebrow="Administration security" title="Sessions" description="Review where your administrator account is signed in and revoke access immediately." actions={<button className="button danger-outline" onClick={() => setLogoutAllOpen(true)}><LogOut size={15} />Secure logout everywhere</button>} /><section className="security-summary panel"><div className="dialog-icon"><ShieldCheck size={20} /></div><div><strong>Scoped administrator sessions</strong><p>Administration credentials are isolated from product sessions. Refresh credentials remain HttpOnly and every revocation is audited.</p></div><StatusBadge value="operational" /></section><section className="panel table-panel detail-section">{query.isLoading ? <LoadingState label="Loading secure sessions" /> : query.error ? <ErrorState message={(query.error as Error).message} onRetry={() => void query.refetch()} /> : <DataTable columns={["Device", "Status", "IP address", "Created", "Last used", "Expires", "Action"]} rows={sessions.map((session) => [<div className="primary-cell"><span className="entity-icon">{/Mobile|Android|iPhone/i.test(session.userAgent ?? "") ? <Smartphone size={16} /> : <Laptop size={16} />}</span><div><strong>{session.current ? "Current session" : "Administrator session"}</strong><span className="message-preview">{session.userAgent ?? "Unknown device"}</span></div></div>, <div className="badge-stack"><StatusBadge value={session.status} />{session.current && <StatusBadge value="current" />}</div>, session.ipAddress ?? "Not recorded", formatDate(session.createdAt), formatDate(session.lastUsedAt), formatDate(session.expiresAt), session.status === "active" ? <button className="table-action danger" onClick={() => { setSelected(session); setConfirmation(""); }}>Revoke</button> : "—"])} empty={{ title: "No administrator sessions", description: "No session history is available." }} />}</section><ConfirmationDialog open={Boolean(selected)} title={selected?.current ? "Revoke this current session?" : "Revoke administrator session?"} description={selected?.current ? "You will be signed out of this console immediately." : "This device will lose administrator access and must sign in again."} expected="REVOKE" value={confirmation} onChange={setConfirmation} onCancel={close} onConfirm={() => selected && revokeMutation.mutate(selected.id)} pending={revokeMutation.isPending} error={revokeMutation.error instanceof Error ? revokeMutation.error.message : undefined} confirmLabel="Revoke session" /><ConfirmationDialog open={logoutAllOpen} title="Secure logout everywhere?" description="Every administration session for your account will be revoked, including this one." expected={auth.user?.email ?? ""} value={confirmation} onChange={setConfirmation} onCancel={close} onConfirm={() => logoutAllMutation.mutate()} pending={logoutAllMutation.isPending} error={logoutAllMutation.error instanceof Error ? logoutAllMutation.error.message : undefined} confirmLabel="Logout everywhere" /></div>;
}
