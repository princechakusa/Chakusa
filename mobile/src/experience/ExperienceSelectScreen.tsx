import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandMark } from '../components/BrandMark';
import { authColors, authRadius, authShadow, authSpace, authType } from './authTheme';
import type { Experience } from './experience';

// PROGRAM 3: the unified Chakusa entry screen. One installed app, two ways
// in. Each card is described by what the person wants to do; nothing here
// is decorative-only or fabricated.

export function ExperienceSelectScreen({ onChoose }: { onChoose: (experience: Experience) => void }) {
  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
      <View pointerEvents="none" style={styles.glow} />
      <View style={styles.body}>
        <View style={styles.hero}>
          <View style={styles.markWrap}><BrandMark size={44} /></View>
          <Text style={styles.title}>Welcome to Chakusa</Text>
          <Text style={styles.subtitle}>Choose how you want to start.</Text>
        </View>

        <View style={styles.options}>
          <ExperienceCard
            icon="calendar-clear-outline"
            tag="For customers"
            title="Find & book services"
            description="Book local businesses and earn loyalty rewards."
            onPress={() => onChoose('customer')}
          />
          <ExperienceCard
            icon="briefcase-outline"
            tag="For businesses"
            title="Grow my business"
            description="Automate bookings and get paid faster."
            onPress={() => onChoose('business')}
          />
        </View>

        <View style={styles.footer}>
          <Ionicons name="lock-closed" size={12} color={authColors.inkFaint} />
          <Text style={styles.footnote}>Encrypted. Switch any time from your account.</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

function ExperienceCard({
  icon, tag, title, description, onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tag: string;
  title: string;
  description: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${description}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.cardTop}>
        <View style={styles.cardIcon}><Ionicons name={icon} size={22} color={authColors.coral} /></View>
        <Text style={styles.cardTag}>{tag.toUpperCase()}</Text>
      </View>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardDescription}>{description}</Text>
      <View style={styles.cardCta}>
        <Text style={styles.cardCtaText}>Continue</Text>
        <Ionicons name="arrow-forward" size={16} color={authColors.coral} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: authColors.bg },
  glow: { position: 'absolute', top: -160, alignSelf: 'center', width: 360, height: 360, borderRadius: 360, backgroundColor: authColors.coralSoft },
  body: { flex: 1, paddingHorizontal: authSpace.lg, paddingTop: authSpace.xl, paddingBottom: authSpace.md, justifyContent: 'space-between' },

  hero: { alignItems: 'center', gap: authSpace.xs },
  markWrap: { padding: authSpace.sm, borderRadius: authRadius.lg, backgroundColor: authColors.surface, ...authShadow.card },
  title: { ...authType.display, textAlign: 'center', marginTop: authSpace.sm },
  subtitle: { ...authType.bodyLg, textAlign: 'center' },

  options: { gap: authSpace.sm },
  card: { backgroundColor: authColors.surface, borderRadius: authRadius.xl, borderWidth: 1, borderColor: authColors.line, paddingHorizontal: authSpace.lg, paddingVertical: authSpace.lg, gap: authSpace.xs, ...authShadow.card },
  cardPressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardIcon: { width: 44, height: 44, borderRadius: authRadius.md, backgroundColor: authColors.coralSoft, alignItems: 'center', justifyContent: 'center' },
  cardTag: { ...authType.micro },
  cardTitle: { ...authType.cardTitle, marginTop: authSpace.sm },
  cardDescription: { ...authType.body },
  cardCta: { flexDirection: 'row', alignItems: 'center', gap: authSpace.xxs, marginTop: authSpace.sm, paddingTop: authSpace.sm, borderTopWidth: 1, borderTopColor: authColors.lineSoft },
  cardCtaText: { ...authType.label, color: authColors.coral },

  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: authSpace.xxs },
  footnote: { ...authType.micro, letterSpacing: 0.2 },
});
