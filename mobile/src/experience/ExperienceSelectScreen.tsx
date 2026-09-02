import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, shadows, spacing, typography } from '../theme';
import type { Experience } from './experience';

// PROGRAM 2 LOOP 9: the unified Chakusa entry screen. One installed app,
// two experiences. This is a consumer product screen, not a role picker —
// each choice is described by what the person wants to do, and the two
// options are distinguished by text (not colour/icon alone).

export function ExperienceSelectScreen({ onChoose }: { onChoose: (experience: Experience) => void }) {
  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
      <View style={styles.body}>
        <View style={styles.hero}>
          <View style={styles.mark}><Ionicons name="sparkles" size={26} color={colors.primary} /></View>
          <Text style={styles.title}>Welcome to Chakusa</Text>
          <Text style={styles.subtitle}>What would you like to do?</Text>
        </View>

        <View style={styles.options}>
          <ExperienceCard
            icon="calendar-outline"
            title="Find & book services"
            description="Discover businesses, book services and earn rewards."
            onPress={() => onChoose('customer')}
          />
          <ExperienceCard
            icon="briefcase-outline"
            title="Grow my business"
            description="Manage customers, bookings, reviews and repeat business."
            onPress={() => onChoose('business')}
          />
        </View>

        <Text style={styles.footnote}>You can switch between the two any time from your account.</Text>
      </View>
    </SafeAreaView>
  );
}

function ExperienceCard({
  icon, title, description, onPress,
}: { icon: keyof typeof Ionicons.glyphMap; title: string; description: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${description}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.cardIcon}><Ionicons name={icon} size={22} color={colors.primary} /></View>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardDescription}>{description}</Text>
      <View style={styles.cardCta}>
        <Text style={styles.cardCtaText}>Continue</Text>
        <Ionicons name="arrow-forward" size={16} color={colors.primary} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.xxxl, gap: spacing.xl },
  hero: { alignItems: 'center', gap: spacing.xs },
  mark: { width: 56, height: 56, borderRadius: radius.xl, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs },
  title: { ...typography.title, color: colors.text, textAlign: 'center' },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  options: { gap: spacing.md },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.xs, ...shadows.card },
  pressed: { opacity: 0.8 },
  cardIcon: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs },
  cardTitle: { ...typography.subheading, color: colors.text },
  cardDescription: { ...typography.body, color: colors.textSecondary },
  cardCta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, marginTop: spacing.xs },
  cardCtaText: { ...typography.bodyStrong, color: colors.primary },
  footnote: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' },
});
