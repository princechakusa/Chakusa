import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator, BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AuthScreen } from '../screens/AuthScreen';
import { ComebackScreen } from '../screens/ComebackScreen';
import { CustomerProfileScreen } from '../screens/CustomerProfileScreen';
import { CustomersScreen } from '../screens/CustomersScreen';
import { DashboardScreen } from '../screens/DashboardScreen';
import { LeadDetailScreen } from '../screens/LeadDetailScreen';
import { LeadsScreen } from '../screens/LeadsScreen';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { ReviewDetailScreen } from '../screens/ReviewDetailScreen';
import { ReviewsScreen } from '../screens/ReviewsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { TemplatesScreen } from '../screens/TemplatesScreen';
import { BusinessSettingsScreen } from '../screens/BusinessSettingsScreen';
import { AttentionCenterScreen } from '../screens/AttentionCenterScreen';
import { DeleteAccountScreen } from '../screens/DeleteAccountScreen';
import { ForgotPasswordScreen } from '../screens/ForgotPasswordScreen';
import { ResetPasswordScreen } from '../screens/ResetPasswordScreen';
import { colors, spacing, typography } from '../theme';
import { MainTabParamList, RootStackParamList } from '../types';
import { useAuth } from '../state/AuthContext';
import { ErrorState } from '../components/ui';
import { usePreferences } from '../state/PreferencesContext';

const Root = createNativeStackNavigator<RootStackParamList>(); const Tabs = createBottomTabNavigator<MainTabParamList>();
const icons: Record<keyof MainTabParamList, { active: keyof typeof Ionicons.glyphMap; inactive: keyof typeof Ionicons.glyphMap }> = {
  Dashboard: { active: 'home', inactive: 'home-outline' }, Leads: { active: 'call', inactive: 'call-outline' }, Reviews: { active: 'star', inactive: 'star-outline' }, Customers: { active: 'people', inactive: 'people-outline' }, Settings: { active: 'person', inactive: 'person-outline' },
};
export function BottomTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets(); return <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, spacing.xs) }]}>{state.routes.map((route, index) => { const focused = state.index === index; const label = descriptors[route.key].options.title ?? route.name; const config = icons[route.name as keyof MainTabParamList]; return <Pressable key={route.key} accessibilityRole="tab" accessibilityState={focused ? { selected: true } : {}} accessibilityLabel={`${String(label)} tab`} onPress={() => { const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true }); if (!focused && !event.defaultPrevented) navigation.navigate(route.name); }} style={styles.tab}><Ionicons name={focused ? config.active : config.inactive} size={23} color={focused ? colors.primary : colors.tabInactive} /><Text numberOfLines={1} style={[styles.tabLabel, focused && styles.tabLabelActive]}>{String(label)}</Text></Pressable>; })}</View>;
}
function MainTabs() { return <Tabs.Navigator tabBar={props => <BottomTabBar {...props} />} screenOptions={{ headerShown: false }}><Tabs.Screen name="Dashboard" component={DashboardScreen} /><Tabs.Screen name="Leads" component={LeadsScreen} /><Tabs.Screen name="Reviews" component={ReviewsScreen} /><Tabs.Screen name="Customers" component={CustomersScreen} /><Tabs.Screen name="Settings" component={SettingsScreen} options={{ title: 'Account' }} /></Tabs.Navigator>; }
export function AppNavigator() {
  const { status, restoreError, restore } = useAuth(); const preferences = usePreferences();
  if (status === 'restoring' || preferences.restoring) return <View style={styles.restoring}><ActivityIndicator color={colors.primary} /><Text style={styles.restoringText}>Restoring your workspace…</Text></View>;
  if (status === 'restore-error') return <View style={styles.restoring}><ErrorState message={restoreError ?? 'Unable to restore your session.'} onRetry={() => void restore()} /></View>;
  return <Root.Navigator screenOptions={{ headerShadowVisible: false, headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text, headerTitle: '', headerBackButtonDisplayMode: 'minimal', contentStyle: { backgroundColor: colors.background } }}>
    {status === 'anonymous' && preferences.onboardingComplete ? <Root.Screen name="Login" component={AuthScreen} options={{ headerShown: false }} /> : !preferences.onboardingComplete ? <Root.Screen name="Onboarding" component={OnboardingScreen} options={{ headerShown: false }} /> : <><Root.Screen name="Main" component={MainTabs} options={{ headerShown: false }} /><Root.Screen name="AttentionCenter" component={AttentionCenterScreen} /><Root.Screen name="LeadDetail" component={LeadDetailScreen} /><Root.Screen name="CustomerProfile" component={CustomerProfileScreen} /><Root.Screen name="ReviewDetail" component={ReviewDetailScreen} /><Root.Screen name="Comeback" component={ComebackScreen} /><Root.Screen name="Templates" component={TemplatesScreen} /><Root.Screen name="BusinessSettings" component={BusinessSettingsScreen} /><Root.Screen name="DeleteAccount" component={DeleteAccountScreen} /></>}
    <Root.Screen name="ForgotPassword" component={ForgotPasswordScreen} options={{ title: 'Forgot password' }} />
    <Root.Screen name="ResetPassword" component={ResetPasswordScreen} options={{ title: 'Reset password' }} />
  </Root.Navigator>;
}
const styles = StyleSheet.create({ restoring: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.background }, restoringText: { ...typography.body, color: colors.textSecondary }, tabBar: { minHeight: 64, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: 'row', paddingTop: spacing.xs, paddingHorizontal: spacing.xs }, tab: { flex: 1, minWidth: 0, minHeight: 52, alignItems: 'center', justifyContent: 'center', gap: 3 }, tabLabel: { ...typography.micro, fontSize: 10, color: colors.tabInactive }, tabLabelActive: { color: colors.primary } });
