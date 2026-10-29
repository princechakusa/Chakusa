import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import type { ProductSubscription, Purchase } from 'expo-iap';
import { APPLE_BUSINESS_MONTHLY_PRODUCT_ID, APPLE_PRO_MONTHLY_PRODUCT_ID, APPLE_STARTER_MONTHLY_PRODUCT_ID, BILLING_ENABLED, GOOGLE_BUSINESS_MONTHLY_PRODUCT_ID, GOOGLE_PRO_MONTHLY_PRODUCT_ID, GOOGLE_STARTER_MONTHLY_PRODUCT_ID } from '../config';
import { BILLING_PLANS, billingErrorKind, billingMessage, BillingPlan, BillingPlatform, canNativeSubscribe, isEntitledStatus, planName, productIdForPlatform } from '../domain/billing';
import { ApiError } from '../services/api';
import { subscriptionApi } from '../services/endpoints';
import { useAuth } from './AuthContext';
import { usePlanExperience } from './PlanExperienceContext';

/** A store product as the App Store / Google Play presents it: price and trial are always the store's own, localized. */
export interface BillingProduct { id: string; displayPrice: string; title: string; description: string; introductoryOffer: string | null; }
type ProductMap = Record<BillingPlan, BillingProduct | null>;
interface BillingValue {
  platform: BillingPlatform; supported: boolean; connected: boolean;
  /** Store product per plan; null while loading, when unconfigured, or when the store does not offer it. */
  products: ProductMap;
  /** Plans this build has a store product ID for. */
  configuredPlans: BillingPlan[];
  productLoading: boolean;
  /** The plan a purchase is in flight for. */
  purchasingPlan: BillingPlan | null; restoring: boolean; message: string | null; error: string | null;
  loadProducts: () => Promise<void>; subscribe: (plan: BillingPlan) => Promise<void>; restore: () => Promise<void>; retryVerification: () => Promise<void>; manage: () => Promise<void>; clearMessage: () => void;
}
const BillingContext = createContext<BillingValue | null>(null);

const platform = (Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : Platform.OS === 'web' ? 'web' : 'unsupported') as BillingPlatform;
const NO_PRODUCTS: ProductMap = { STARTER: null, PRO: null, BUSINESS: null };
const PRODUCT_IDS: Record<BillingPlan, string> = {
  STARTER: productIdForPlatform(platform, APPLE_STARTER_MONTHLY_PRODUCT_ID, GOOGLE_STARTER_MONTHLY_PRODUCT_ID),
  PRO: productIdForPlatform(platform, APPLE_PRO_MONTHLY_PRODUCT_ID, GOOGLE_PRO_MONTHLY_PRODUCT_ID),
  BUSINESS: productIdForPlatform(platform, APPLE_BUSINESS_MONTHLY_PRODUCT_ID, GOOGLE_BUSINESS_MONTHLY_PRODUCT_ID),
};
const CONFIGURED_PLANS = BILLING_PLANS.filter((plan) => Boolean(PRODUCT_IDS[plan]));
const planForProduct = (productId: string) => BILLING_PLANS.find((plan) => PRODUCT_IDS[plan] === productId) ?? null;

const emptyValue = (overrides: Partial<BillingValue> = {}): BillingValue => ({ platform, supported: false, connected: false, products: NO_PRODUCTS, configuredPlans: CONFIGURED_PLANS, productLoading: false, purchasingPlan: null, restoring: false, message: null, error: null, loadProducts: async () => undefined, subscribe: async () => undefined, restore: async () => undefined, retryVerification: async () => undefined, manage: async () => undefined, clearMessage: () => undefined, ...overrides });

export function BillingProvider({ children }: PropsWithChildren) {
  if (!BILLING_ENABLED || !canNativeSubscribe(platform)) return <BillingContext.Provider value={emptyValue()}>{children}</BillingContext.Provider>;
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return <BillingContext.Provider value={emptyValue({ error: 'Native subscriptions require a Chakusa development build.' })}>{children}</BillingContext.Provider>;
  return <NativeBillingProvider>{children}</NativeBillingProvider>;
}

