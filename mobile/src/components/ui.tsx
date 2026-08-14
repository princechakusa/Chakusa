import { Ionicons } from '@expo/vector-icons';
import { PropsWithChildren, ReactNode } from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleProp, StyleSheet, Text, TextInput,
  View, ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CustomerDto, LeadDto, ReminderDto, ReviewRequestDto } from '../apiTypes';
import { TimelineItem } from '../types';
import { colors, radius, shadows, spacing, typography } from '../theme';
import { formatDate, formatDateTime, formatDuration, formatMoney, titleCase } from '../utils/format';

type IconName = keyof typeof Ionicons.glyphMap;

export function Screen({ children, scroll = true, style }: PropsWithChildren<{ scroll?: boolean; style?: StyleProp<ViewStyle> }>) {
  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      {scroll ? <ScrollView style={styles.flex} contentContainerStyle={[styles.screen, style]} showsVerticalScrollIndicator={false}>{children}</ScrollView>
        : <View style={[styles.screen, styles.flex, style]}>{children}</View>}
    </SafeAreaView>
  );
}

export function AppHeader({ title, subtitle, eyebrow, right }: { title: string; subtitle?: string; eyebrow?: string; right?: ReactNode }) {
  return <View style={styles.header}><View style={styles.headerCopy}>{eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}<Text style={styles.title}>{title}</Text>{subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}</View>{right}</View>;
}

export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>{title}</Text>{action ? <Pressable hitSlop={8} onPress={onAction}><Text style={styles.sectionAction}>{action}</Text></Pressable> : null}</View>;
}

interface ButtonProps { label: string; onPress: () => void; icon?: IconName; disabled?: boolean; compact?: boolean; fullWidth?: boolean; }
export function PrimaryButton({ label, onPress, icon, disabled, compact, fullWidth }: ButtonProps) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, styles.primaryButton, compact && styles.buttonCompact, fullWidth && styles.fullWidth, pressed && styles.primaryPressed, disabled && styles.disabled]}>{icon ? <Ionicons name={icon} size={18} color={colors.surface} /> : null}<Text style={styles.primaryButtonText}>{label}</Text></Pressable>;
}
export function SecondaryButton({ label, onPress, icon, disabled, compact, fullWidth }: ButtonProps) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, styles.secondaryButton, compact && styles.buttonCompact, fullWidth && styles.fullWidth, pressed && styles.secondaryPressed, disabled && styles.disabled]}>{icon ? <Ionicons name={icon} size={18} color={colors.text} /> : null}<Text style={styles.secondaryButtonText}>{label}</Text></Pressable>;
}
export function IconButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.iconButton, pressed && styles.secondaryPressed]}><Ionicons name={icon} size={22} color={colors.text} /></Pressable>;
}

export function StatusBadge({ label }: { label: string }) {
  const tone = ['Won', 'Reviewed', 'Completed', 'Active', 'Booked'].includes(label) ? 'success' : ['Lost', 'Feedback', 'Dismissed'].includes(label) ? 'negative' : ['New', 'Pending', 'Due', 'Due back', 'Ready today'].includes(label) ? 'attention' : 'neutral';
  return <View style={[styles.badge, tone === 'success' && styles.badgeSuccess, tone === 'negative' && styles.badgeNegative, tone === 'attention' && styles.badgeAttention]}><Text style={[styles.badgeText, tone === 'negative' && styles.badgeNegativeText]}>{label}</Text></View>;
}

export function MetricCard({ label, value, detail, tone = 'default' }: { label: string; value: string; detail?: string; tone?: 'default' | 'primary' | 'success' }) {
  return <View style={[styles.metric, tone === 'primary' && styles.metricPrimary, tone === 'success' && styles.metricSuccess]}><Text style={[styles.metricLabel, tone !== 'default' && styles.metricOnColor]}>{label}</Text><Text style={[styles.metricValue, tone !== 'default' && styles.metricOnColor]}>{value}</Text>{detail ? <Text style={[styles.metricDetail, tone !== 'default' && styles.metricDetailOnColor]}>{detail}</Text> : null}</View>;
}

export function AttentionCard({ name, meta, detail, value, action, onPress, icon = 'alert-circle-outline' }: { name: string; meta: string; detail?: string; value?: string; action: string; onPress: () => void; icon?: IconName }) {
  return <View style={styles.itemCard}><View style={styles.itemTop}><View style={styles.attentionIcon}><Ionicons name={icon} size={20} color={colors.primary} /></View><View style={styles.itemCopy}><Text style={styles.itemName}>{name}</Text><Text style={styles.itemMeta}>{meta}</Text>{detail ? <Text style={styles.itemDetail}>{detail}</Text> : null}</View>{value ? <Text style={styles.itemValue}>{value}</Text> : null}</View><PrimaryButton compact label={action} onPress={onPress} /></View>;
}

