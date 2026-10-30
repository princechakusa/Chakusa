import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { PlansDto } from '../apiTypes';
import { Chip, Icon, M3Header, M3Screen } from '../experience/businessKit';
import { m3, m3Radius, m3Space, m3Type } from '../experience/businessTheme';
import { BILLING_ENABLED, PRIVACY_POLICY_URL, TERMS_OF_USE_URL } from '../config';
import { BILLING_PLANS, BillingPlan, effectivePlan, planAction, planName, subscriptionPeriodCopy, subscriptionStatusLabel } from '../domain/billing';
import { planButtonLabel, planHighlights, PLAN_TAGLINES, referencePrice, renewalTerms, trialLabel } from '../domain/planCatalog';
import { legalDestination } from '../domain/trustSettings';
import { openExternalDestination } from '../services/externalDestinations';
import { subscriptionApi } from '../services/endpoints';
import { useBilling } from '../state/BillingContext';
import { useAuth } from '../state/AuthContext';
import { usePlanExperience } from '../state/PlanExperienceContext';
import { RootStackParamList } from '../types';

const RECOMMENDED: BillingPlan = 'PRO';

/** Subscription & billing: your plan on top, every plan below with its live store price. */
export function ProScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { plan, status, subscription } = usePlanExperience();
  const billing = useBilling();
  const { role } = useAuth();
  const [plansResponse, setPlansResponse] = useState<PlansDto | null>(null);
  const [catalogError, setCatalogError] = useState(false);
  const loadCatalog = useCallback(async () => {
    setCatalogError(false);
    try { setPlansResponse(await subscriptionApi.plans()); } catch { setCatalogError(true); }
  }, []);
  useEffect(() => { void loadCatalog(); }, [loadCatalog]);

  const catalog = plansResponse?.plans ?? null;
  const current = effectivePlan(plan, status);
  const owner = role === 'OWNER';
  const canBuyInApp = BILLING_ENABLED && billing.supported;
  const statusLabel = subscription && current !== 'FREE' ? subscriptionStatusLabel(subscription) : null;
  const period = subscription && current !== 'FREE' ? subscriptionPeriodCopy(subscription) : null;
  const privacy = legalDestination(PRIVACY_POLICY_URL); const terms = legalDestination(TERMS_OF_USE_URL);

  const onPlanPress = (target: BillingPlan) => {
    const action = planAction(plan, status, target);
    if (action === 'downgrade') void billing.manage();
    else if (action === 'subscribe' || action === 'upgrade') void billing.subscribe(target);
  };

  return <M3Screen header={<M3Header businessName="Account" onBack={() => navigation.goBack()} onNotificationsPress={() => navigation.navigate('AttentionCenter')} hasNotifications={false} />}>
    <View style={styles.titleBlock}>
      <Text style={styles.pageTitle}>Subscription</Text>
      <Text style={styles.pageSubtitle}>Your plan, and what each plan includes.</Text>
    </View>

    <View style={styles.hero} accessible accessibilityLabel={`Your plan: ${planName(current)}${statusLabel ? `, ${statusLabel}` : ''}${period ? `, ${period}` : ''}`}>
      <Text style={styles.heroEyebrow}>YOUR PLAN</Text>
      <View style={styles.heroRow}>
        <Text style={styles.heroPlan}>{planName(current)}</Text>
        {statusLabel ? <Chip label={statusLabel} tone={status === 'GRACE_PERIOD' ? 'error' : 'secondary'} /> : null}
      </View>
      <Text style={styles.heroBody}>{current === 'FREE' ? 'You are on the free plan. Pick a plan below to unlock more.' : period ?? 'Billed monthly through your app store.'}</Text>
      {status === 'GRACE_PERIOD' ? <Text style={styles.heroWarn}>Your store could not take the last payment. You keep access while it retries; update your payment method in the store.</Text> : null}
      {subscription?.cancelAtPeriodEnd && current !== 'FREE' ? <Text style={styles.heroWarn}>This plan will not renew. You keep it until the date above.</Text> : null}
      {owner && subscription?.provider ? <Pressable accessibilityRole="button" onPress={() => void billing.manage()} style={styles.heroLink}><Text style={styles.heroLinkText}>Manage or cancel in {billing.platform === 'ios' ? 'App Store' : 'Google Play'}</Text><Icon name="open_in_new" size={16} color={m3.onPrimary} /></Pressable> : null}
    </View>

    {!owner ? <Text style={styles.note}>Only the business owner can change the plan.</Text> : null}

    <Text style={styles.sectionTitle}>{current === 'FREE' ? 'Choose your plan' : 'All plans'}</Text>

    {catalogError ? <Pressable accessibilityRole="button" onPress={() => void loadCatalog()} style={styles.retry}><Text style={styles.retryText}>Plans could not be loaded. Tap to try again.</Text></Pressable> : null}
    {!catalog && !catalogError ? <ActivityIndicator color={m3.primary} style={{ marginVertical: m3Space.lg }} /> : null}

    {catalog ? BILLING_PLANS.map((target) => {
      const description = catalog.find((item) => item.plan === target);
      if (!description) return null;
      const product = billing.products[target];
      const action = planAction(plan, status, target);
      const isCurrent = action === 'current';
      const busy = billing.purchasingPlan === target;
      const fallbackPrice = plansResponse ? referencePrice(description.referenceMonthlyPrice, plansResponse.currency) : null;
      const trial = current === 'FREE' ? trialLabel(product?.introductoryOffer, description.trialDays, product?.displayPrice ?? fallbackPrice) : null;
      const unavailable = canBuyInApp && !billing.configuredPlans.includes(target);
      const disabled = !owner || isCurrent || busy || Boolean(billing.purchasingPlan) || billing.restoring || (action !== 'downgrade' && (!canBuyInApp || !product));
      return <View key={target} style={[styles.planCard, isCurrent && styles.planCardCurrent, target === RECOMMENDED && !isCurrent && styles.planCardRecommended]}>
        <View style={styles.planHead}>
          <View style={styles.planNameRow}>
            <Text style={styles.planName}>{planName(target)}</Text>
            {isCurrent ? <Chip label="Current" tone="secondary" /> : target === RECOMMENDED ? <Chip label="Most popular" tone="primary" /> : null}
          </View>
          <Text style={styles.planTagline}>{PLAN_TAGLINES[target]}</Text>
        </View>
        <View style={styles.priceRow}>
          {product ? <><Text style={styles.price}>{product.displayPrice}</Text><Text style={styles.pricePeriod}>/ month</Text></>
            : canBuyInApp && billing.productLoading ? <Text style={styles.priceMuted}>Loading store price…</Text>
            : fallbackPrice ? <><Text style={styles.price}>{fallbackPrice}</Text><Text style={styles.pricePeriod}>/ month</Text></>
            : <Text style={styles.priceMuted}>{unavailable ? 'Coming soon to this store' : canBuyInApp ? 'Store price unavailable' : 'Available in the Chakusa app'}</Text>}
        </View>
        {!product && fallbackPrice ? <Text style={styles.small}>{unavailable ? 'Coming soon to this store.' : canBuyInApp ? 'Your store shows the final price in your currency.' : 'Subscribe in the Chakusa app for iPhone or Android.'}</Text> : null}
        {trial ? <View style={styles.trialPill}><Icon name="celebration" size={14} color={m3.onSecondaryContainer} /><Text style={styles.trialText}>{trial}</Text></View> : null}
        <View style={styles.highlights}>
          {planHighlights(description).map((line) => <View key={line} style={styles.highlight}><Icon name="check" size={18} color={m3.primary} /><Text style={styles.highlightText}>{line}</Text></View>)}
        </View>
        {owner ? <Pressable accessibilityRole="button" accessibilityState={{ disabled, busy }} disabled={disabled} onPress={() => onPlanPress(target)} style={({ pressed }) => [styles.cta, (isCurrent || action === 'downgrade') ? styles.ctaQuiet : styles.ctaStrong, disabled && !isCurrent && styles.ctaDisabled, pressed && styles.pressed]}>
          {busy ? <ActivityIndicator color={m3.onPrimary} /> : <Text style={[styles.ctaText, (isCurrent || action === 'downgrade') && styles.ctaTextQuiet]}>{planButtonLabel(action, planName(target), current === 'FREE' ? description.trialDays : 0)}</Text>}
        </Pressable> : null}
        {action === 'downgrade' && owner ? <Text style={styles.small}>Changes apply at your next renewal, in your store's subscription settings.</Text> : null}
      </View>;
    }) : null}

    {billing.message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{billing.message}</Text> : null}
    {billing.error ? <Text accessibilityRole="alert" style={styles.error}>{billing.error}</Text> : null}
    {billing.error?.includes('could not confirm') ? <Pressable accessibilityRole="button" onPress={() => void billing.retryVerification()} style={styles.textButton}><Text style={styles.textButtonLabel}>Try confirming again</Text></Pressable> : null}
    {canBuyInApp && !billing.productLoading && billing.configuredPlans.some((p) => !billing.products[p]) ? <Pressable accessibilityRole="button" onPress={() => void billing.loadProducts()} style={styles.textButton}><Text style={styles.textButtonLabel}>Reload store prices</Text></Pressable> : null}

    {owner && canBuyInApp ? <Pressable accessibilityRole="button" disabled={billing.restoring || Boolean(billing.purchasingPlan)} onPress={() => void billing.restore()} style={styles.textButton}><Text style={styles.textButtonLabel}>{billing.restoring ? 'Restoring…' : 'Restore purchases'}</Text></Pressable> : null}

    <Text style={styles.footnote}>{renewalTerms(billing.platform)}</Text>
    <View style={styles.legal}>
      <Text accessibilityRole="link" onPress={() => void openExternalDestination(terms, 'Terms of Use')} style={styles.link}>Terms of Use</Text>
      <Text accessibilityRole="link" onPress={() => void openExternalDestination(privacy, 'Privacy Policy')} style={styles.link}>Privacy Policy</Text>
    </View>
  </M3Screen>;
}

