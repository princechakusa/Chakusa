import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { AppHeader, PrimaryButton, Screen, SecondaryButton, StatusBadge } from '../components/ui';
import { BILLING_ENABLED, PRIVACY_POLICY_URL, TERMS_OF_USE_URL } from '../config';
import { canSubscribe, isEntitledStatus, subscriptionPeriodCopy, subscriptionStatusLabel } from '../domain/billing';
import { legalDestination } from '../domain/trustSettings';
import { openExternalDestination } from '../services/externalDestinations';
import { useBilling } from '../state/BillingContext';
import { useAuth } from '../state/AuthContext';
import { usePlanExperience } from '../state/PlanExperienceContext';
import { colors, radius, spacing, typography } from '../theme';
import { RootStackParamList } from '../types';
import { formatMoney } from '../utils/format';

const benefits = [
  ...(Platform.OS === 'android' ? ['Automatic missed-call follow-up'] : []),
  'Automatic follow-up for leads that go quiet',
  'Automatic win-back messages for dormant customers',
  'Chakusa outbound SMS',
  'Unlimited normal customer, lead, review, and reminder limits',
  'Unlimited custom templates',
  'Advanced analytics and extended history',
];
const privacy = legalDestination(PRIVACY_POLICY_URL); const terms = legalDestination(TERMS_OF_USE_URL);

