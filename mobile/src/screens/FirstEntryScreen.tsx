import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius, shadows, spacing, typography } from '../theme';
import { RootStackParamList } from '../types';
import recoveryOwnerImage from '../../assets/onboarding-recovery-owner.png';
import { authenticationEntry } from '../domain/authenticationFlow';

export function FirstEntryScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'FirstEntry'>>();
  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
    <View style={styles.brandRow}><View style={styles.mark}><Text style={styles.markText}>C</Text></View><Text style={styles.brand}>CHAKUSA</Text></View>
    <View style={styles.heroFrame}><Image accessibilityLabel="A business owner managing customer relationships on her phone" resizeMode="cover" source={recoveryOwnerImage} style={styles.heroImage} /></View>
    <View style={styles.copy}><Text style={styles.title}>Customers back.{`\n`}Business moving.</Text><Text style={styles.subtitle}>Turn missed opportunities into follow-ups, reviews, and returning customers.</Text></View>
    <View style={styles.actions}>
      <EntryCard icon="briefcase-outline" title="I run a service business" detail="Create my CHAKUSA workspace" primary onPress={() => navigation.navigate(...authenticationEntry('register'))} />
      <EntryCard icon="log-in-outline" title="I already use CHAKUSA" detail="Sign in to my business" onPress={() => navigation.navigate(...authenticationEntry('login'))} />
    </View>
  </ScrollView></SafeAreaView>;
}

function EntryCard({ icon, title, detail, primary, onPress }: { icon: keyof typeof Ionicons.glyphMap; title: string; detail: string; primary?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${detail}`} onPress={onPress} style={({ pressed }) => [styles.card, primary && styles.cardPrimary, pressed && styles.pressed]}>
    <View style={[styles.cardIcon, primary && styles.cardIconPrimary]}><Ionicons name={icon} size={24} color={primary ? colors.surface : colors.primary} /></View>
    <View style={styles.cardCopy}><Text style={styles.cardTitle}>{title}</Text><Text style={styles.cardDetail}>{detail}</Text></View><Ionicons name="chevron-forward" size={24} color={colors.text} />
  </Pressable>;
}

const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.surface }, page: { flexGrow: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xl, gap: spacing.xl }, brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, mark: { width: 34, height: 34, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }, markText: { fontSize: 19, fontWeight: '800', color: colors.surface }, brand: { ...typography.bodyStrong, letterSpacing: 1.4, color: colors.text }, heroFrame: { height: 330, overflow: 'hidden', marginHorizontal: -spacing.lg, backgroundColor: '#F7EFE3' }, heroImage: { width: '100%', height: '100%' }, copy: { gap: spacing.sm }, title: { ...typography.hero, color: colors.text }, subtitle: { ...typography.body, color: colors.textSecondary, maxWidth: 520 }, actions: { marginTop: 'auto', gap: spacing.sm }, card: { minHeight: 92, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: spacing.md, ...shadows.card }, cardPrimary: { borderColor: colors.text }, cardIcon: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }, cardIconPrimary: { backgroundColor: colors.text }, cardCopy: { flex: 1 }, cardTitle: { ...typography.bodyStrong, color: colors.text }, cardDetail: { ...typography.caption, color: colors.textSecondary, marginTop: 2 }, pressed: { opacity: 0.72 } });
