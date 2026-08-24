import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SubscriptionStatusDto } from '../apiTypes';
import { colors, radius, spacing, typography } from '../theme';
import { formatMoney } from '../utils/format';

export function ValueProofCard({ value, currency = 'USD', free, onPress }: { value: SubscriptionStatusDto['value']; currency?: string | null; free: boolean; onPress: () => void }) {
  const hasValue = value.recoveredRevenueThisMonth > 0 || value.completedAppointmentsThisMonth > 0 || value.scheduledAppointmentValue > 0 || value.customerMessagesSentThisMonth > 0 || value.reviewsReceivedThisMonth > 0;
  if (!hasValue) return null;
  return <View style={styles.card} accessibilityLabel="Your Chakusa value this month">
    <View style={styles.top}><View><Text style={styles.eyebrow}>YOUR CHAKUSA VALUE</Text><Text style={styles.title}>Real outcomes this month</Text></View><View style={styles.icon}><Ionicons name="trending-up" size={20} color={colors.surface} /></View></View>
    <View style={styles.metrics}><Metric label="Recovered" value={formatMoney(value.recoveredRevenueThisMonth, currency ?? 'USD')} /><Metric label="Jobs completed" value={String(value.completedAppointmentsThisMonth)} /><Metric label="Upcoming value" value={formatMoney(value.scheduledAppointmentValue, currency ?? 'USD')} /></View>
    <Text style={styles.body}>{value.customerMessagesSentThisMonth} customer messages sent · {value.reviewsReceivedThisMonth} reviews received. These figures come from recorded Chakusa activity—not projections.</Text>
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.action, pressed && styles.pressed]}><Text style={styles.actionText}>{free ? 'See what Pro can automate' : 'View business insights'}</Text><Ionicons name="chevron-forward" size={17} color={colors.primary} /></Pressable>
  </View>;
}
function Metric({ label, value }: { label: string; value: string }) { return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>; }
const styles = StyleSheet.create({ card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.success, borderRadius: radius.md, padding: spacing.lg, gap: spacing.md }, top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }, eyebrow: { ...typography.micro, color: colors.success, letterSpacing: 1 }, title: { ...typography.subheading, color: colors.text, marginTop: spacing.xxs }, icon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' }, metrics: { flexDirection: 'row', gap: spacing.sm }, metric: { flex: 1, minWidth: 0 }, metricValue: { ...typography.bodyStrong, color: colors.text }, metricLabel: { ...typography.micro, color: colors.textSecondary, marginTop: 2 }, body: { ...typography.caption, color: colors.textSecondary }, action: { minHeight: 44, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, actionText: { ...typography.bodyStrong, color: colors.primary }, pressed: { opacity: .72 } });
