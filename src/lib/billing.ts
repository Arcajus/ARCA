'use client';
/**
 * Intégration Google Play Billing via RevenueCat.
 *
 * Avant de l'activer :
 *   1. npm install @revenuecat/purchases-capacitor
 *   2. npx cap sync android
 *   3. Créer un projet sur https://app.revenuecat.com
 *   4. Remplacer REVENUECAT_API_KEY par la clé publique Android de votre app RevenueCat
 *   5. Dans RevenueCat Dashboard : créer les Entitlements "premium" et "pro",
 *      puis les Offerings "nexus_plus" et "nexus_pro" liés aux produits Play Console.
 *   6. Dans Google Play Console → Monétisation → Abonnements : créer les produits
 *      avec les IDs définis dans PRODUCT_IDS ci-dessous.
 */
import { registerPlugin, Capacitor } from '@capacitor/core';

// Interface minimale du SDK RevenueCat Capacitor
// (types complets disponibles après npm install @revenuecat/purchases-capacitor)
interface CustomerInfo {
  entitlements: {
    active: Record<string, { isActive: boolean; productIdentifier: string }>;
  };
}
interface PurchasesPlugin {
  configure(opts: { apiKey: string }): Promise<void>;
  getCustomerInfo(): Promise<{ customerInfo: CustomerInfo }>;
  purchasePackage(opts: {
    aPackage: { identifier: string; offeringIdentifier: string };
  }): Promise<{ customerInfo: CustomerInfo }>;
  restorePurchases(): Promise<{ customerInfo: CustomerInfo }>;
}

// registerPlugin permet d'appeler le plugin natif sans importer son package npm
// (utile en phase de skeleton — remplacer par l'import direct une fois installé).
const Purchases = registerPlugin<PurchasesPlugin>('CapacitorPurchases');

// Clé publique RevenueCat Android — remplacer avant la mise en production.
export const REVENUECAT_API_KEY = 'appl_REMPLACER_PAR_VOTRE_CLE_REVENUECAT';

// Identifiants des offres RevenueCat (à créer dans le dashboard RevenueCat → Offerings)
export const OFFERINGS = {
  plus: 'nexus_plus',
  pro: 'nexus_pro',
} as const;

// Identifiants produits Google Play Console (Monétisation → Abonnements)
export const PRODUCT_IDS = {
  plus_monthly:  'nexus_plus_mensuel',
  plus_yearly:   'nexus_plus_annuel',
  pro_monthly:   'nexus_pro_mensuel',
  pro_yearly:    'nexus_pro_annuel',
} as const;

function applyEntitlements(active: Record<string, { isActive: boolean }>) {
  if (typeof window === 'undefined') return;
  const hasPremium = 'premium' in active || 'pro' in active;
  const hasPro = 'pro' in active;
  if (hasPremium) localStorage.setItem('nexus_premium', 'true');
  if (hasPro) localStorage.setItem('nexus_mod', 'true');
}

/** Initialiser RevenueCat au démarrage de l'app et synchroniser les droits. */
export async function initBilling(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await Purchases.configure({ apiKey: REVENUECAT_API_KEY });
    const { customerInfo } = await Purchases.getCustomerInfo();
    applyEntitlements(customerInfo.entitlements.active);
  } catch (e) {
    console.warn('[Billing] init:', e);
  }
}

/**
 * Lancer l'achat d'un plan.
 * @param offeringId  Identifiant de l'offre RevenueCat (OFFERINGS.plus ou OFFERINGS.pro)
 * @returns 'success' | 'cancelled' | 'error'
 */
export async function purchasePlan(
  offeringId: string
): Promise<'success' | 'cancelled' | 'error'> {
  // Sur web / dev : simulation d'achat immédiate (mode démo)
  if (!Capacitor.isNativePlatform()) {
    if (typeof window !== 'undefined') {
      localStorage.setItem('nexus_premium', 'true');
      if (offeringId === OFFERINGS.pro) localStorage.setItem('nexus_mod', 'true');
    }
    return 'success';
  }
  try {
    const { customerInfo } = await Purchases.purchasePackage({
      aPackage: { identifier: '$rc_monthly', offeringIdentifier: offeringId },
    });
    applyEntitlements(customerInfo.entitlements.active);
    return 'success';
  } catch (e: unknown) {
    if (
      e &&
      typeof e === 'object' &&
      'userCancelled' in e &&
      (e as { userCancelled: boolean }).userCancelled
    ) {
      return 'cancelled';
    }
    console.warn('[Billing] purchase:', e);
    return 'error';
  }
}

/** Restaurer les achats existants (ex : réinstallation de l'app). */
export async function restorePurchases(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const { customerInfo } = await Purchases.restorePurchases();
    const active = customerInfo.entitlements.active;
    applyEntitlements(active);
    return 'premium' in active || 'pro' in active;
  } catch (e) {
    console.warn('[Billing] restore:', e);
    return false;
  }
}
