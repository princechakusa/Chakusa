import { Ionicons } from '../components/icons';
import { useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandMark } from '../components/BrandMark';
import { authType } from './authTheme';
import type { Experience } from './experience';

export function ExperienceSelectScreen({ onChoose }: { onChoose: (experience: Experience) => void }) {
  const { height, width, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compact = height < 720 || width < 350 || fontScale > 1.15;
  const [chosen, setChosen] = useState<Experience | null>(null);
  const chosenRef = useRef(false);
  const choose = (experience: Experience) => {
    if (chosenRef.current) return;
    chosenRef.current = true;
    setChosen(experience);
    onChoose(experience);
  };
  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
      <ScrollView bounces={false} showsVerticalScrollIndicator={false} contentContainerStyle={[styles.body, { minHeight: height - insets.top - insets.bottom }, compact && styles.bodyCompact]}>
        <View style={styles.header}>
          <View style={styles.brand}><BrandMark size={32} /><Text style={styles.wordmark}>CHAKUSA</Text></View>
          <View style={styles.headerNote}><View style={styles.statusDot} /><Text style={styles.headerNoteText}>Life. Work. Connected.</Text></View>
        </View>
        <View style={[styles.hero, compact && styles.heroCompact]}>
          <Text testID="welcome-title" accessibilityRole="header" style={[styles.title, compact && styles.titleCompact]}>Welcome to{'\n'}<Text style={[styles.serif, compact && styles.serifCompact]}>Chakusa.</Text></Text>
          <Text style={styles.subtitle}>Good services. Growing businesses.{'\n'}A better everyday, together.</Text>
        </View>
        <View style={styles.options}>
          <View style={styles.sectionLabel}><Text style={styles.eyebrow}>MAKE YOURSELF AT HOME</Text><View style={styles.rule} /></View>
          <ExperienceCard testID="choose-customer" icon="calendar-outline" label="FOR YOUR EVERYDAY" title="Discover & book" description="Find local services worth coming back for." cta="Explore as a customer" compact={compact} disabled={chosen !== null} onPress={() => choose('customer')} />
          <ExperienceCard testID="choose-business" icon="briefcase-outline" label="FOR YOUR AMBITION" title="Build & grow" description="Your bookings, customers and next chapter." cta="Continue as a business" featured compact={compact} disabled={chosen !== null} onPress={() => choose('business')} />
        </View>
        <View style={styles.footer}><Ionicons name="swap-horizontal-outline" size={14} color="#777A7C" /><Text style={styles.footnote}>Two ways in. Switch whenever you like.</Text></View>
      </ScrollView>
    </SafeAreaView>
  );
}

