import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Animated, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandMark } from '../components/BrandMark';
import { authColors, authRadius, authShadow, authSpace, authType } from './authTheme';
import type { Experience } from './experience';
import { AmbientOrb, HeroMark, Nudge, Pop, PressableScale, Reveal, RotatingText, StaggerText, useExit } from './motion';

// PROGRAM 3: the unified Chakusa entry screen. One installed app, two ways
// in. Each card is described by what the person wants to do and lists only
// capabilities the app really has; nothing here is fabricated.
//
// The intro is choreographed so each beat has a job (see ./motion):
//   1. warm light blooms and the logo appears large, centre screen - brand;
//   2. the logo lands in the header, CHAKUSA spells out, the headline rises;
//   3. the two choices spring up from below and their feature chips pop in -
//      what each side offers;
//   4. each arrow nudges once - "tap here";
//   5. on a choice, the picked card lifts while the rest clears - the next
//      screen is a direct result of that tap.
// Reduce-motion snaps every beat to its final state.

const TAGLINES = [
  'Book trusted local services.',
  'Turn missed calls into customers.',
  'Earn rewards on every visit.',
  'Send invoices and get paid faster.',
] as const;

const BEAT = { wordmark: 700, title: 860, tagline: 1180, cards: 1260, chips: 1560, nudge: 2350, footer: 1800 } as const;

export function ExperienceSelectScreen({ onChoose }: { onChoose: (experience: Experience) => void }) {
  const exit = useExit();
  const [chosen, setChosen] = useState<Experience | null>(null);
  const choose = (experience: Experience) => {
    setChosen(experience);
    exit.run(() => onChoose(experience));
  };
  const clearing = {
    opacity: exit.progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
    transform: [{ translateY: exit.progress.interpolate({ inputRange: [0, 1], outputRange: [0, 28] }) }],
  };
  const heroClearing = {
    opacity: clearing.opacity,
    transform: [{ translateY: exit.progress.interpolate({ inputRange: [0, 1], outputRange: [0, -24] }) }],
  };
  const lifted = {
    transform: [{ scale: exit.progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }) }],
    opacity: exit.progress.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0.6] }),
  };
  const cardMotion = (experience: Experience) => (chosen === null ? undefined : chosen === experience ? lifted : clearing);

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
      <AmbientOrb bloom size={400} color={authColors.coralSoft} style={styles.orb} duration={8000} />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} bounces={false}>
        <Animated.View style={[styles.hero, heroClearing]}>
          <View style={styles.markStage}>
            <HeroMark landFrom={{ y: 190, scale: 1.8 }}>
              <View style={styles.markWrap}><BrandMark size={52} /></View>
            </HeroMark>
          </View>
          <StaggerText text="CHAKUSA" by="letter" delay={BEAT.wordmark} step={45} distance={8} style={styles.wordmark} />
          <StaggerText testID="welcome-title" role="header" text="Welcome to Chakusa" delay={BEAT.title} step={90} distance={18} style={styles.title} />
          <Reveal delay={BEAT.tagline} style={styles.taglineSlot}>
            <RotatingText phrases={TAGLINES} interval={3400} render={(phrase) => <Text style={styles.subtitle}>{phrase}</Text>} />
          </Reveal>
        </Animated.View>

        <View style={styles.options}>
          <Animated.View style={cardMotion('customer')}>
            <Reveal spring delay={BEAT.cards} distance={70} fromScale={0.94}>
              <ExperienceCard
                testID="choose-customer"
                icon="calendar-clear-outline"
                tag="For customers"
                title="Find & book services"
                description="Book local businesses, track visits and earn loyalty rewards."
                features={['Bookings', 'Rewards', 'Invoices']}
                chipsDelay={BEAT.chips}
                nudgeDelay={BEAT.nudge}
                disabled={chosen !== null}
                onPress={() => choose('customer')}
              />
            </Reveal>
          </Animated.View>
          <Animated.View style={cardMotion('business')}>
            <Reveal spring delay={BEAT.cards + 140} distance={70} fromScale={0.94}>
              <ExperienceCard
                testID="choose-business"
                featured
                icon="briefcase-outline"
                tag="For businesses"
                title="Grow my business"
                description="Recover missed calls, fill your calendar and get paid faster."
                features={['Calendar', 'Follow-ups', 'Reviews']}
                chipsDelay={BEAT.chips + 140}
                nudgeDelay={BEAT.nudge + 180}
                disabled={chosen !== null}
                onPress={() => choose('business')}
              />
            </Reveal>
          </Animated.View>
        </View>

        <Animated.View style={clearing}>
          <Reveal delay={BEAT.footer}>
            <View style={styles.footer}>
              <Ionicons name="lock-closed" size={12} color={authColors.inkFaint} />
              <Text style={styles.footnote}>Encrypted. Switch any time from your account.</Text>
            </View>
          </Reveal>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

