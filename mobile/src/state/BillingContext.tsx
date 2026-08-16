import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { deepLinkToSubscriptions, ErrorCode, getAvailablePurchases, ProductSubscription, Purchase, useIAP } from 'expo-iap';
import { APPLE_PRO_MONTHLY_PRODUCT_ID, BILLING_ENABLED, GOOGLE_PRO_MONTHLY_PRODUCT_ID } from '../config';
import { billingErrorKind, billingMessage, BillingPlatform, canNativeSubscribe, isEntitledStatus, productConfigured, productIdForPlatform } from '../domain/billing';
import { ApiError } from '../services/api';
import { subscriptionApi } from '../services/endpoints';
import { useAuth } from './AuthContext';
import { usePlanExperience } from './PlanExperienceContext';

export interface BillingProduct { id: string; displayPrice: string; title: string; description: string; introductoryOffer: string | null; }
interface BillingValue {
  platform: BillingPlatform; supported: boolean; configured: boolean; connected: boolean; product: BillingProduct | null;
  productLoading: boolean; purchasing: boolean; restoring: boolean; message: string | null; error: string | null;
  loadProduct: () => Promise<void>; subscribe: () => Promise<void>; restore: () => Promise<void>; retryVerification: () => Promise<void>; manage: () => Promise<void>; clearMessage: () => void;
}
const BillingContext = createContext<BillingValue | null>(null);

const platform = (Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : Platform.OS === 'web' ? 'web' : 'unsupported') as BillingPlatform;
const emptyValue = (overrides: Partial<BillingValue> = {}): BillingValue => ({ platform, supported: false, configured: false, connected: false, product: null, productLoading: false, purchasing: false, restoring: false, message: null, error: null, loadProduct: async () => undefined, subscribe: async () => undefined, restore: async () => undefined, retryVerification: async () => undefined, manage: async () => undefined, clearMessage: () => undefined, ...overrides });

export function BillingProvider({ children }: PropsWithChildren) {
  if (!BILLING_ENABLED) return <BillingContext.Provider value={emptyValue()}>{children}</BillingContext.Provider>;
  if (!canNativeSubscribe(platform)) return <BillingContext.Provider value={emptyValue()}>{children}</BillingContext.Provider>;
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return <BillingContext.Provider value={emptyValue({ platform, configured: productConfigured(platform, APPLE_PRO_MONTHLY_PRODUCT_ID, GOOGLE_PRO_MONTHLY_PRODUCT_ID), error: 'Native subscriptions require a Chakusa development build.' })}>{children}</BillingContext.Provider>;
  return <NativeBillingProvider>{children}</NativeBillingProvider>;
}

