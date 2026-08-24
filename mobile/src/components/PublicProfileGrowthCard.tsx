import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { Alert, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { publicBusinessProfileUrl } from '../domain/publicBusinessProfile';
import { colors, radius, spacing, typography } from '../theme';

export function PublicProfileGrowthCard({ businessName, slug }: { businessName: string; slug: string }) {
  const url = publicBusinessProfileUrl(slug);
  const share = async () => { try { await Share.share({ title: businessName, message: `Contact ${businessName} on Chakusa: ${url}` }); } catch { /* share dismissed */ } };
  const copy = async () => { await Clipboard.setStringAsync(url); Alert.alert('Link copied', 'Your customer page link is ready to share.'); };
  return <View style={styles.card}>
    <View style={styles.icon}><Ionicons name="storefront-outline" size={22} color={colors.surface} /></View>
    <View style={styles.copy}><Text style={styles.eyebrow}>GET MORE CUSTOMERS</Text><Text style={styles.title}>Your customer page is live</Text><Text style={styles.body}>Share it so customers can call, WhatsApp, view your services, or send a new enquiry directly into Chakusa.</Text><Text numberOfLines={1} style={styles.url}>{url}</Text></View>
    <View style={styles.actions}><Pressable accessibilityRole="button" onPress={() => void copy()} style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}><Ionicons name="copy-outline" size={17} color={colors.text} /><Text style={styles.secondaryText}>Copy</Text></Pressable><Pressable accessibilityRole="button" onPress={() => void share()} style={({ pressed }) => [styles.primary, pressed && styles.pressed]}><Ionicons name="share-social-outline" size={17} color={colors.surface} /><Text style={styles.primaryText}>Share page</Text></Pressable></View>
  </View>;
}
const styles = StyleSheet.create({ card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.lg, gap: spacing.md }, icon: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }, copy: { gap: spacing.xs }, eyebrow: { ...typography.micro, color: colors.primary, letterSpacing: 1 }, title: { ...typography.subheading, color: colors.text }, body: { ...typography.body, color: colors.textSecondary }, url: { ...typography.caption, color: colors.primary }, actions: { flexDirection: 'row', gap: spacing.sm }, secondary: { minHeight: 46, flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, flexDirection: 'row', gap: spacing.xs, alignItems: 'center', justifyContent: 'center' }, primary: { minHeight: 46, flex: 2, backgroundColor: colors.primary, borderRadius: radius.md, flexDirection: 'row', gap: spacing.xs, alignItems: 'center', justifyContent: 'center' }, secondaryText: { ...typography.bodyStrong, color: colors.text }, primaryText: { ...typography.bodyStrong, color: colors.surface }, pressed: { opacity: .72 } });
