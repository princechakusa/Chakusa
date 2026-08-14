import { StyleSheet, Text, View } from 'react-native';
import { AppHeader, Screen } from '../components/ui';
import { useAuth } from '../state/AuthContext';
import { colors, radius, spacing, typography } from '../theme';
import { titleCase } from '../utils/format';

export function AccountInformationScreen() { const { user, business, role } = useAuth(); return <Screen><AppHeader eyebrow="ACCOUNT" title="Account information" subtitle="Your signed-in identity is separate from your business profile." /><View style={styles.card}><Field label="Name" value={user?.fullName} /><Field label="Email" value={user?.email} /><Field label="Business" value={business?.name} /><Field label="Role" value={role ? titleCase(role) : undefined} last /></View><Text style={styles.helper}>Account details are currently read-only. Business information can be updated from Business details in Settings.</Text></Screen>; }
function Field({ label, value, last }: { label: string; value?: string | null; last?: boolean }) { return <View style={[styles.field, !last && styles.border]}><Text style={styles.label}>{label}</Text><Text selectable style={styles.value}>{value || 'Not available'}</Text></View>; }
const styles = StyleSheet.create({ card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.lg }, field: { minHeight: 64, justifyContent: 'center', gap: spacing.xxs }, border: { borderBottomWidth: 1, borderBottomColor: colors.divider }, label: { ...typography.caption, color: colors.textSecondary }, value: { ...typography.body, color: colors.text }, helper: { ...typography.caption, color: colors.textSecondary } });
