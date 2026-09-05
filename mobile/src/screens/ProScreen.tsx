import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { AppHeader, PrimaryButton, Screen, SecondaryButton, StatusBadge } from '../components/ui';
import { BILLING_ENABLED, PRIVACY_POLICY_URL, TERMS_OF_USE_URL } from '../config';
import { canPurchasePlan, isEntitledStatus, subscriptionPeriodCopy, subscriptionStatusLabel } from '../domain/billing';
import { capabilityStatusCopy, FUTURE_CAPABILITIES, isCapabilityUnlocked } from '../domain/futureCapabilities';
import { trialProgressCopy } from '../domain/trialExperience';
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
  const { plan, status, subscription } = usePlanExperience(); const billing = useBilling(); const { role, business } = useAuth();
  const entitled = isEntitledStatus(status); const maySubscribe = role === 'OWNER' && (canPurchasePlan(plan, status, 'PRO') || canPurchasePlan(plan, status, 'BUSINESS'));
  const selectedName = billing.selectedPlan === 'BUSINESS' ? 'Business' : 'Pro';
  const statusLabel = subscription ? subscriptionStatusLabel(subscription) : null; const period = subscription ? subscriptionPeriodCopy(subscription) : null;
  const trialProgress = subscription ? trialProgressCopy(subscription) : null;
  return <Screen><AppHeader eyebrow="CHAKUSA PRO" title="Pay for outcomes, not a feature list." subtitle="See the recorded revenue, completed work, and customer follow-up Chakusa is creating for your business." right={entitled && statusLabel ? <StatusBadge label={statusLabel} /> : undefined} />
    <View style={styles.card}>{benefits.map(item => <View key={item} style={styles.feature}><Ionicons name="checkmark-circle-outline" size={20} color={colors.primary} /><Text style={styles.featureText}>{item}</Text></View>)}</View>
    {trialProgress ? <View style={styles.purchase}><Text style={styles.cardTitle}>{trialProgress.title}</Text><Text style={styles.body}>{trialProgress.message}</Text><Text style={styles.body}>Trial access and its end date come directly from your app store subscription.</Text></View> : null}
    {subscription?.value ? <View style={[styles.card, styles.statusCard]}><Text style={styles.cardTitle}>Value created this month</Text><Text style={styles.body}>Recorded outcomes from Chakusa activity—not projections.</Text><Text style={styles.featureText}>{formatMoney(subscription.value.recoveredRevenueThisMonth, business?.currency ?? 'USD')} recovered</Text><Text style={styles.featureText}>{subscription.value.completedAppointmentsThisMonth} appointments completed</Text><Text style={styles.featureText}>{subscription.value.customerMessagesSentThisMonth} customer messages sent</Text><Text style={styles.featureText}>{subscription.value.reviewsReceivedThisMonth} reviews received</Text><Text style={styles.featureText}>{formatMoney(subscription.value.scheduledAppointmentValue, business?.currency ?? 'USD')} upcoming booked value</Text></View> : null}
    <View style={styles.card}><Text style={styles.cardTitle}>Chakusa Business</Text><Text style={styles.body}>Run Chakusa with your team.</Text>{['Everything in Pro','Up to 10 team members','Team invitations','Admin and Staff roles','Team access controls'].map(item => <View key={item} style={styles.feature}><Ionicons name="people-outline" size={20} color={colors.primary} /><Text style={styles.featureText}>{item}</Text></View>)}{role === 'OWNER' && canPurchasePlan(plan, status, 'BUSINESS') ? <PrimaryButton fullWidth disabled={billing.purchasing || billing.restoring} label={billing.selectedPlan === 'BUSINESS' ? 'Business selected' : 'Choose Business'} onPress={() => billing.selectPlan('BUSINESS')} /> : null}<SecondaryButton fullWidth label="View Team" onPress={() => navigation.navigate('Team')} /></View>
    {subscription && plan === 'BUSINESS' ? <View style={[styles.card, styles.statusCard]}><Text style={styles.cardTitle}>Chakusa Business · {statusLabel}</Text>{period ? <Text style={styles.body}>{period}</Text> : null}{status === 'GRACE_PERIOD' ? <Text style={styles.body}>Your Business access remains active while the store resolves payment.</Text> : null}{role === 'OWNER' && subscription.provider ? <SecondaryButton fullWidth label="Manage Subscription" onPress={() => void billing.manage()} /> : null}</View> : null}
    {subscription && plan === 'PRO' ? <View style={[styles.card, styles.statusCard]}><Text style={styles.cardTitle}>Chakusa Pro · {statusLabel}</Text>{period ? <Text style={styles.body}>{period}</Text> : null}{status === 'GRACE_PERIOD' ? <Text style={styles.body}>Your Pro access is still active while the store attempts to resolve your payment.</Text> : null}{subscription.cancelAtPeriodEnd && status === 'ACTIVE' ? <Text style={styles.body}>Your subscription will not renew. Pro access remains active through the date above.</Text> : null}{subscription.provider ? <SecondaryButton fullWidth label="Manage Subscription" onPress={() => void billing.manage()} /> : null}</View> : null}
    {maySubscribe ? <View style={styles.purchase}><Text style={styles.cardTitle}>{plan === 'PRO' && entitled ? 'Upgrade to Chakusa Business' : `Subscribe to Chakusa ${selectedName}`}</Text>
      {canPurchasePlan(plan, status, 'PRO') && canPurchasePlan(plan, status, 'BUSINESS') ? <View style={styles.planChoices}><SecondaryButton disabled={billing.purchasing || billing.restoring} label={billing.selectedPlan === 'PRO' ? 'Pro selected' : 'Choose Pro'} onPress={() => billing.selectPlan('PRO')} /><SecondaryButton disabled={billing.purchasing || billing.restoring} label={billing.selectedPlan === 'BUSINESS' ? 'Business selected' : 'Choose Business'} onPress={() => billing.selectPlan('BUSINESS')} /></View> : null}
      {!BILLING_ENABLED ? <Text style={styles.body}>Purchasing is not available in this build yet.</Text> : !billing.supported ? <Text style={styles.body}>Subscriptions are available in the Chakusa mobile app.</Text> : !billing.configured ? <><Text style={styles.body}>The monthly {selectedName} product is not configured for this build.</Text><Text style={styles.dev}>Add the platform’s public {selectedName} monthly product ID and create a new development build.</Text></> : billing.productLoading && !billing.product ? <Text accessibilityLiveRegion="polite" style={styles.body}>Loading the store price…</Text> : billing.product ? <><View accessible accessibilityLabel={`Chakusa ${selectedName}, monthly, ${billing.product.displayPrice}`} style={styles.price}><Text style={styles.priceValue}>{billing.product.displayPrice}</Text><Text style={styles.pricePeriod}>per month</Text></View><Text style={styles.body}>Plan: Chakusa {selectedName}</Text><Text style={styles.body}>Billing period: Monthly</Text><Text style={styles.body}>Billed monthly. Auto-renews until canceled.</Text>{billing.product.introductoryOffer ? <Text style={styles.offer}>Store offer: {billing.product.introductoryOffer}</Text> : null}<PrimaryButton fullWidth disabled={billing.purchasing || billing.restoring} label={billing.purchasing ? 'Waiting for store…' : plan === 'PRO' && billing.selectedPlan === 'BUSINESS' ? 'Upgrade' : 'Subscribe'} onPress={() => void billing.subscribe()} /></> : <><Text style={styles.body}>The store product could not be loaded. No checkout price is available.</Text><PrimaryButton fullWidth disabled={billing.productLoading} label={billing.productLoading ? 'Loading…' : 'Retry store'} onPress={() => void billing.loadProduct()} /></>}
      <SecondaryButton fullWidth disabled={!billing.supported || billing.restoring || billing.purchasing} label={billing.restoring ? 'Restoring…' : 'Restore Purchases'} onPress={() => void billing.restore()} />
      {billing.error?.includes('could not confirm') ? <SecondaryButton fullWidth disabled={billing.purchasing} label="Try verification again" onPress={() => void billing.retryVerification()} /> : null}
      {billing.message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{billing.message}</Text> : null}{billing.error ? <Text accessibilityRole="alert" style={styles.error}>{billing.error}</Text> : null}
      <View style={styles.legal}><Text accessibilityRole="link" onPress={() => void openExternalDestination(terms, 'Terms of Use')} style={styles.link}>Terms of Use</Text><Text accessibilityRole="link" onPress={() => void openExternalDestination(privacy, 'Privacy Policy')} style={styles.link}>Privacy Policy</Text></View>
    </View> : null}
    <View style={styles.card}><Text style={styles.cardTitle}>Automation</Text><Text style={styles.body}>Set up automatic lead follow-up and customer win-back SMS once Pro is active{Platform.OS === 'android' ? ', including missed-call recovery' : ''}.</Text><SecondaryButton fullWidth label="View automation" onPress={() => navigation.navigate('Automation')} /></View>
    {subscription ? <View style={styles.card}>
      <Text style={styles.cardTitle}>Coming to Chakusa</Text>
      <Text style={styles.body}>Capabilities we're building next. Nothing to set up yet.</Text>
      {FUTURE_CAPABILITIES.map((capability) => {
        const unlocked = isCapabilityUnlocked(subscription.features, capability.key);
        return <View key={capability.key} style={styles.feature}>
          <Ionicons name={unlocked ? 'checkmark-circle-outline' : 'time-outline'} size={20} color={unlocked ? colors.primary : colors.textSecondary} />
          <View style={styles.featureCopy}>
            <Text style={styles.featureText}>{capability.label}</Text>
            <Text style={styles.featureDetail}>{capability.description}</Text>
            <Text style={styles.featureStatus}>{capabilityStatusCopy(subscription.features, capability.key)}</Text>
          </View>
        </View>;
      })}
    </View> : null}
    <Text style={styles.footnote}>The localized price and introductory offer shown by your App Store or Google Play account are the purchase authority.</Text>
  </Screen>;
}
const styles = StyleSheet.create({ card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm }, statusCard: { borderColor: colors.success }, purchase: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, padding: spacing.lg, gap: spacing.md }, planChoices: { gap: spacing.sm }, cardTitle: { ...typography.subheading, color: colors.text }, feature: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }, featureText: { ...typography.body, color: colors.text, flex: 1 }, featureCopy: { flex: 1, gap: 2 }, featureDetail: { ...typography.caption, color: colors.textSecondary }, featureStatus: { ...typography.caption, color: colors.textSecondary, fontStyle: 'italic' }, body: { ...typography.body, color: colors.textSecondary }, price: { alignItems: 'center', paddingVertical: spacing.sm }, priceValue: { fontSize: 36, lineHeight: 44, fontWeight: '700', color: colors.text }, pricePeriod: { ...typography.body, color: colors.textSecondary }, offer: { ...typography.bodyStrong, color: colors.text }, dev: { ...typography.caption, color: colors.textSecondary }, legal: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg }, link: { ...typography.bodyStrong, color: colors.primary, minHeight: 44, textAlignVertical: 'center' }, message: { ...typography.body, color: colors.text }, error: { ...typography.body, color: colors.negative }, footnote: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' } });
