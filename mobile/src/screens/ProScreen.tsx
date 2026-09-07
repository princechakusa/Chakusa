import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton, SecondaryButton } from '../components/ui';
import { Chip, Icon, M3Header, M3Screen } from '../experience/businessKit';
import { m3, m3Radius, m3Space, m3Type } from '../experience/businessTheme';
import { BILLING_ENABLED, PRIVACY_POLICY_URL, TERMS_OF_USE_URL } from '../config';
import { canPurchasePlan, isEntitledStatus, subscriptionPeriodCopy, subscriptionStatusLabel } from '../domain/billing';
import { capabilityStatusCopy, FUTURE_CAPABILITIES, isCapabilityUnlocked } from '../domain/futureCapabilities';
import { trialProgressCopy } from '../domain/trialExperience';
import { legalDestination } from '../domain/trustSettings';
import { openExternalDestination } from '../services/externalDestinations';
import { useBilling } from '../state/BillingContext';
import { useAuth } from '../state/AuthContext';
import { usePlanExperience } from '../state/PlanExperienceContext';
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
  return <M3Screen header={<M3Header businessName="More" onBack={() => navigation.goBack()} onNotificationsPress={() => navigation.navigate('AttentionCenter')} onAvatarPress={() => navigation.navigate('Main', { screen: 'Settings' })} hasNotifications={false} />}>
    <View style={styles.titleBlock}>
      <View style={styles.titleRow}>
        <Text style={styles.pageTitle}>Subscription & Billing</Text>
        {entitled && statusLabel ? <Chip label={statusLabel} tone="secondary" /> : null}
      </View>
      <Text style={styles.pageSubtitle}>The recorded revenue, completed work, and follow-up Chakusa is creating for your business.</Text>
    </View>
    <View style={styles.card}>{benefits.map(item => <View key={item} style={styles.feature}><Icon name="check_circle" size={20} color={m3.primary} /><Text style={styles.featureText}>{item}</Text></View>)}</View>
    {trialProgress ? <View style={styles.purchase}><Text style={styles.cardTitle}>{trialProgress.title}</Text><Text style={styles.body}>{trialProgress.message}</Text><Text style={styles.body}>Trial access and its end date come directly from your app store subscription.</Text></View> : null}
    {subscription?.value ? <View style={[styles.card, styles.statusCard]}><Text style={styles.cardTitle}>Value created this month</Text><Text style={styles.body}>Recorded outcomes from Chakusa activity - not projections.</Text><Text style={styles.featureText}>{formatMoney(subscription.value.recoveredRevenueThisMonth, business?.currency ?? 'USD')} recovered</Text><Text style={styles.featureText}>{subscription.value.completedAppointmentsThisMonth} appointments completed</Text><Text style={styles.featureText}>{subscription.value.customerMessagesSentThisMonth} customer messages sent</Text><Text style={styles.featureText}>{subscription.value.reviewsReceivedThisMonth} reviews received</Text><Text style={styles.featureText}>{formatMoney(subscription.value.scheduledAppointmentValue, business?.currency ?? 'USD')} upcoming booked value</Text></View> : null}
    <View style={styles.card}><Text style={styles.cardTitle}>Chakusa Business</Text><Text style={styles.body}>Run Chakusa with your team.</Text>{['Everything in Pro','Up to 10 team members','Team invitations','Admin and Staff roles','Team access controls'].map(item => <View key={item} style={styles.feature}><Icon name="group" size={20} color={m3.primary} /><Text style={styles.featureText}>{item}</Text></View>)}{role === 'OWNER' && canPurchasePlan(plan, status, 'BUSINESS') ? <PrimaryButton fullWidth disabled={billing.purchasing || billing.restoring} label={billing.selectedPlan === 'BUSINESS' ? 'Business selected' : 'Choose Business'} onPress={() => billing.selectPlan('BUSINESS')} /> : null}<SecondaryButton fullWidth label="View Team" onPress={() => navigation.navigate('Team')} /></View>
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
          <Icon name={unlocked ? "check_circle" : "schedule"} size={20} color={unlocked ? m3.primary : m3.onSurfaceVariant} />
          <View style={styles.featureCopy}>
            <Text style={styles.featureText}>{capability.label}</Text>
            <Text style={styles.featureDetail}>{capability.description}</Text>
            <Text style={styles.featureStatus}>{capabilityStatusCopy(subscription.features, capability.key)}</Text>
          </View>
        </View>;
      })}
    </View> : null}
    <Text style={styles.footnote}>The localized price and introductory offer shown by your App Store or Google Play account are the purchase authority.</Text>
  </M3Screen>;
}
const styles = StyleSheet.create({
  titleBlock: { gap: 2 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  pageTitle: { ...m3Type.headlineMd, color: m3.onSurface },
  pageSubtitle: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  card: { backgroundColor: m3.surfaceContainerLowest, borderRadius: m3Radius.lg, padding: m3Space.md, gap: m3Space.sm },
  statusCard: { backgroundColor: "rgba(134,242,228,0.25)" },
  purchase: { backgroundColor: m3.surfaceContainerLowest, borderWidth: 1, borderColor: m3.primary, borderRadius: m3Radius.lg, padding: m3Space.md, gap: m3Space.sm },
  planChoices: { gap: m3Space.xs },
  cardTitle: { ...m3Type.titleMd, color: m3.onSurface },
  feature: { flexDirection: "row", alignItems: "flex-start", gap: m3Space.xs },
  featureText: { ...m3Type.bodyMd, color: m3.onSurface, flex: 1 },
  featureCopy: { flex: 1, gap: 2 },
  featureDetail: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  featureStatus: { ...m3Type.bodySm, color: m3.onSurfaceVariant, fontStyle: "italic" },
  body: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  price: { alignItems: "center", paddingVertical: m3Space.sm },
  priceValue: { ...m3Type.displayMobile, fontSize: 34, lineHeight: 40, color: m3.onSurface },
  pricePeriod: { ...m3Type.bodyMd, color: m3.onSurfaceVariant },
  offer: { ...m3Type.labelLg, color: m3.onSurface },
  dev: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  legal: { flexDirection: "row", flexWrap: "wrap", gap: m3Space.md },
  link: { ...m3Type.labelMd, color: m3.primary, minHeight: 44, textAlignVertical: "center" },
  message: { ...m3Type.bodyMd, color: m3.onSurface },
  error: { ...m3Type.bodyMd, color: m3.error },
  footnote: { ...m3Type.bodySm, color: m3.onSurfaceVariant, textAlign: "center" },
});
