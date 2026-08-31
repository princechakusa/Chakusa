import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { messagingApi } from '../services/endpoints';
import { ErrorState, LoadingState, SecondaryButton, StatusBadge } from './ui';
import { colors, radius, spacing, typography } from '../theme';

type Conversation = { id: string; status: string; priority: string; automationMode: string; assignedMemberId:string|null; updatedAt: string; messages: Array<{ id:string;body: string; direction: string }>;slas:Array<{type:string;status:string;dueAt:string}> };
type Failure = { id: string; status: string; lastError: string | null; message: { body: string } };
type Analytics = { conversations: Array<{ status: string; _count: number }>; delivery: Array<{ status: string; channel: string; _count: number }>; verifiedCost: string };

export function MessagingOperationsPanel() {
  const [data, setData] = useState<{ conversations: Conversation[]; failures: Failure[]; analytics: Analytics } | null>(null);
  const [error, setError] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [search,setSearch]=useState(''); const [status,setStatus]=useState('ALL'); const [selected,setSelected]=useState<string|null>(null);
  const load = useCallback(async () => {
    const results = await Promise.allSettled([messagingApi.conversations(), messagingApi.failures(), messagingApi.analytics()]);
    if (results.every(result => result.status === 'rejected')) { setError(true); return; }
    setData({ conversations: results[0].status === 'fulfilled' ? results[0].value : [], failures: results[1].status === 'fulfilled' ? results[1].value : [], analytics: results[2].status === 'fulfilled' ? results[2].value : { conversations: [], delivery: [], verifiedCost: '0' } });
    setError(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (!data && !error) return <LoadingState label="Loading messaging operations…" />;
  if (!data) return <ErrorState message="Couldn’t load messaging operations." onRetry={() => void load()} />;
  const open = data.analytics.conversations.find(item => item.status === 'OPEN')?._count ?? 0;
  const delivered = data.analytics.delivery.find(item => item.status === 'DELIVERED')?._count ?? 0;
  const visible=data.conversations.filter(item=>(status==='ALL'||item.status===status)&&(item.messages[0]?.body??'').toLowerCase().includes(search.toLowerCase()));
  return <View style={styles.card} accessibilityLabel="Messaging operations">
    <View style={styles.header}><Text style={styles.heading}>Messaging operations</Text><StatusBadge label={`${open} open`} /></View>
    <Text style={styles.body}>{delivered} delivered · {data.failures.length} need attention · verified cost {data.analytics.verifiedCost}</Text>
    <TextInput accessibilityLabel="Search conversations" placeholder="Search conversations" value={search} onChangeText={setSearch} style={styles.input}/><View style={styles.filters}>{['ALL','OPEN','PENDING','RESOLVED'].map(value=><Pressable key={value} accessibilityRole="button" accessibilityState={{selected:status===value}} onPress={()=>setStatus(value)} style={styles.filter}><Text style={styles.body}>{value}</Text></Pressable>)}</View>
    {visible.slice(0, 10).map(item => <View key={item.id}><Pressable onPress={()=>setSelected(selected===item.id?null:item.id)} accessibilityRole="summary" accessibilityState={{expanded:selected===item.id}} accessibilityLabel={`${item.status} conversation, ${item.messages[0]?.body ?? 'No messages'}`} style={styles.row}><View style={styles.copy}><Text numberOfLines={1} style={styles.label}>{item.messages[0]?.body ?? 'New conversation'}</Text><Text style={styles.body}>{item.automationMode.toLowerCase()} · {item.priority.toLowerCase()} · {item.slas.some(sla=>sla.status==='BREACHED')?'SLA breached':`${item.slas.filter(sla=>sla.status==='ACTIVE').length} active SLA`}</Text></View><StatusBadge label={item.status} /></Pressable>{selected===item.id?<View style={styles.actions}><SecondaryButton compact label="Assign to me" onPress={()=>void messagingApi.updateConversation(item.id,{automationMode:'HUMAN'}).then(load)}/><SecondaryButton compact label={item.status==='RESOLVED'?'Reopen':'Resolve'} onPress={()=>void messagingApi.updateConversation(item.id,{status:item.status==='RESOLVED'?'OPEN':'RESOLVED'}).then(load)}/></View>:null}</View>)}
    {data.failures.slice(0, 3).map(item => <View key={item.id} style={styles.row}><View style={styles.copy}><Text numberOfLines={1} style={styles.label}>{item.message.body}</Text><Text numberOfLines={1} style={styles.error}>{item.lastError ?? item.status}</Text></View><SecondaryButton compact disabled={retrying === item.id} label={retrying === item.id ? 'Queuing…' : 'Retry'} onPress={() => { setRetrying(item.id); void messagingApi.retry(item.id).then(load).finally(() => setRetrying(null)); }} /></View>)}
    {error ? <Text accessibilityRole="alert" style={styles.error}>Some messaging data could not be refreshed.</Text> : null}
  </View>;
}

const styles = StyleSheet.create({ card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.lg, gap: spacing.md }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md }, heading: { ...typography.subheading, color: colors.text }, body: { ...typography.caption, color: colors.textSecondary }, row: { minHeight: 52, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, copy: { flex: 1, gap: spacing.xs }, label: { ...typography.bodyStrong, color: colors.text }, error: { ...typography.caption, color: colors.negative },input:{minHeight:44,borderWidth:1,borderColor:colors.border,borderRadius:radius.md,paddingHorizontal:spacing.md,color:colors.text},filters:{flexDirection:'row',flexWrap:'wrap',gap:spacing.xs},filter:{minHeight:40,paddingHorizontal:spacing.sm,justifyContent:'center',borderWidth:1,borderColor:colors.border,borderRadius:radius.round},actions:{flexDirection:'row',flexWrap:'wrap',gap:spacing.xs,paddingVertical:spacing.sm} });
