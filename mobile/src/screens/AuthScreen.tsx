import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AuthForm } from '../components/AuthForm';
import { colors, radius, spacing, typography } from '../theme';
import { RootStackParamList } from '../types';

export function AuthScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return <SafeAreaView style={styles.safe}><View style={styles.container}><View><View style={styles.mark}><Text style={styles.markText}>C</Text></View><Text style={styles.brand}>CHAKUSA</Text><Text style={styles.tagline}>Recover. Reputation. Return.</Text></View><AuthForm defaultMode="login" onForgotPassword={() => navigation.navigate('ForgotPassword')} /></View></SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.background }, container: { flex: 1, padding: spacing.xl, justifyContent: 'space-between' }, mark: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: spacing.xxl }, markText: { fontSize: 28, fontWeight: '800', color: colors.surface }, brand: { ...typography.title, color: colors.text, marginTop: spacing.lg }, tagline: { ...typography.body, color: colors.textSecondary, marginTop: spacing.xs } });