export function ProScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { plan, status, subscription } = usePlanExperience(); const billing = useBilling(); const { role } = useAuth();
  const entitled = isEntitledStatus(status); const maySubscribe = role === 'OWNER' && canSubscribe(plan, status);
  const statusLabel = subscription ? subscriptionStatusLabel(subscription) : null; const period = subscription ? subscriptionPeriodCopy(subscription) : null;
  return <Screen><AppHeader eyebrow="CHAKUSA PRO" title="Let Chakusa follow up when you can’t." subtitle="Automation and more room to grow, with entitlement confirmed by Chakusa." right={entitled && statusLabel ? <StatusBadge label={statusLabel} /> : undefined} />
    <View style={styles.card}>{benefits.map(item => <View key={item} style={styles.feature}><Ionicons name="checkmark-circle-outline" size={20} color={colors.primary} /><Text style={styles.featureText}>{item}</Text></View>)}</View>
    {subscription?.value ? <View style={[styles.card, styles.statusCard]}><Text style={styles.cardTitle}>Your Chakusa value</Text><Text style={styles.body}>Real business activity—not projections.</Text><Text style={styles.featureText}>{formatMoney(subscription.value.recoveredRevenueThisMonth)} recovered this month</Text><Text style={styles.featureText}>{subscription.value.completedAppointmentsThisMonth} appointments completed this month</Text><Text style={styles.featureText}>{formatMoney(subscription.value.scheduledAppointmentValue)} in upcoming booked value</Text></View> : null}
    <View style={styles.card}><Text style={styles.cardTitle}>Chakusa Business</Text><Text style={styles.body}>Run Chakusa with your team.</Text>{['Everything in Pro','Multiple staff seats','Team invitations','Admin and Staff roles','Team access controls'].map(item => <View key={item} style={styles.feature}><Ionicons name="people-outline" size={20} color={colors.primary} /><Text style={styles.featureText}>{item}</Text></View>)}<Text style={styles.body}>Business pricing will be shown through the App Store or Google Play when available.</Text><SecondaryButton fullWidth label="View Team" onPress={() => navigation.navigate('Team')} /></View>
    {subscription && plan === 'BUSINESS' ? <View style={[styles.card, styles.statusCard]}><Text style={styles.cardTitle}>Chakusa Business · {statusLabel}</Text>{period ? <Text style={styles.body}>{period}</Text> : null}{status === 'GRACE_PERIOD' ? <Text style={styles.body}>Your Business access remains active while the store resolves payment.</Text> : null}{role === 'OWNER' && subscription.provider ? <SecondaryButton fullWidth label="Manage Subscription" onPress={() => void billing.manage()} /> : null}</View> : null}
    {subscription && plan === 'PRO' ? <View style={[styles.card, styles.statusCard]}><Text style={styles.cardTitle}>Chakusa Pro · {statusLabel}</Text>{period ? <Text style={styles.body}>{period}</Text> : null}{status === 'GRACE_PERIOD' ? <Text style={styles.body}>Your Pro access is still active while the store attempts to resolve your payment.</Text> : null}{subscription.cancelAtPeriodEnd && status === 'ACTIVE' ? <Text style={styles.body}>Your subscription will not renew. Pro access remains active through the date above.</Text> : null}{subscription.provider ? <SecondaryButton fullWidth label="Manage Subscription" onPress={() => void billing.manage()} /> : null}</View> : null}
    {maySubscribe ? <View style={styles.purchase}><Text style={styles.cardTitle}>Subscribe to Chakusa Pro</Text>
      {!BILLING_ENABLED ? <Text style={styles.body}>Purchasing is not available in this build yet.</Text> : !billing.supported ? <Text style={styles.body}>Subscriptions are available in the Chakusa mobile app.</Text> : !billing.configured ? <><Text style={styles.body}>The monthly Pro product is not configured for this build.</Text><Text style={styles.dev}>Add the platform’s public Pro monthly product ID and create a new development build.</Text></> : billing.productLoading && !billing.product ? <Text accessibilityLiveRegion="polite" style={styles.body}>Loading the store price…</Text> : billing.product ? <><View accessible accessibilityLabel={`Chakusa Pro, monthly, ${billing.product.displayPrice}`} style={styles.price}><Text style={styles.priceValue}>{billing.product.displayPrice}</Text><Text style={styles.pricePeriod}>per month</Text></View><Text style={styles.body}>Plan: Chakusa Pro</Text><Text style={styles.body}>Billing period: Monthly</Text><Text style={styles.body}>Billed monthly. Auto-renews until canceled.</Text>{billing.product.introductoryOffer ? <Text style={styles.offer}>Store offer: {billing.product.introductoryOffer}</Text> : null}<PrimaryButton fullWidth disabled={billing.purchasing || billing.restoring} label={billing.purchasing ? 'Waiting for store…' : 'Subscribe'} onPress={() => void billing.subscribe()} /></> : <><Text style={styles.body}>The store product could not be loaded. No checkout price is available.</Text><PrimaryButton fullWidth disabled={billing.productLoading} label={billing.productLoading ? 'Loading…' : 'Retry store'} onPress={() => void billing.loadProduct()} /></>}
      <SecondaryButton fullWidth disabled={!billing.supported || billing.restoring || billing.purchasing} label={billing.restoring ? 'Restoring…' : 'Restore Purchases'} onPress={() => void billing.restore()} />
      {billing.error?.includes('could not confirm') ? <SecondaryButton fullWidth disabled={billing.purchasing} label="Try verification again" onPress={() => void billing.retryVerification()} /> : null}
      {billing.message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{billing.message}</Text> : null}{billing.error ? <Text accessibilityRole="alert" style={styles.error}>{billing.error}</Text> : null}
      <View style={styles.legal}><Text accessibilityRole="link" onPress={() => void openExternalDestination(terms, 'Terms of Use')} style={styles.link}>Terms of Use</Text><Text accessibilityRole="link" onPress={() => void openExternalDestination(privacy, 'Privacy Policy')} style={styles.link}>Privacy Policy</Text></View>
    </View> : null}
    <View style={styles.card}><Text style={styles.cardTitle}>Automation</Text><Text style={styles.body}>Set up automatic lead follow-up and customer win-back SMS once Pro is active{Platform.OS === 'android' ? ', including missed-call recovery' : ''}.</Text><SecondaryButton fullWidth label="View automation" onPress={() => navigation.navigate('Automation')} /></View>
    <Text style={styles.footnote}>Approximately US$29/month is Chakusa’s informational product direction. Your store’s localized price above is the purchase authority.</Text>
  </Screen>;
}
const styles = StyleSheet.create({ card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm }, statusCard: { borderColor: colors.success }, purchase: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, padding: spacing.lg, gap: spacing.md }, cardTitle: { ...typography.subheading, color: colors.text }, feature: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }, featureText: { ...typography.body, color: colors.text, flex: 1 }, body: { ...typography.body, color: colors.textSecondary }, price: { alignItems: 'center', paddingVertical: spacing.sm }, priceValue: { fontSize: 36, lineHeight: 44, fontWeight: '700', color: colors.text }, pricePeriod: { ...typography.body, color: colors.textSecondary }, offer: { ...typography.bodyStrong, color: colors.text }, dev: { ...typography.caption, color: colors.textSecondary }, legal: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg }, link: { ...typography.bodyStrong, color: colors.primary, minHeight: 44, textAlignVertical: 'center' }, message: { ...typography.body, color: colors.text }, error: { ...typography.body, color: colors.negative }, footnote: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' } });