export function LeadCard({ lead, onPress }: { lead: LeadDto; onPress: () => void }) {
  const name = lead.customer?.name ?? 'Unassigned lead'; const action = lead.status === 'new' ? 'Follow up' : 'View details';
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.itemCard, pressed && styles.cardPressed]}><View style={styles.itemTop}><Avatar name={name} /><View style={styles.itemCopy}><Text style={styles.itemName}>{name}</Text><Text style={styles.itemMeta}>Missed {formatDateTime(lead.missedCallTime)}</Text><Text style={styles.itemDetail}>{lead.serviceRequested ?? 'Service not specified'}</Text></View><View style={styles.alignEnd}><Text style={styles.itemValue}>{formatMoney(lead.estimatedValue)}</Text><StatusBadge label={titleCase(lead.status)} /></View></View><View style={styles.cardFooter}><Text style={styles.responseText}>{lead.responseTimeSeconds == null ? 'Needs a response' : `Response: ${formatDuration(lead.responseTimeSeconds)}`}</Text><Text style={styles.cardAction}>{action} <Ionicons name="chevron-forward" size={14} /></Text></View></Pressable>;
}

export function CustomerRow({ customer, onPress }: { customer: CustomerDto; onPress: () => void }) {
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}><Avatar name={customer.name} /><View style={styles.itemCopy}><Text style={styles.itemName}>{customer.name}</Text><Text style={styles.itemMeta}>{customer.phone ?? customer.email ?? 'No contact details'}</Text></View><Ionicons name="chevron-forward" size={18} color={colors.tabInactive} /></Pressable>;
}

export function ReviewCard({ review, onPress }: { review: ReviewRequestDto; onPress: () => void }) {
  const name = review.customer?.name ?? 'Unassigned customer'; return <Pressable onPress={onPress} style={({ pressed }) => [styles.itemCard, pressed && styles.cardPressed]}><View style={styles.itemTop}><Avatar name={name} /><View style={styles.itemCopy}><Text style={styles.itemName}>{name}</Text><Text style={styles.itemMeta}>{review.serviceName ?? 'Service not specified'}</Text><Text style={styles.itemDetail}>{formatDate(review.createdAt)}</Text></View><StatusBadge label={titleCase(review.status)} /></View><View style={styles.cardFooter}><Text style={styles.responseText}>{review.message ? 'Message prepared' : 'Message not prepared'}</Text><Text style={styles.cardAction}>{review.status === 'pending' ? 'Request review' : 'View'} <Ionicons name="chevron-forward" size={14} /></Text></View></Pressable>;
}

export function ReminderCard({ reminder, onPress }: { reminder: ReminderDto; onPress: () => void }) {
  const name = reminder.customer?.name ?? 'Unassigned customer'; return <View style={styles.itemCard}><View style={styles.itemTop}><Avatar name={name} /><View style={styles.itemCopy}><Text style={styles.itemName}>{name}</Text><Text style={styles.itemMeta}>{reminder.serviceName ?? 'Service not specified'} · Last visit {formatDate(reminder.lastVisitDate)}</Text><Text style={styles.itemDetail}>Due {formatDate(reminder.dueDate)}</Text></View><StatusBadge label={titleCase(reminder.status)} /></View><SecondaryButton compact icon="chatbubble-outline" label="Message options" onPress={onPress} /></View>;
}

export function SearchBar({ value, onChangeText, placeholder = 'Search' }: { value: string; onChangeText: (value: string) => void; placeholder?: string }) {
  return <View style={styles.search}><Ionicons name="search" size={19} color={colors.textSecondary} /><TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.textSecondary} style={styles.searchInput} clearButtonMode="while-editing" /></View>;
}

export function FilterTabs<T extends string>({ options, value, onChange }: { options: readonly T[]; value: T; onChange: (value: T) => void }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>{options.map(option => <Pressable key={option} onPress={() => onChange(option)} style={[styles.filter, value === option && styles.filterActive]}><Text style={[styles.filterText, value === option && styles.filterTextActive]}>{titleCase(option)}</Text></Pressable>)}</ScrollView>;
}