function ExperienceCard({
  testID, icon, tag, title, description, features, featured = false, chipsDelay, nudgeDelay, disabled, onPress,
}: {
  testID: string;
  icon: keyof typeof Ionicons.glyphMap;
  tag: string;
  title: string;
  description: string;
  features: readonly string[];
  featured?: boolean;
  chipsDelay: number;
  nudgeDelay: number;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${description}`}
      disabled={disabled}
      onPress={onPress}
      scaleTo={0.96}
      style={[styles.card, featured && styles.cardFeatured]}
    >
      <View style={styles.cardTop}>
        <Pop delay={chipsDelay - 180}>
          <View style={[styles.cardIcon, featured && styles.cardIconFeatured]}>
            <Ionicons name={icon} size={22} color={featured ? authColors.onCoral : authColors.coral} />
          </View>
        </Pop>
        <Text style={[styles.cardTag, featured && styles.cardTagFeatured]}>{tag.toUpperCase()}</Text>
      </View>
      <Text style={[styles.cardTitle, featured && styles.textOnDark]}>{title}</Text>
      <Text style={[styles.cardDescription, featured && styles.descriptionOnDark]}>{description}</Text>
      <View style={styles.cardBottom}>
        <View style={styles.pills}>
          {features.map((feature, index) => (
            <Pop key={feature} delay={chipsDelay + index * 90}>
              <View style={[styles.pill, featured && styles.pillFeatured]}>
                <Text style={[styles.pillText, featured && styles.pillTextFeatured]}>{feature}</Text>
              </View>
            </Pop>
          ))}
        </View>
        <Nudge delay={nudgeDelay}>
          <View style={styles.arrow}>
            <Ionicons name="arrow-forward" size={18} color={authColors.onCoral} />
          </View>
        </Nudge>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: authColors.bg, overflow: 'hidden' },
  orb: { top: -200, alignSelf: 'center' },
  body: { flexGrow: 1, width: '100%', maxWidth: 480, alignSelf: 'center', paddingHorizontal: authSpace.lg, paddingTop: authSpace.xl, paddingBottom: authSpace.md, justifyContent: 'space-between', gap: authSpace.lg },

  hero: { alignItems: 'center', gap: authSpace.xs, zIndex: 1 },
  markStage: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center' },
  markWrap: { padding: authSpace.sm, borderRadius: authRadius.xl, backgroundColor: authColors.surface, ...authShadow.card },
  wordmark: { ...authType.micro, fontSize: 12, letterSpacing: 4, color: authColors.coral },
  title: { ...authType.display, fontSize: 32, lineHeight: 38, textAlign: 'center' },
  taglineSlot: { minHeight: 24 },
  subtitle: { ...authType.bodyLg, textAlign: 'center' },

  options: { gap: authSpace.sm },
  card: { backgroundColor: authColors.surface, borderRadius: authRadius.xl, borderWidth: 1, borderColor: authColors.line, padding: authSpace.lg, gap: authSpace.xs, ...authShadow.card },
  cardFeatured: { backgroundColor: authColors.ink, borderColor: authColors.ink },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardIcon: { width: 46, height: 46, borderRadius: authRadius.md, backgroundColor: authColors.coralSoft, alignItems: 'center', justifyContent: 'center' },
  cardIconFeatured: { backgroundColor: authColors.coral },
  cardTag: { ...authType.micro },
  cardTagFeatured: { color: '#A9B0BC' },
  cardTitle: { ...authType.cardTitle, fontSize: 20, marginTop: authSpace.xs },
  textOnDark: { color: authColors.onCoral },
  cardDescription: { ...authType.body },
  descriptionOnDark: { color: '#C3C8D1' },
  cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: authSpace.xs, gap: authSpace.sm },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: authSpace.xxs, flex: 1 },
  pill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: authRadius.pill, backgroundColor: authColors.bgSunk },
  pillFeatured: { backgroundColor: 'rgba(255,255,255,0.08)' },
  pillText: { ...authType.micro, letterSpacing: 0.2, color: authColors.inkSoft },
  pillTextFeatured: { color: '#DADDE3' },
  arrow: { width: 40, height: 40, borderRadius: authRadius.pill, backgroundColor: authColors.coral, alignItems: 'center', justifyContent: 'center', ...authShadow.cta },

  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: authSpace.xxs },
  footnote: { ...authType.micro, letterSpacing: 0.2 },
});
