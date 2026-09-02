import { Ionicons } from '@expo/vector-icons';
import { BottomTabBarProps, createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorState } from '../../components/ui';
import { colors, spacing, typography } from '../../theme';
import { useCustomerAuth } from '../CustomerAuthContext';
import { BookingDetailScreen } from '../screens/BookingDetailScreen';
import { BookingFlowScreen } from '../screens/BookingFlowScreen';
import { BusinessProfileScreen } from '../screens/BusinessProfileScreen';
import { CustomerAccountScreen } from '../screens/CustomerAccountScreen';
import { CustomerAssistantScreen } from '../screens/CustomerAssistantScreen';
import { CustomerAuthScreen } from '../screens/CustomerAuthScreen';
import { CustomerBookingsScreen } from '../screens/CustomerBookingsScreen';
import { CustomerExploreScreen } from '../screens/CustomerExploreScreen';
import { CustomerHomeScreen } from '../screens/CustomerHomeScreen';
import { CustomerLegalDocumentScreen } from '../screens/CustomerLegalDocumentScreen';
import { CustomerLegalGateScreen } from '../screens/CustomerLegalGateScreen';
import { CustomerNotificationsScreen } from '../screens/CustomerNotificationsScreen';
import { CustomerRewardsScreen } from '../screens/CustomerRewardsScreen';
import { CustomerLoyaltyBusinessScreen } from '../screens/CustomerLoyaltyBusinessScreen';
import { CustomerLoyaltyHistoryScreen } from '../screens/CustomerLoyaltyHistoryScreen';
import { CustomerRewardDetailScreen } from '../screens/CustomerRewardDetailScreen';
import { CustomerRedemptionsScreen } from '../screens/CustomerRedemptionsScreen';
import { CustomerRedemptionDetailScreen } from '../screens/CustomerRedemptionDetailScreen';
import { CustomerMembershipsScreen } from '../screens/CustomerMembershipsScreen';
import { CustomerMembershipPlansScreen } from '../screens/CustomerMembershipPlansScreen';
import { CustomerReferralsScreen } from '../screens/CustomerReferralsScreen';
import { EditCustomerProfileScreen } from '../screens/EditCustomerProfileScreen';
import { navigationRef } from './customerNavigationRef';
import type { CustomerRootStackParamList, CustomerTabParamList } from './types';

const Stack = createNativeStackNavigator<CustomerRootStackParamList>();
const Tabs = createBottomTabNavigator<CustomerTabParamList>();

const tabIcons: Record<keyof CustomerTabParamList, { active: keyof typeof Ionicons.glyphMap; inactive: keyof typeof Ionicons.glyphMap }> = {
  CustomerHome: { active: 'home', inactive: 'home-outline' },
  CustomerExplore: { active: 'compass', inactive: 'compass-outline' },
  CustomerBookings: { active: 'calendar', inactive: 'calendar-outline' },
  CustomerAccount: { active: 'person', inactive: 'person-outline' },
};
const tabLabels: Record<keyof CustomerTabParamList, string> = {
  CustomerHome: 'Home', CustomerExplore: 'Explore', CustomerBookings: 'Bookings', CustomerAccount: 'Account',
};

function CustomerTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, spacing.xs) }]}>
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const key = route.name as keyof CustomerTabParamList;
        const icon = tabIcons[key];
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={focused ? { selected: true } : {}}
            accessibilityLabel={`${tabLabels[key]} tab`}
            onPress={() => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
            }}
            style={styles.tab}
          >
            <Ionicons name={focused ? icon.active : icon.inactive} size={23} color={focused ? colors.primary : colors.tabInactive} />
            <Text style={[styles.tabLabel, focused && styles.tabLabelActive]}>{tabLabels[key]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function CustomerTabsNavigator() {
  return (
    <Tabs.Navigator tabBar={(props) => <CustomerTabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="CustomerHome" component={CustomerHomeScreen} />
      <Tabs.Screen name="CustomerExplore" component={CustomerExploreScreen} />
      <Tabs.Screen name="CustomerBookings" component={CustomerBookingsScreen} />
      <Tabs.Screen name="CustomerAccount" component={CustomerAccountScreen} />
    </Tabs.Navigator>
  );
}

export function CustomerNavigator() {
  const { status, restoreError, restore, legalAcceptanceRequired } = useCustomerAuth();

  if (status === 'restoring') {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.centreText}>Getting things ready…</Text>
      </View>
    );
  }
  if (status === 'restore-error') {
    return <View style={styles.centre}><ErrorState message={restoreError ?? 'Unable to restore your session.'} onRetry={() => void restore()} /></View>;
  }

  const authed = status === 'authenticated';

  return (
    <Stack.Navigator
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerTitle: '',
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      {!authed ? (
        <Stack.Screen name="CustomerAuth" component={CustomerAuthScreen} options={{ headerShown: false }} />
      ) : legalAcceptanceRequired ? (
        <>
          <Stack.Screen name="CustomerLegalGate" component={LegalGate} options={{ headerShown: false }} />
          <Stack.Screen name="CustomerLegalDocument" component={CustomerLegalDocumentScreen} options={{ headerShown: true }} />
        </>
      ) : (
        <>
          <Stack.Screen name="CustomerTabs" component={CustomerTabsNavigator} options={{ headerShown: false }} />
          <Stack.Screen name="BusinessProfile" component={BusinessProfileScreen} />
          <Stack.Screen name="BookingFlow" component={BookingFlowScreen} />
          <Stack.Screen name="BookingDetail" component={BookingDetailScreen} />
          <Stack.Screen name="CustomerNotifications" component={CustomerNotificationsScreen} />
          <Stack.Screen name="CustomerAssistant" component={CustomerAssistantScreen} />
          <Stack.Screen name="CustomerRewards" component={CustomerRewardsScreen} />
          <Stack.Screen name="CustomerLoyaltyBusiness" component={CustomerLoyaltyBusinessScreen} />
          <Stack.Screen name="CustomerLoyaltyHistory" component={CustomerLoyaltyHistoryScreen} />
          <Stack.Screen name="CustomerRewardDetail" component={CustomerRewardDetailScreen} />
          <Stack.Screen name="CustomerRedemptions" component={CustomerRedemptionsScreen} />
          <Stack.Screen name="CustomerRedemptionDetail" component={CustomerRedemptionDetailScreen} />
          <Stack.Screen name="CustomerMemberships" component={CustomerMembershipsScreen} />
          <Stack.Screen name="CustomerMembershipPlans" component={CustomerMembershipPlansScreen} />
          <Stack.Screen name="CustomerReferrals" component={CustomerReferralsScreen} />
          <Stack.Screen name="EditCustomerProfile" component={EditCustomerProfileScreen} />
          <Stack.Screen name="CustomerLegalDocument" component={CustomerLegalDocumentScreen} />
        </>
      )}
    </Stack.Navigator>
  );
}

function LegalGate() {
  return (
    <CustomerLegalGateScreen
      onViewDocument={(type) => navigationRef.isReady() && navigationRef.navigate('CustomerLegalDocument', { type })}
    />
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.background },
  centreText: { ...typography.body, color: colors.textSecondary },
  tabBar: { minHeight: 64, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: 'row', paddingTop: spacing.xs, paddingHorizontal: spacing.xs },
  tab: { flex: 1, minWidth: 0, minHeight: 52, alignItems: 'center', justifyContent: 'center', gap: 3 },
  tabLabel: { ...typography.micro, fontSize: 10, color: colors.tabInactive },
  tabLabelActive: { color: colors.primary },
});
