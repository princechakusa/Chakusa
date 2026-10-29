import { Ionicons } from '../components/icons';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { BrandMark } from '../components/BrandMark';
import { authType } from './authTheme';

export function EntryHeader({ onBack, business }: { onBack: () => void; business: boolean }) {
  return <View style={entryStyles.header}>
    <Pressable accessibilityRole="button" accessibilityLabel="Back to the Chakusa welcome screen" onPress={onBack} hitSlop={8} style={({ pressed }) => [entryStyles.back, pressed && { opacity: 0.6 }]}><Ionicons name="arrow-back" size={19} color="#243C37" /></Pressable>
    <View style={entryStyles.brand}><BrandMark size={25} /><Text style={entryStyles.wordmark}>CHAKUSA</Text></View>
    <Text style={entryStyles.headerLabel}>{business ? 'BUSINESS' : 'PERSONAL'}</Text>
  </View>;
}

/** `compact` trims the hero so the full sign-in / sign-up form fits beneath it. */
export function EntryIntro({ business, registering, compact = false }: { business: boolean; registering: boolean; compact?: boolean }) {
  return <View style={[entryStyles.intro, compact && entryStyles.introCompact]}>
    <Text style={entryStyles.eyebrow}>{registering ? 'SOMETHING GOOD STARTS HERE' : 'YOUR NEXT CHAPTER, CONNECTED'}</Text>
    <Text accessibilityRole="header" style={[entryStyles.title, compact && entryStyles.titleCompact]}>{registering ? 'Make yourself' : 'Good to have'}<Text style={[entryStyles.serif, compact && entryStyles.serifCompact]}>{'\n'}{registering ? 'at home.' : 'you here.'}</Text></Text>
    <Text style={entryStyles.subtitle}>{business ? 'Less admin. More momentum.\nMake space for what you do best.' : 'Your plans, favourite places and little rewards.\nAll together, in one place.'}</Text>
  </View>;
}

export function EntryBenefits({ business }: { business: boolean }) {
  const benefits: { icon: keyof typeof Ionicons.glyphMap; label: string }[] = business
    ? [{ icon: 'calendar-outline', label: 'Stay organised' }, { icon: 'call-outline', label: 'Follow up' }, { icon: 'trending-up-outline', label: 'Keep growing' }]
    : [{ icon: 'calendar-outline', label: 'Book simply' }, { icon: 'heart-outline', label: 'Save favourites' }, { icon: 'gift-outline', label: 'Earn rewards' }];
  return <View style={entryStyles.benefits}>{benefits.map((item, index) => <View key={item.label} style={[entryStyles.benefit, index > 0 && entryStyles.benefitBorder]}><View style={entryStyles.benefitIcon}><Ionicons name={item.icon} size={20} color="#526B5D" /></View><Text style={entryStyles.benefitLabel}>{item.label}</Text></View>)}</View>;
}

export const entryStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F6F4EF' },
  scroll: { flexGrow: 1, width: '100%', maxWidth: 500, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 14, paddingBottom: 24, gap: 20 },
  header: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  back: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: '#DCE1D6', backgroundColor: '#FFFDF9', alignItems: 'center', justifyContent: 'center' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  wordmark: { ...authType.micro, fontSize: 10, letterSpacing: 1.8, color: '#243C37' },
  headerLabel: { ...authType.micro, fontSize: 7, letterSpacing: 1, color: '#718075', maxWidth: 54 },
  intro: { paddingTop: 8, gap: 12 },
  introCompact: { paddingTop: 0, gap: 8 },
  titleCompact: { fontSize: 28, lineHeight: 34 },
  serifCompact: { fontSize: 37, lineHeight: 43 },
  eyebrow: { ...authType.micro, fontSize: 8, lineHeight: 12, letterSpacing: 1.5, color: '#758274' },
  title: { ...authType.display, fontSize: 33, lineHeight: 41, letterSpacing: -1.2, color: '#182F2D' },
  serif: { fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif', fontSize: 45, lineHeight: 52, fontStyle: 'italic', fontWeight: '400', letterSpacing: -1.6, color: '#182F2D' },
  subtitle: { ...authType.body, fontSize: 12, lineHeight: 19, color: '#718075' },
  benefits: { flexDirection: 'row', backgroundColor: '#ECEFE5', borderRadius: 18, paddingVertical: 17 },
  benefit: { flex: 1, alignItems: 'center', gap: 7, paddingHorizontal: 5 },
  benefitBorder: { borderLeftWidth: 1, borderLeftColor: '#D5DECC' },
  benefitIcon: { height: 23, alignItems: 'center', justifyContent: 'center' },
  benefitLabel: { ...authType.micro, fontSize: 8, lineHeight: 12, letterSpacing: 0, color: '#596F5F', textAlign: 'center' },
  signInCard: { backgroundColor: '#FFFDF9', borderWidth: 1, borderColor: '#E0E4D8', borderRadius: 22, padding: 20, gap: 15 },
  cardEyebrow: { ...authType.micro, fontSize: 8, lineHeight: 12, letterSpacing: 1.4, color: '#7A8576', marginBottom: 1 },
  cardHint: { ...authType.body, fontSize: 10, lineHeight: 16, color: '#7B8177', textAlign: 'center' },
  legal: { ...authType.body, fontSize: 10, lineHeight: 16, color: '#889080', textAlign: 'center', paddingHorizontal: 5 },
  legalLink: { color: '#395D4D', textDecorationLine: 'underline' },
  secureRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: 0, marginBottom: 9 },
  secureText: { ...authType.micro, fontSize: 9, letterSpacing: 0.2, color: '#87917F' },
});