const styles = StyleSheet.create({
  titleBlock: { gap: 2 },
  pageTitle: { ...m3Type.headlineMd, color: m3.onSurface },
  pageSubtitle: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  hero: { backgroundColor: m3.primary, borderRadius: m3Radius.xl, padding: m3Space.lg, gap: m3Space.xs },
  heroEyebrow: { ...m3Type.labelSm, color: m3.onPrimary, opacity: 0.8, letterSpacing: 1.2 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: m3Space.sm, flexWrap: 'wrap' },
  heroPlan: { ...m3Type.displayMobile, color: m3.onPrimary },
  heroBody: { ...m3Type.bodyMd, color: m3.onPrimary, opacity: 0.92 },
  heroWarn: { ...m3Type.bodySm, color: m3.onPrimary, fontFamily: m3Type.labelLg.fontFamily },
  heroLink: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, marginTop: m3Space.xs },
  heroLinkText: { ...m3Type.labelLg, color: m3.onPrimary, textDecorationLine: 'underline' },
  note: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  sectionTitle: { ...m3Type.titleMd, color: m3.onSurface, marginTop: m3Space.sm },
  retry: { padding: m3Space.md, borderRadius: m3Radius.lg, backgroundColor: m3.surfaceContainerLowest },
  retryText: { ...m3Type.bodyMd, color: m3.primary },
  planCard: { backgroundColor: m3.surfaceContainerLowest, borderRadius: m3Radius.xl, padding: m3Space.lg, gap: m3Space.sm, borderWidth: 1, borderColor: m3.outlineVariant },
  planCardRecommended: { borderColor: m3.primary, borderWidth: 2 },
  planCardCurrent: { borderColor: m3.tertiary, borderWidth: 2 },
  planHead: { gap: 2 },
  planNameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: m3Space.sm },
  planName: { ...m3Type.headlineMd, color: m3.onSurface },
  planTagline: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, minHeight: 40 },
  price: { ...m3Type.displayMobile, color: m3.onSurface },
  pricePeriod: { ...m3Type.bodyMd, color: m3.onSurfaceVariant },
  priceMuted: { ...m3Type.bodyMd, color: m3.onSurfaceVariant },
  trialPill: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: m3.secondaryContainer, borderRadius: m3Radius.full, paddingHorizontal: m3Space.sm, paddingVertical: 4 },
  trialText: { ...m3Type.labelMd, color: m3.onSecondaryContainer },
  highlights: { gap: 6 },
  highlight: { flexDirection: 'row', alignItems: 'flex-start', gap: m3Space.xs },
  highlightText: { ...m3Type.bodyMd, color: m3.onSurface, flex: 1 },
  cta: { minHeight: 50, borderRadius: m3Radius.full, alignItems: 'center', justifyContent: 'center', marginTop: m3Space.xs, paddingHorizontal: m3Space.md },
  ctaStrong: { backgroundColor: m3.primary },
  ctaQuiet: { backgroundColor: m3.surfaceContainer },
  ctaDisabled: { opacity: 0.45 },
  ctaText: { ...m3Type.labelLg, color: m3.onPrimary },
  ctaTextQuiet: { color: m3.onSurface },
  pressed: { opacity: 0.8 },
  small: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  message: { ...m3Type.bodyMd, color: m3.onSurface },
  error: { ...m3Type.bodyMd, color: m3.error },
  textButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  textButtonLabel: { ...m3Type.labelLg, color: m3.primary },
  footnote: { ...m3Type.bodySm, color: m3.onSurfaceVariant, textAlign: 'center' },
  legal: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: m3Space.lg },
  link: { ...m3Type.labelMd, color: m3.primary, minHeight: 44, textAlignVertical: 'center' },
});