function ExperienceCard({ testID, icon, label, title, description, cta, featured = false, compact, disabled, onPress }: {
  testID: string; icon: keyof typeof Ionicons.glyphMap; label: string; title: string; description: string; cta: string;
  featured?: boolean; compact: boolean; disabled: boolean; onPress: () => void;
}) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={cta + '. ' + description} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.card, compact && styles.cardCompact, featured && styles.featured, pressed && styles.pressed]}>
      <View style={styles.cardMain}>
        <View style={styles.cardCopy}>
          <Text style={[styles.cardLabel, featured && styles.labelOnDark]}>{label}</Text>
          <Text style={[styles.cardTitle, featured && styles.onDark]}>{title}</Text>
          <Text style={[styles.description, featured && styles.descriptionOnDark]}>{description}</Text>
        </View>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.art, featured && styles.artDark]}>
          <View style={[styles.artBack, featured && styles.artBackDark]} />
          <View style={[styles.artFace, featured && styles.artFaceDark]}><Ionicons name={icon} size={32} color={featured ? '#D6DCCF' : '#3F5551'} /></View>
        </View>
      </View>
      <View style={[styles.cardBottom, featured && styles.bottomOnDark]}>
        <Text style={[styles.cta, featured && styles.onDark]}>{cta}</Text>
        <View style={[styles.arrow, featured && styles.arrowOnDark]}><Ionicons name="arrow-forward" size={17} color={featured ? '#172B2A' : '#253C38'} /></View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F6F4EF' },
  body: { flexGrow: 1, width: '100%', maxWidth: 500, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 20, paddingBottom: 18, justifyContent: 'space-between', gap: 22 },
  bodyCompact: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 14, gap: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  wordmark: { ...authType.micro, fontSize: 11, letterSpacing: 2, color: '#182B29' },
  headerNote: { alignItems: 'flex-end', gap: 5, flexShrink: 1 },
  headerNoteText: { ...authType.body, fontSize: 9, lineHeight: 13, color: '#717771' },
  statusDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#6F8276' },
  hero: { paddingVertical: 6, gap: 13 },
  heroCompact: { paddingVertical: 0, gap: 10 },
  title: { ...authType.display, fontSize: 36, lineHeight: 44, letterSpacing: -1.4, color: '#182B29' },
  titleCompact: { fontSize: 32, lineHeight: 39 },
  serif: { fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif', fontSize: 49, lineHeight: 57, fontStyle: 'italic', fontWeight: '400', letterSpacing: -1.8, color: '#182B29' },
  serifCompact: { fontSize: 43, lineHeight: 49 },
  subtitle: { ...authType.body, fontSize: 13, lineHeight: 20, color: '#6C746F' },
  options: { gap: 12 },
  sectionLabel: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 2 },
  eyebrow: { ...authType.micro, fontSize: 9, lineHeight: 13, letterSpacing: 1.5, color: '#777E76' },
  rule: { height: 1, backgroundColor: '#DADDD4', flex: 1 },
  card: { backgroundColor: '#FFFDF9', borderWidth: 1, borderColor: '#E2E4DA', borderRadius: 22, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 12, gap: 14 },
  cardCompact: { paddingHorizontal: 17, paddingTop: 15, paddingBottom: 10, gap: 11 },
  featured: { backgroundColor: '#182F2D', borderColor: '#182F2D' },
  pressed: { opacity: 0.86, transform: [{ scale: 0.988 }] },
  cardMain: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardCopy: { flex: 1, gap: 6 },
  cardLabel: { ...authType.micro, fontSize: 8, lineHeight: 11, letterSpacing: 1.5, color: '#6F8178' },
  labelOnDark: { color: '#AFBEB0' },
  cardTitle: { ...authType.cardTitle, fontSize: 23, lineHeight: 29, letterSpacing: -0.8, color: '#243C37' },
  onDark: { color: '#F6F4E9' },
  description: { ...authType.body, fontSize: 11, lineHeight: 17, color: '#788077', maxWidth: 205 },
  descriptionOnDark: { color: '#BBC8C0' },
  art: { width: 66, height: 70, alignItems: 'center', justifyContent: 'center', marginLeft: 2 },
  artDark: { transform: [{ rotate: '4deg' }] },
  artBack: { position: 'absolute', width: 52, height: 58, borderRadius: 12, backgroundColor: '#E1E7D8', transform: [{ rotate: '12deg' }, { translateX: 4 }] },
  artBackDark: { backgroundColor: '#52655C' },
  artFace: { width: 52, height: 58, borderRadius: 12, backgroundColor: '#F1F3E9', borderWidth: 1, borderColor: '#D7DECE', alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-8deg' }] },
  artFaceDark: { backgroundColor: '#354B43', borderColor: '#6B7B6D' },
  cardBottom: { borderTopWidth: 1, borderTopColor: '#E9EADF', paddingTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  bottomOnDark: { borderTopColor: '#3C5048' },
  cta: { ...authType.label, fontSize: 11, lineHeight: 16, color: '#344E45', flexShrink: 1 },
  arrow: { width: 27, height: 27, borderRadius: 14, backgroundColor: '#E9EDDF', alignItems: 'center', justifyContent: 'center' },
  arrowOnDark: { backgroundColor: '#D6DDC6' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  footnote: { ...authType.body, fontSize: 10, lineHeight: 16, color: '#777A74', flexShrink: 1 },
});
