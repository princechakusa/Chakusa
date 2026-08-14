import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { SubscriptionStatusValue } from '../apiTypes';
import { AppHeader, PrimaryButton, Screen, StatusBadge } from '../components/ui';
import { usePlanExperience } from '../state/PlanExperienceContext';
import { colors, radius, spacing, typography } from '../theme';

const free = ['Manual lead recovery', 'Manual message sending', 'Core customer, review, and reminder tools', 'Free usage limits'];
const proNow = ['Unlimited leads, customers, reviews, and reminders', 'Unlimited custom templates', 'Chakusa-initiated messaging', 'Automation access'];

// Respectful, accurate copy per subscription status — never implies a
// purchase/renewal action exists in the app, since none does.
const statusCopy: Record<SubscriptionStatusValue, { label: string; body: string }> = {
  ACTIVE: { label: 'Active', body: 'Your plan status came from the backend. Free-plan upgrade prompts are suppressed.' },
  TRIALING: { label: 'Trial', body: 'You’re in a Pro trial period. Your plan status came from the backend.' },
  GRACE_PERIOD: { label: 'Payment issue', body: 'There’s a billing issue with your Pro subscription. Pro features remain available for now while this is resolved.' },
  EXPIRED: { label: 'Expired', body: 'Your Pro subscription has expired. Free-plan limits now apply.' },
  CANCELED: { label: 'Canceled', body: 'Your Pro subscription was canceled. Free-plan limits now apply.' },
};

export function ProScreen() {
  const { plan, status, features } = usePlanExperience();
  const isPro = plan === 'PRO';
  const copy = status ? statusCopy[status] : null;
  // Pro access should track the entitled feature flags, not the plan label
  // alone — an EXPIRED/CANCELED Pro business shows Free-limit messaging
  // even though `plan` may still read "PRO" until it's formally downgraded.
  const hasProAccess = Boolean(features?.automation || features?.outboundMessaging || features?.unlimitedTemplates);

  return <Screen><AppHeader eyebrow="CHAKUSA PRO" title="Let Chakusa do the follow-up for you." subtitle="A clear look at Free and Pro. Purchases are not enabled in the app yet." right={isPro && copy ? <StatusBadge label={copy.label} /> : undefined} />
    <View style={styles.price}><Text style={styles.priceValue}>$29</Text><Text style={styles.pricePeriod}>/month</Text><Text style={styles.priceNote}>Current monthly product direction</Text></View>
    {isPro && copy ? <View style={[styles.active, !hasProAccess && styles.attention]}><Ionicons name={hasProAccess ? 'checkmark-circle' : 'alert-circle'} size={24} color={hasProAccess ? colors.success : colors.attention} /><View style={styles.copy}><Text style={styles.cardTitle}>Chakusa Pro — {copy.label}</Text><Text style={styles.body}>{copy.body}</Text></View></View> : null}
    <PlanCard title="Free" subtitle="$0 forever" items={free} />
    <PlanCard title="Pro" subtitle="$29/month" items={proNow} />
    <PrimaryButton fullWidth disabled label={isPro ? 'Your Pro plan is active' : 'Pro coming soon'} onPress={() => undefined} />
    <Text style={styles.footnote}>No purchase, trial, or subscription change happens on this screen.</Text>
  </Screen>;
}
function PlanCard({ title, subtitle, items }: { title: string; subtitle: string; items: string[] }) { return <View style={styles.card}><View style={styles.cardHeader}><Text style={styles.cardTitle}>{title}</Text><Text style={styles.cardPrice}>{subtitle}</Text></View>{items.map(item => <Feature key={item} label={item} icon="checkmark-circle-outline" />)}</View>; }
function Feature({ label, icon }: { label: string; icon: keyof typeof Ionicons.glyphMap }) { return <View style={styles.feature}><Ionicons name={icon} size={20} color={colors.primary} /><Text style={styles.featureText}>{label}</Text></View>; }
const styles = StyleSheet.create({ price: { alignItems: 'center', paddingVertical: spacing.lg }, priceValue: { fontSize: 52, lineHeight: 58, fontWeight: '700', color: colors.text }, pricePeriod: { ...typography.heading, color: colors.textSecondary }, priceNote: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs, textAlign: 'center' }, active: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.success, borderRadius: radius.md }, attention: { borderColor: colors.attention }, copy: { flex: 1 }, card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm }, cardHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }, cardTitle: { ...typography.subheading, color: colors.text, flexShrink: 1 }, cardPrice: { ...typography.bodyStrong, color: colors.primary }, feature: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }, featureText: { ...typography.body, color: colors.text, flex: 1 }, body: { ...typography.body, color: colors.textSecondary }, footnote: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' } });