function toProduct(storeProduct: ProductSubscription): BillingProduct {
  const intro = storeProduct.subscriptionOffers?.find((offer) => offer.type === 'introductory');
  return { id: storeProduct.id, displayPrice: storeProduct.displayPrice, title: storeProduct.title, description: storeProduct.description, introductoryOffer: intro?.displayPrice ?? (storeProduct.platform === 'ios' ? storeProduct.introductoryPriceIOS ?? null : null) };
}

function NativeBillingProvider({ children }: PropsWithChildren) {
  // Expo Go takes the unsupported branch above without importing native IAP.
  const { deepLinkToSubscriptions, ErrorCode, getAvailablePurchases, useIAP } = require('expo-iap') as typeof import('expo-iap');
  const { status: authStatus, role } = useAuth();
  const { refresh: refreshPlan } = usePlanExperience();
  const configuredIds = useMemo(() => CONFIGURED_PLANS.map((plan) => PRODUCT_IDS[plan]), []);
  const [productLoading, setProductLoading] = useState(false);
  const [purchasingPlan, setPurchasingPlan] = useState<BillingPlan | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingProof = useRef<Purchase | null>(null);
  const purchaseHandler = useRef<(purchase: Purchase) => Promise<void>>(async () => undefined);

  const iap = useIAP({
    onPurchaseSuccess: (purchase) => { void purchaseHandler.current(purchase); },
    onPurchaseError: (caught) => {
      setPurchasingPlan(null);
      const kind = billingErrorKind(caught.code);
      setError(billingMessage(kind));
      if (kind === 'pending') setMessage(billingMessage(kind));
    },
    onError: () => setError('The store is unavailable. Please try again.'),
  });
  const { connected, fetchProducts, finishTransaction, reconnect, requestPurchase, subscriptions } = iap;

  const storeProducts = useMemo(() => {
    const byPlan: Record<BillingPlan, ProductSubscription | null> = { STARTER: null, PRO: null, BUSINESS: null };
    for (const product of subscriptions) { const plan = planForProduct(product.id); if (plan) byPlan[plan] = product; }
    return byPlan;
  }, [subscriptions]);
  const products = useMemo<ProductMap>(() => ({
    STARTER: storeProducts.STARTER ? toProduct(storeProducts.STARTER) : null,
    PRO: storeProducts.PRO ? toProduct(storeProducts.PRO) : null,
    BUSINESS: storeProducts.BUSINESS ? toProduct(storeProducts.BUSINESS) : null,
  }), [storeProducts]);

  const loadProducts = useCallback(async () => {
    if (!configuredIds.length) { setError('Subscriptions are not set up for this store yet.'); return; }
    setProductLoading(true); setError(null);
    try {
      if (!connected) { const ready = await reconnect(); if (!ready) { setError('The store is unavailable. Please try again.'); return; } }
      await fetchProducts({ skus: configuredIds, type: 'subs' });
    } catch { setError('Chakusa plans could not be loaded from the store.'); }
    finally { setProductLoading(false); }
  }, [configuredIds, connected, fetchProducts, reconnect]);

  useEffect(() => { if (authStatus === 'authenticated' && configuredIds.length && connected) void loadProducts(); }, [authStatus, configuredIds.length, connected, loadProducts]);
  useEffect(() => { if (authStatus === 'anonymous') { pendingProof.current = null; setPurchasingPlan(null); setRestoring(false); setMessage(null); setError(null); } }, [authStatus]);

  const verify = useCallback(async (purchase: Purchase) => {
    if (role !== 'OWNER') return false;
    const plan = planForProduct(purchase.productId);
    if (!plan) return false;
    if (purchase.purchaseState === 'pending') { setMessage('Your purchase is pending approval from the store.'); return false; }
    try {
      const next = platform === 'ios'
        ? purchase.transactionId ? await subscriptionApi.verifyApple(purchase.transactionId) : (() => { throw new Error('Missing purchase proof'); })()
        : purchase.purchaseToken ? await subscriptionApi.verifyGoogle(purchase.purchaseToken) : (() => { throw new Error('Missing purchase proof'); })();
      if (!isEntitledStatus(next.status)) { pendingProof.current = purchase; setError('Your purchase was received, but Chakusa could not confirm it yet.'); return false; }
      await refreshPlan();
      if (platform === 'ios') await finishTransaction({ purchase, isConsumable: false });
      pendingProof.current = null; setError(null); setMessage(`Chakusa ${planName(plan)} is active.`); return true;
    } catch (caught) {
      pendingProof.current = purchase;
      const conflict = caught instanceof ApiError && caught.kind === 'conflict';
      setError(conflict ? 'This subscription is already connected to another Chakusa business.' : 'Your purchase was received, but Chakusa could not confirm it yet.');
      return false;
    }
  }, [finishTransaction, refreshPlan, role]);
  purchaseHandler.current = async (purchase) => { try { await verify(purchase); } finally { setPurchasingPlan(null); } };

  const subscribe = useCallback(async (plan: BillingPlan) => {
    if (purchasingPlan || restoring) return;
    const selected = storeProducts[plan];
    if (!selected) { setError(`Chakusa ${planName(plan)} is not available from the store right now.`); return; }
    setPurchasingPlan(plan); setError(null); setMessage(null);
    try {
      const offerToken = selected.platform === 'android' ? selected.subscriptionOffers.find((offer) => offer.offerTokenAndroid)?.offerTokenAndroid : undefined;
      await requestPurchase({ type: 'subs', request: platform === 'ios' ? { apple: { sku: selected.id } } : { google: { skus: [selected.id], subscriptionOffers: offerToken ? [{ sku: selected.id, offerToken }] : [] } } });
    } catch (caught) {
      setPurchasingPlan(null);
      const code = caught && typeof caught === 'object' && 'code' in caught ? String(caught.code) : ErrorCode.Unknown;
      setError(billingMessage(billingErrorKind(code)));
    }
  }, [purchasingPlan, requestPurchase, restoring, storeProducts]);

  const restore = useCallback(async () => {
    if (restoring || purchasingPlan) return;
    setRestoring(true); setError(null); setMessage(null);
    try {
      const owned = (await getAvailablePurchases({ onlyIncludeActiveItemsIOS: true })).filter((item) => configuredIds.includes(item.productId));
      if (!owned.length) { setMessage('No active Chakusa subscription was found for this store account.'); return; }
      let restored = false;
      for (const purchase of owned) restored = (await verify(purchase)) || restored;
      if (restored) setMessage('Your Chakusa subscription was restored.');
    } catch { setError('Purchases could not be restored. Please try again.'); }
    finally { setRestoring(false); }
  }, [configuredIds, purchasingPlan, restoring, verify]);
  const retryVerification = useCallback(async () => {
    const proof = pendingProof.current;
    if (!proof) { await restore(); return; }
    setPurchasingPlan(planForProduct(proof.productId)); try { await verify(proof); } finally { setPurchasingPlan(null); }
  }, [restore, verify]);
  // Downgrades and cancellations are store-managed; the store's own screen also lists every plan.
  const manage = useCallback(async () => { try { await deepLinkToSubscriptions(platform === 'android' ? { skuAndroid: configuredIds[0] } : undefined); } catch { setError('Subscription management could not be opened.'); } }, [configuredIds]);
  const value = useMemo<BillingValue>(() => ({ platform, supported: true, connected, products, configuredPlans: CONFIGURED_PLANS, productLoading, purchasingPlan, restoring, message, error, loadProducts, subscribe, restore, retryVerification, manage, clearMessage: () => { setMessage(null); setError(null); } }), [connected, error, loadProducts, manage, message, productLoading, products, purchasingPlan, restore, restoring, retryVerification, subscribe]);
  return <BillingContext.Provider value={value}>{children}</BillingContext.Provider>;
}

export function useBilling() { const value = useContext(BillingContext); if (!value) throw new Error('useBilling must be used within BillingProvider'); return value; }