function NativeBillingProvider({ children }: PropsWithChildren) {
  const { status: authStatus, role } = useAuth();
  const { refresh: refreshPlan } = usePlanExperience();
  const configured = productConfigured(platform, APPLE_PRO_MONTHLY_PRODUCT_ID, GOOGLE_PRO_MONTHLY_PRODUCT_ID);
  const productId = productIdForPlatform(platform, APPLE_PRO_MONTHLY_PRODUCT_ID, GOOGLE_PRO_MONTHLY_PRODUCT_ID);
  const [productLoading, setProductLoading] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingProof = useRef<Purchase | null>(null);
  const productRef = useRef<ProductSubscription | null>(null);
  const purchaseHandler = useRef<(purchase: Purchase) => Promise<void>>(async () => undefined);

  const iap = useIAP({
    onPurchaseSuccess: purchase => { void purchaseHandler.current(purchase); },
    onPurchaseError: caught => {
      setPurchasing(false);
      const kind = billingErrorKind(caught.code);
      setError(billingMessage(kind));
      if (kind === 'pending') setMessage(billingMessage(kind));
    },
    onError: () => setError('The store is unavailable. Please try again.'),
  });
  const { connected, fetchProducts, finishTransaction, reconnect, requestPurchase, subscriptions } = iap;

  const storeProduct = subscriptions.find(item => item.id === productId) ?? null;
  productRef.current = storeProduct;
  const product = useMemo<BillingProduct | null>(() => {
    if (!storeProduct) return null;
    const intro = storeProduct.subscriptionOffers?.find(offer => offer.type === 'introductory');
    return { id: storeProduct.id, displayPrice: storeProduct.displayPrice, title: storeProduct.title, description: storeProduct.description, introductoryOffer: intro?.displayPrice ?? (storeProduct.platform === 'ios' ? storeProduct.introductoryPriceIOS ?? null : null) };
  }, [storeProduct]);

  const loadProduct = useCallback(async () => {
    if (!configured) { setError(platform === 'ios' ? 'Apple Pro monthly product is not configured.' : 'Google Pro monthly product is not configured.'); return; }
    if (!connected) { setProductLoading(true); setError(null); try { const ready = await reconnect(); if (!ready) setError('The store is unavailable. Please try again.'); } catch { setError('The store is unavailable. Please try again.'); } finally { setProductLoading(false); } return; }
    setProductLoading(true); setError(null);
    try { await fetchProducts({ skus: [productId], type: 'subs' }); }
    catch { setError('Chakusa Pro could not be loaded from the store.'); }
    finally { setProductLoading(false); }
  }, [configured, connected, fetchProducts, productId, reconnect]);

  useEffect(() => { if (authStatus === 'authenticated' && configured && connected) void loadProduct(); }, [authStatus, configured, connected, loadProduct]);
  useEffect(() => { if (authStatus === 'anonymous') { pendingProof.current = null; setPurchasing(false); setRestoring(false); setMessage(null); setError(null); } }, [authStatus]);

  const verify = useCallback(async (purchase: Purchase) => {
    if (role !== 'OWNER') return false;
    if (purchase.productId !== productId) return false;
    if (purchase.purchaseState === 'pending') { setMessage('Your purchase is pending approval from the store.'); return false; }
    try {
      const next = platform === 'ios'
        ? purchase.transactionId ? await subscriptionApi.verifyApple(purchase.transactionId) : (() => { throw new Error('Missing purchase proof'); })()
        : purchase.purchaseToken ? await subscriptionApi.verifyGoogle(purchase.purchaseToken) : (() => { throw new Error('Missing purchase proof'); })();
      if (!isEntitledStatus(next.status)) { pendingProof.current = purchase; setError('Your purchase was received, but Chakusa could not confirm it yet.'); return false; }
      await refreshPlan();
      if (platform === 'ios') await finishTransaction({ purchase, isConsumable: false });
      pendingProof.current = null; setError(null); setMessage('Chakusa Pro is active.'); return true;
    } catch (caught) {
      pendingProof.current = purchase;
      const conflict = caught instanceof ApiError && caught.kind === 'conflict';
      setError(conflict ? 'This subscription is already connected to another Chakusa business.' : 'Your purchase was received, but Chakusa could not confirm it yet.');
      return false;
    }
  }, [finishTransaction, productId, refreshPlan, role]);
  purchaseHandler.current = async purchase => { try { await verify(purchase); } finally { setPurchasing(false); } };

  const subscribe = useCallback(async () => {
    if (purchasing || restoring) return;
    const selected = productRef.current;
    if (!selected) { setError('Load Chakusa Pro from the store before subscribing.'); return; }
    setPurchasing(true); setError(null); setMessage(null);
    try {
      const offerToken = selected.platform === 'android' ? selected.subscriptionOffers.find(offer => offer.offerTokenAndroid)?.offerTokenAndroid : undefined;
      await requestPurchase({ type: 'subs', request: platform === 'ios' ? { apple: { sku: selected.id } } : { google: { skus: [selected.id], subscriptionOffers: offerToken ? [{ sku: selected.id, offerToken }] : [] } } });
    } catch (caught) {
      setPurchasing(false);
      const code = caught && typeof caught === 'object' && 'code' in caught ? String(caught.code) : ErrorCode.Unknown;
      const kind = billingErrorKind(code); setError(billingMessage(kind));
    }
  }, [purchasing, requestPurchase, restoring]);

  const restore = useCallback(async () => {
    if (restoring || purchasing) return;
    setRestoring(true); setError(null); setMessage(null);
    try {
      const owned = (await getAvailablePurchases({ onlyIncludeActiveItemsIOS: true })).filter(item => item.productId === productId);
      if (!owned.length) { setMessage('No Chakusa Pro subscription was found for this store account.'); return; }
      let restored = false;
      for (const purchase of owned) restored = await verify(purchase) || restored;
      if (restored) setMessage('Chakusa Pro was restored.');
    } catch { setError('Purchases could not be restored. Please try again.'); }
    finally { setRestoring(false); }
  }, [productId, purchasing, restoring, verify]);
  const retryVerification = useCallback(async () => { if (pendingProof.current) { setPurchasing(true); try { await verify(pendingProof.current); } finally { setPurchasing(false); } } else await restore(); }, [restore, verify]);
  const manage = useCallback(async () => { try { await deepLinkToSubscriptions(platform === 'android' ? { skuAndroid: productId } : undefined); } catch { setError('Subscription management could not be opened.'); } }, [productId]);
  const value = useMemo<BillingValue>(() => ({ platform, supported: true, configured, connected, product, productLoading, purchasing, restoring, message, error, loadProduct, subscribe, restore, retryVerification, manage, clearMessage: () => { setMessage(null); setError(null); } }), [configured, connected, error, loadProduct, manage, message, product, productLoading, purchasing, restore, restoring, retryVerification, subscribe]);
  return <BillingContext.Provider value={value}>{children}</BillingContext.Provider>;
}

export function useBilling() { const value = useContext(BillingContext); if (!value) throw new Error('useBilling must be used within BillingProvider'); return value; }
