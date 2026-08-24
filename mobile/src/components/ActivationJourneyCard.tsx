import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ActivationJourney } from '../domain/activationJourney';
import { colors, radius, spacing, typography } from '../theme';
import { StatusBadge } from './ui';

export function ActivationJourneyCard({ journey, onContinue }: { journey: ActivationJourney; onContinue: () => void }) {
  if (!journey.next) return null;
  return <View style={styles.card} accessibilityLabel={`First value journey, ${journey.complete} of ${journey.total} complete`}>
    <View style={styles.header}><View style={styles.headerCopy}><Text style={styles.eyebrow}>YOUR FIRST CHAKUSA WIN</Text><Text style={styles.title}>See the recovery workflow work</Text></View><StatusBadge label={`${journey.complete}/${journey.total}`} /></View>
    <View style={styles.steps}>{journey.steps.map(step => <View key={step.key} style={styles.step}><Ionicons name={step.complete ? 'checkmark-circle' : 'ellipse-outline'} size={19} color={step.complete ? colors.success : colors.tabInactive} /><Text style={[styles.stepText, step.complete && styles.complete]}>{step.label}</Text></View>)}</View>
    <Pressable accessibilityRole="button" accessibilityLabel={journey.next.action} onPress={onContinue} style={({ pressed }) => [styles.action, pressed && styles.pressed]}><Text style={styles.actionText}>{journey.next.action}</Text><Ionicons name="arrow-forward" size={18} color={colors.surface} /></Pressable>
    <Text style={styles.hint}>Complete this journey with real business activity. Chakusa will then show the revenue, customers, and reputation it helped protect.</Text>
  </View>;
}

const styles = StyleSheet.create({ card: { backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, padding: spacing.lg, gap: spacing.md }, header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }, headerCopy: { flex: 1 }, eyebrow: { ...typography.micro, color: colors.primary, letterSpacing: 1 }, title: { ...typography.subheading, color: colors.text, marginTop: spacing.xxs }, steps: { gap: spacing.xs }, step: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs }, stepText: { ...typography.caption, color: colors.text }, complete: { color: colors.textSecondary, textDecorationLine: 'line-through' }, action: { minHeight: 48, borderRadius: radius.md, backgroundColor: colors.primary, paddingHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs }, actionText: { ...typography.bodyStrong, color: colors.surface }, pressed: { opacity: 0.72 }, hint: { ...typography.caption, color: colors.textSecondary } });