export function Timeline({ items }: { items: TimelineItem[] }) {
  return <View>{items.map((item, index) => <View key={item.id} style={styles.timelineRow}><View style={styles.timelineRail}><View style={[styles.timelineDot, item.tone === 'success' && styles.dotSuccess, item.tone === 'attention' && styles.dotAttention]} />{index < items.length - 1 ? <View style={styles.timelineLine} /> : null}</View><View style={styles.timelineContent}><Text style={styles.timelineDate}>{item.date}</Text><View style={styles.timelineTitleRow}><Text style={styles.timelineTitle}>{item.title}</Text>{item.value ? <Text style={styles.timelineValue}>{item.value}</Text> : null}</View>{item.detail ? <Text style={styles.itemMeta}>{item.detail}</Text> : null}</View></View>)}</View>;
}

export function ActionQueue({ children }: PropsWithChildren) { return <View style={styles.queue}>{children}</View>; }
export function EmptyState({ title, message, icon = 'checkmark-circle-outline' }: { title: string; message: string; icon?: IconName }) { return <StateContainer><Ionicons name={icon} size={34} color={colors.success} /><Text style={styles.stateTitle}>{title}</Text><Text style={styles.stateMessage}>{message}</Text></StateContainer>; }
export function LoadingState({ label = 'Loading your workspace…' }: { label?: string }) { return <StateContainer><ActivityIndicator color={colors.primary} /><Text style={styles.stateMessage}>{label}</Text></StateContainer>; }
export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) { return <StateContainer><Ionicons name="alert-circle-outline" size={34} color={colors.negative} /><Text style={styles.stateTitle}>Couldn’t load this</Text><Text style={styles.stateMessage}>{message}</Text><SecondaryButton label="Try again" onPress={onRetry} /></StateContainer>; }
function StateContainer({ children }: PropsWithChildren) { return <View style={styles.state}>{children}</View>; }

export function Avatar({ name }: { name: string }) { const initials = name.split(' ').map(part => part[0]).join('').slice(0, 2); return <View style={styles.avatar}><Text style={styles.avatarText}>{initials}</Text></View>; }
export function InfoRow({ label, value, icon }: { label: string; value: string; icon?: IconName }) { return <View style={styles.infoRow}>{icon ? <Ionicons name={icon} size={20} color={colors.textSecondary} /> : null}<Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue}>{value}</Text></View>; }
export function Divider() { return <View style={styles.divider} />; }

