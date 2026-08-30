import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { WorkflowAnalyticsDto, WorkflowDto, WorkflowExecutionDto, WorkflowTemplateDto } from '../apiTypes';
import { automationApi } from '../services/endpoints';
import { colors, radius, spacing, typography } from '../theme';
import { ErrorState, LoadingState, PrimaryButton, SecondaryButton, StatusBadge } from './ui';

export function ProductionWorkflowPanel({ canManage }: { canManage: boolean }) {
  const [workflows, setWorkflows] = useState<WorkflowDto[]>([]);
  const [executions, setExecutions] = useState<WorkflowExecutionDto[]>([]);
  const [templates, setTemplates] = useState<WorkflowTemplateDto[]>([]);
  const [analytics, setAnalytics] = useState<WorkflowAnalyticsDto | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const results = await Promise.allSettled([
      automationApi.listWorkflows(), automationApi.listWorkflowExecutions(),
      automationApi.listWorkflowTemplates(), automationApi.workflowAnalytics(),
    ]);
    const [workflowResult, executionResult, templateResult, analyticsResult] = results;
    if (workflowResult.status === 'fulfilled') setWorkflows(workflowResult.value);
    if (executionResult.status === 'fulfilled') setExecutions(executionResult.value.items);
    if (templateResult.status === 'fulfilled') setTemplates(templateResult.value.items);
    if (analyticsResult.status === 'fulfilled') setAnalytics(analyticsResult.value);
    setError(results.some(item => item.status === 'rejected') ? 'Some workflow data could not be loaded. Available sections remain usable.' : null);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (key: string, operation: () => Promise<unknown>) => {
    if (working) return;
    setWorking(key); setError(null);
    try { await operation(); await load(); }
    catch { setError('The workflow operation could not be completed. Refresh and try again.'); }
    finally { setWorking(null); }
  };
  if (loading && !workflows.length) return <LoadingState label="Loading workflow management…" />;
  if (error && !workflows.length && !executions.length) return <ErrorState message={error} onRetry={() => void load()} />;

  return <>
    <View style={styles.card}><Text style={styles.heading}>Workflow analytics</Text><View style={styles.metrics}><Metric label="Success" value={analytics?.successRate == null ? '—' : `${Math.round(analytics.successRate * 100)}%`} /><Metric label="Failures" value={analytics?.failureRate == null ? '—' : `${Math.round(analytics.failureRate * 100)}%`} /><Metric label="Retries" value={String(analytics?.retries ?? 0)} /></View><Text style={styles.body}>{analytics?.throughputPerDay.toFixed(1) ?? '—'} executions/day · {duration(analytics?.averageExecutionTimeMs)} average runtime</Text></View>
    <View style={styles.card}><Text style={styles.heading}>Workflow management</Text>{workflows.map(workflow => <Pressable accessibilityRole="button" accessibilityLabel={`${workflow.name}, ${workflow.status}`} accessibilityHint="Shows versions and workflow controls" accessibilityState={{ expanded: expanded === workflow.id }} key={workflow.id} style={styles.item} onPress={() => setExpanded(value => value === workflow.id ? null : workflow.id)}><View style={styles.row}><View style={styles.copy}><Text style={styles.name}>{workflow.name}</Text><Text style={styles.body}>Version {workflow.versions[0]?.version ?? 1} · {workflow._count?.executions ?? 0} executions</Text></View><StatusBadge label={workflow.status} /></View>{expanded === workflow.id ? <View style={styles.details}><Text style={styles.body}>{workflow.description || 'No workflow description.'}</Text>{workflow.versions.map(version => <Text key={version.id} style={styles.body}>v{version.version} · {version.publishedAt ? 'Published' : 'Draft'} · {new Date(version.createdAt).toLocaleDateString()}</Text>)}{canManage && workflow.status === 'PUBLISHED' ? <><PrimaryButton fullWidth disabled={Boolean(working)} label={working === `${workflow.id}:trigger` ? 'Starting…' : 'Run manually'} onPress={() => void act(`${workflow.id}:trigger`, () => automationApi.triggerWorkflow(workflow.id))} /><SecondaryButton fullWidth disabled={Boolean(working)} label="Pause workflow" onPress={() => void act(workflow.id, () => automationApi.pauseWorkflow(workflow.id))} /></> : null}{canManage && workflow.status === 'PAUSED' ? <SecondaryButton fullWidth disabled={Boolean(working)} label="Resume workflow" onPress={() => void act(workflow.id, () => automationApi.resumeWorkflow(workflow.id))} /> : null}</View> : null}</Pressable>)}{!workflows.length ? <Text style={styles.body}>No workflows have been created.</Text> : null}</View>
    <View style={styles.card}><Text style={styles.heading}>Templates</Text>{templates.map(template => <View key={template.id} style={styles.item}><View style={styles.row}><View style={styles.copy}><Text style={styles.name}>{template.name}</Text><Text style={styles.body}>Version {template.version} · {template.description || 'No description'}</Text></View><StatusBadge label={template.active ? 'AVAILABLE' : 'INACTIVE'} /></View></View>)}{!templates.length ? <Text style={styles.body}>No templates are currently available.</Text> : null}</View>
    <View style={styles.card}><Text style={styles.heading}>Execution history</Text>{executions.map(execution => <Pressable accessibilityRole="button" accessibilityLabel={`${execution.workflow.name}, ${execution.status}`} accessibilityHint="Shows execution history and controls" accessibilityState={{ expanded: expanded === execution.id }} key={execution.id} style={styles.item} onPress={() => setExpanded(value => value === execution.id ? null : execution.id)}><View style={styles.row}><View style={styles.copy}><Text style={styles.name}>{execution.workflow.name}</Text><Text style={styles.body}>{execution.attempts} attempt{execution.attempts === 1 ? '' : 's'} · {execution.currentNodeId ? `Node ${execution.currentNodeId}` : 'No active node'}</Text></View><StatusBadge label={execution.status} /></View>{expanded === execution.id ? <View style={styles.details}>{execution.lastError ? <Text accessibilityRole="alert" style={styles.error}>Failure: {execution.lastError}</Text> : null}<Text style={styles.body}>Scheduled {date(execution.scheduledFor)} · Started {date(execution.startedAt)} · Completed {date(execution.completedAt)}</Text>{execution.history?.map(event => <Text key={event.id} style={styles.body}>{date(event.createdAt)} · {event.type.replaceAll('_', ' ')}</Text>)}{canManage && ['FAILED', 'CANCELLED'].includes(execution.status) ? <PrimaryButton fullWidth disabled={Boolean(working)} label={working === execution.id ? 'Retrying…' : 'Retry execution'} onPress={() => void act(execution.id, () => automationApi.controlExecution(execution.id, 'retry'))} /> : null}{canManage && execution.status === 'RUNNING' ? <SecondaryButton fullWidth disabled={Boolean(working)} label="Pause execution" onPress={() => void act(execution.id, () => automationApi.controlExecution(execution.id, 'pause'))} /> : null}{canManage && execution.status === 'PAUSED' ? <SecondaryButton fullWidth disabled={Boolean(working)} label="Resume execution" onPress={() => void act(execution.id, () => automationApi.controlExecution(execution.id, 'resume'))} /> : null}</View> : null}</Pressable>)}{!executions.length ? <Text style={styles.body}>No workflow executions yet.</Text> : null}</View>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
  </>;
}
function Metric({ label, value }: { label: string; value: string }) { return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>; }
function date(value: string | null | undefined) { return value ? new Date(value).toLocaleString() : '—'; }
function duration(value: number | null | undefined) { return value == null ? '—' : value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(1)} s`; }
const styles = StyleSheet.create({ card:{backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border,borderRadius:radius.md,padding:spacing.lg,gap:spacing.md}, heading:{...typography.subheading,color:colors.text}, metrics:{flexDirection:'row',gap:spacing.sm}, metric:{flex:1,backgroundColor:colors.primarySoft,borderRadius:radius.sm,padding:spacing.sm}, metricValue:{...typography.subheading,color:colors.primary}, metricLabel:{...typography.caption,color:colors.textSecondary}, body:{...typography.caption,color:colors.textSecondary}, item:{borderTopWidth:1,borderTopColor:colors.divider,paddingTop:spacing.md,gap:spacing.sm}, row:{flexDirection:'row',alignItems:'center',gap:spacing.sm}, copy:{flex:1}, name:{...typography.bodyStrong,color:colors.text}, details:{gap:spacing.sm}, error:{...typography.caption,color:colors.negative} });
