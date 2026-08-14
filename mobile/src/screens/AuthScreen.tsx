import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AuthForm } from '../components/AuthForm';
import { colors, radius, spacing, typography } from '../theme';
import { RootStackParamList } from '../types';
import { usePreferences } from '../state/PreferencesContext';

export function AuthScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const preferences = usePreferences();
  const continueAfterSignIn = () => { if (!preferences.onboardingComplete) preferences.setOnboardingStep(2); };
  const returnToWelcome = () => navigation.reset({ index: 0, routes: [{ name: 'FirstEntry' }] });
  return <SafeAreaView style={styles.safe}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboard}><ScrollView contentContainerStyle={styles.container} keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}><View><Pressable accessibilityLabel="Back to welcome" accessibilityRole="button" hitSlop={8} onPress={returnToWelcome} style={({ pressed }) => [styles.back, pressed && styles.backPressed]}><Ionicons name="chevron-back" size={24} color={colors.text} /><Text style={styles.backText}>Back</Text></Pressable><View style={styles.mark}><Text style={styles.markText}>C</Text></View><Text style={styles.brand}>CHAKUSA</Text><Text style={styles.tagline}>Recover. Reputation. Return.</Text></View><AuthForm defaultMode="login" onSuccess={continueAfterSignIn} onForgotPassword={() => navigation.navigate('ForgotPassword')} /></ScrollView></KeyboardAvoidingView></SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.background }, keyboard: { flex: 1 }, container: { flexGrow: 1, padding: spacing.xl, justifyContent: 'space-between', gap: spacing.xxl }, back: { minWidth: 72, minHeight: 44, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, marginLeft: -spacing.xs }, backPressed: { opacity: 0.55 }, backText: { ...typography.bodyStrong, color: colors.text }, mark: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg }, markText: { fontSize: 28, fontWeight: '800', color: colors.surface }, brand: { ...typography.title, color: colors.text, marginTop: spacing.lg }, tagline: { ...typography.body, color: colors.textSecondary, marginTop: spacing.xs } });