export function UsageCard({ label, current, limit, periodResetsAt, onViewPro }: { label: string; current: number; limit: number | null; periodResetsAt?: string; onViewPro?: () => void }) {
  // limit === null is PRO/unlimited — never render a progress bar, ratio,
  // or "of N" copy for it, and never treat it as reached/strong/blocked.
  // See PlanExperienceContext: this is the same null-means-unlimited
  // contract the backend returns.
  if (limit === null) {
    return <View style={styles.usageCard}><View style={styles.usageTop}><View style={styles.itemCopy}><Text style={styles.itemName}>{label}</Text><Text style={styles.itemMeta}>{current}{periodResetsAt ? ' this month' : ''} · Unlimited</Text></View></View></View>;
  }
  const ratio = limit > 0 ? current / limit : 0; const informative = ratio >= .75; const strong = ratio >= .9; const reached = current >= limit;
  return <View style={[styles.usageCard, informative && styles.usageCardInfo, strong && styles.usageCardStrong]}><View style={styles.usageTop}><View style={styles.itemCopy}><Text style={styles.itemName}>{label}</Text><Text style={styles.itemMeta}>{current} of {limit} used{periodResetsAt ? ` · Resets ${formatDate(periodResetsAt, { month: 'long', day: 'numeric' })}` : ''}</Text></View>{reached && onViewPro ? <Pressable accessibilityRole="button" accessibilityLabel="View Chakusa Pro" onPress={onViewPro}><Text style={styles.sectionAction}>View Pro</Text></Pressable> : null}</View><View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: limit, now: Math.min(current, limit) }} style={styles.usageTrack}><View style={[styles.usageFill, informative && styles.usageFillInfo, strong && styles.usageFillStrong, { width: `${Math.min(100, ratio * 100)}%` }]} /></View></View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 }, safeArea: { flex: 1, backgroundColor: colors.background }, screen: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: 120, gap: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md }, headerCopy: { flex: 1 }, eyebrow: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.xxs }, title: { ...typography.title, color: colors.text }, subtitle: { ...typography.body, color: colors.textSecondary, marginTop: spacing.xxs },
  sectionHeader: { minHeight: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, sectionTitle: { ...typography.heading, color: colors.text }, sectionAction: { ...typography.bodyStrong, color: colors.primary },
  button: { minHeight: 48, paddingHorizontal: spacing.lg, borderRadius: radius.md, flexDirection: 'row', gap: spacing.xs, alignItems: 'center', justifyContent: 'center' }, buttonCompact: { alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: spacing.md }, fullWidth: { alignSelf: 'stretch' }, primaryButton: { backgroundColor: colors.primary }, primaryPressed: { backgroundColor: colors.primaryPressed }, primaryButtonText: { ...typography.bodyStrong, color: colors.surface }, secondaryButton: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, secondaryPressed: { backgroundColor: colors.background }, secondaryButtonText: { ...typography.bodyStrong, color: colors.text }, disabled: { opacity: 0.45 }, iconButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  badge: { borderRadius: radius.round, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }, badgeText: { ...typography.micro, color: colors.text }, badgeSuccess: { borderColor: colors.success }, badgeNegative: { borderColor: colors.negative }, badgeNegativeText: { color: colors.negative }, badgeAttention: { borderColor: colors.attention },
  metric: { minWidth: 128, flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border }, metricPrimary: { backgroundColor: colors.primary, borderColor: colors.primary }, metricSuccess: { backgroundColor: colors.success, borderColor: colors.success }, metricLabel: { ...typography.caption, color: colors.textSecondary }, metricValue: { ...typography.heading, color: colors.text, marginTop: spacing.xs }, metricDetail: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xxs }, metricOnColor: { color: colors.surface }, metricDetailOnColor: { color: 'rgba(255,255,255,0.85)' },
  itemCard: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, gap: spacing.md, ...shadows.card }, itemTop: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' }, itemCopy: { flex: 1, minWidth: 0 }, itemName: { ...typography.bodyStrong, color: colors.text }, itemMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 }, itemDetail: { ...typography.caption, color: colors.text, marginTop: spacing.xxs }, itemValue: { ...typography.bodyStrong, color: colors.text }, alignEnd: { alignItems: 'flex-end', gap: spacing.xs }, attentionIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }, cardPressed: { opacity: 0.78 }, cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: spacing.sm, gap: spacing.sm }, responseText: { ...typography.caption, color: colors.textSecondary }, cardAction: { ...typography.caption, color: colors.primary },
  row: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider }, rowPressed: { backgroundColor: colors.background }, avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }, avatarText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  search: { height: 48, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, gap: spacing.xs }, searchInput: { flex: 1, ...typography.body, color: colors.text, paddingVertical: 0 }, filters: { gap: spacing.xs, paddingRight: spacing.lg }, filter: { height: 38, paddingHorizontal: spacing.md, borderRadius: radius.round, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', backgroundColor: colors.surface }, filterActive: { backgroundColor: colors.text, borderColor: colors.text }, filterText: { ...typography.caption, color: colors.textSecondary }, filterTextActive: { color: colors.surface },
  timelineRow: { flexDirection: 'row', minHeight: 82 }, timelineRail: { width: 24, alignItems: 'center' }, timelineDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.tabInactive, marginTop: 5 }, dotSuccess: { backgroundColor: colors.success }, dotAttention: { backgroundColor: colors.attention }, timelineLine: { width: 2, flex: 1, backgroundColor: colors.divider, marginVertical: spacing.xxs }, timelineContent: { flex: 1, paddingLeft: spacing.sm, paddingBottom: spacing.lg }, timelineDate: { ...typography.micro, color: colors.textSecondary, marginBottom: spacing.xxs }, timelineTitleRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }, timelineTitle: { ...typography.bodyStrong, color: colors.text, flex: 1 }, timelineValue: { ...typography.bodyStrong, color: colors.text },
  queue: { gap: spacing.sm }, state: { minHeight: 240, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl }, stateTitle: { ...typography.subheading, color: colors.text, textAlign: 'center' }, stateMessage: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  infoRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, infoLabel: { ...typography.body, color: colors.textSecondary, flex: 1 }, infoValue: { ...typography.bodyStrong, color: colors.text, textAlign: 'right', maxWidth: '58%' }, divider: { height: 1, backgroundColor: colors.divider },
  usageCard: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, gap: spacing.sm }, usageCardInfo: { borderColor: colors.success }, usageCardStrong: { borderColor: colors.attention }, usageTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, usageTrack: { height: 6, borderRadius: radius.round, overflow: 'hidden', backgroundColor: colors.divider }, usageFill: { height: '100%', borderRadius: radius.round, backgroundColor: colors.tabInactive }, usageFillInfo: { backgroundColor: colors.success }, usageFillStrong: { backgroundColor: colors.attention },
});
