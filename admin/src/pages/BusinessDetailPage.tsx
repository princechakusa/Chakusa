import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, MapPin, RotateCcw, Users } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiFetch } from "../api";
import { useAuth } from "../auth";
import { ConfirmationDialog, DataTable, ErrorState, formatDate, formatMoney, formatNumber, LoadingState, MetricCard, StatusBadge } from "../components/ui";

export default function BusinessDetailPage() {
  const { id } = useParams();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const query = useQuery({ queryKey: ["business", id], queryFn: () => apiFetch<any>(`/admin/businesses/${id}`), enabled: Boolean(id) });
  const resetMutation = useMutation({
    mutationFn: (businessName: string) => apiFetch(`/admin/businesses/${id}/reset-onboarding`, { method: "POST", body: JSON.stringify({ confirmation: businessName }) }),
    onSuccess: async () => { setDialogOpen(false); setConfirmation(""); await queryClient.invalidateQueries({ queryKey: ["business", id] }); },
  });
  if (query.isLoading) return <LoadingState label="Loading business profile" />;
  if (query.error || !query.data) return <ErrorState message={(query.error as Error)?.message ?? "Business not found"} />;
  const { business, stats, recentAutomation } = query.data;

  return <div className="page detail-page">
    <Link className="back-link" to="/businesses"><ArrowLeft size={16} />Back to businesses</Link>
    <header className="detail-header"><div className="detail-identity"><span className="entity-hero">{business.name[0]}</span><div><div className="detail-title-line"><h1>{business.name}</h1><StatusBadge value={business.subscription?.status ?? "ACTIVE"} /><StatusBadge value={business.subscription?.plan ?? "FREE"} /></div><p>{business.industry ?? "Industry not set"}{business.country ? ` · ${business.country}` : ""}</p></div></div>{auth.hasPermission("business.onboarding.reset") && business.onboardingCompletedAt ? <button className="button secondary" onClick={() => setDialogOpen(true)}><RotateCcw size={15} />Reset onboarding</button> : <div className="read-only-notice">Read-only profile</div>}</header>
    <section className="metric-grid detail-metrics"><MetricCard label="Customers" value={formatNumber(stats.customers)} /><MetricCard label="Leads" value={formatNumber(stats.leads)} detail={`${stats.recoveredLeads} recovered`} /><MetricCard label="Recovered revenue" value={formatMoney(stats.recoveredRevenue, business.currency ?? "USD")} /><MetricCard label="Automation runs" value={formatNumber(stats.automationRuns)} /><MetricCard label="Review requests" value={formatNumber(stats.reviewRequests)} /><MetricCard label="Average rating" value={stats.averageRating == null ? "—" : `${formatNumber(stats.averageRating, 1)} / 5`} /></section>
    <section className="detail-grid">
      <article className="panel detail-card"><div className="panel-heading"><div><p className="eyebrow">Business profile</p><h2>Account information</h2></div></div><dl className="definition-list"><div><dt>Owner</dt><dd><strong>{business.owner.fullName}</strong><span>{business.owner.email}</span></dd></div><div><dt>Phone</dt><dd>{business.phone ?? "Not provided"}</dd></div><div><dt>Location</dt><dd>{business.country || business.timezone ? <><MapPin size={15} />{[business.country, business.timezone].filter(Boolean).join(" · ")}</> : "Not configured"}</dd></div><div><dt>Onboarding</dt><dd><StatusBadge value={business.onboardingCompletedAt ? "completed" : "pending"} /></dd></div><div><dt>Public profile</dt><dd>{business.publicSlug ? <span className="inline-link">/{business.publicSlug}<ExternalLink size={13} /></span> : "Not configured"}</dd></div><div><dt>Created</dt><dd>{formatDate(business.createdAt)}</dd></div></dl></article>
      <article className="panel detail-card"><div className="panel-heading"><div><p className="eyebrow">Billing</p><h2>Subscription</h2></div></div>{business.subscription ? <dl className="definition-list"><div><dt>Current plan</dt><dd><StatusBadge value={business.subscription.plan} /></dd></div><div><dt>Status</dt><dd><StatusBadge value={business.subscription.status} /></dd></div><div><dt>Provider</dt><dd>{business.subscription.provider ?? "No provider"}</dd></div><div><dt>Current period</dt><dd>{formatDate(business.subscription.currentPeriodStart, false)} — {formatDate(business.subscription.currentPeriodEnd, false)}</dd></div><div><dt>Trial ends</dt><dd>{formatDate(business.subscription.trialEndsAt)}</dd></div><div><dt>Cancel at period end</dt><dd>{business.subscription.cancelAtPeriodEnd ? "Yes" : "No"}</dd></div></dl> : <p className="quiet-copy">No subscription row is available.</p>}</article>
    </section>
    <section className="panel table-panel detail-section"><div className="panel-heading"><div><p className="eyebrow">Access</p><h2>Team members</h2></div><span>{business.members.length} seats</span></div><DataTable columns={["Member", "Role", "Status", "Joined"]} rows={business.members.map((member: any) => [<div className="primary-cell"><span className="entity-icon"><Users size={16} /></span><div><strong>{member.user.fullName}</strong><span>{member.user.email}</span></div></div>, <StatusBadge value={member.role} />, <StatusBadge value={member.status} />, formatDate(member.createdAt, false)])} empty={{ title: "No team members", description: "This business has no membership records." }} /></section>
    <section className="panel table-panel detail-section"><div className="panel-heading"><div><p className="eyebrow">Automation</p><h2>Recent runs</h2></div></div><DataTable columns={["Rule", "Trigger", "Status", "Attempts", "Scheduled", "Duration"]} rows={recentAutomation.map((run: any) => [run.automationRule.name, run.automationRule.triggerType.replaceAll("_", " "), <StatusBadge value={run.status} />, run.attemptCount, formatDate(run.scheduledFor), run.executionTimeMs == null ? "—" : `${(run.executionTimeMs / 1000).toFixed(1)}s`])} empty={{ title: "No automation history", description: "No runs have been recorded for this business." }} /></section>
    <ConfirmationDialog open={dialogOpen} title="Reset business onboarding?" description="The business will be returned to the product onboarding flow. Existing business data is preserved." expected={business.name} value={confirmation} onChange={setConfirmation} onCancel={() => { setDialogOpen(false); setConfirmation(""); resetMutation.reset(); }} onConfirm={() => resetMutation.mutate(confirmation)} pending={resetMutation.isPending} error={resetMutation.error instanceof Error ? resetMutation.error.message : undefined} confirmLabel="Reset onboarding" />
  </div>;
}
