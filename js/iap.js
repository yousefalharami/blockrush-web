// Apple in-app purchases (iOS app only), via capacitor-plugin-cdv-purchase — the same plugin/version and vendored
// scripts as Letter Hive (js/vendor/capacitor-core.js + capacitor-purchase.js, loaded only in the native app).
// Every approved transaction is sent to the server (Edge Function verify-purchase), which asks Apple whether it is
// real and then credits the player (games or Unlimited). The transaction is only finished after the server says ok,
// so an interrupted purchase is verified again on the next launch. Ownership is never decided on the phone.
import { getClient } from "./net/supabase.js";
import { serverOn } from "./server.js";
import { refreshGames } from "./games.js";

export const PRODUCTS = {
  "com.blockrush.games5": "CONSUMABLE",
  "com.blockrush.games15": "CONSUMABLE",
  "com.blockrush.unlimited.monthly": "PAID_SUBSCRIPTION",
};
export const iapAvailable = () => window.Capacitor?.getPlatform?.() === "ios";   // Android (Google Play Billing) comes later

const listeners = new Set();
export const onIap = f => listeners.add(f);
const emit = e => listeners.forEach(f => { try { f(e); } catch {} });

const loadScript = src => new Promise((resolve, reject) => {
  const s = document.createElement("script");
  s.src = new URL(src, import.meta.url).href; s.onload = resolve; s.onerror = () => reject(new Error(`${src} failed to load`));
  document.head.appendChild(s);
});

let ready = null;
export function initIap() {
  if (!iapAvailable()) return Promise.resolve(false);
  return ready ??= (async () => {
    if (!window.capacitorExports) await loadScript("./vendor/capacitor-core.js");
    if (!window.CdvPurchase) await loadScript("./vendor/capacitor-purchase.js");
    const { store, CdvPurchase } = window, P = CdvPurchase.Platform.APPLE_APPSTORE;
    store.register(Object.entries(PRODUCTS).map(([id, type]) => ({ id, type: CdvPurchase.ProductType[type], platform: P })));
    store.when()
      .approved(tx => verifyAndFinish(tx))
      .productUpdated(() => emit({ type: "products" }));
    store.error(e => console.warn("iap:", e && (e.message || e.code)));
    await store.initialize([P]);
    emit({ type: "products" });
    return true;
  })().catch(e => { console.warn("iap init failed:", e.message || e); ready = null; return false; });
}

const verifying = new Set();
async function verifyAndFinish(tx) {
  const id = String(tx.transactionId || "");
  if (!/^\d+$/.test(id) || verifying.has(id)) return;   // skip the app-receipt pseudo transaction / duplicates
  if (!serverOn()) return;                            // stays unfinished → verified on a later launch
  verifying.add(id);
  try {
    const c = await getClient();
    const { data, error } = await c.functions.invoke("verify-purchase", { body: { transactionId: id } });
    if (error || !data?.ok) {
      if (data && (data.reason === "wrong_app" || data.reason === "unknown_product")) await tx.finish();
      emit({ type: "failed", reason: data?.reason || "server" });
      return;
    }
    await tx.finish();
    await refreshGames();
    emit({ type: "credited", ...data });
  } catch (e) {
    console.warn("iap verify failed:", e.message || e);
    emit({ type: "failed", reason: "server" });
  } finally { verifying.delete(id); }
}

// Localized price from the App Store (e.g. "QAR 3.99"); for subscriptions the recurring (last) phase.
export function priceOf(productId) {
  const { store, CdvPurchase } = window;
  if (!store || !CdvPurchase) return null;
  const phases = store.get(productId, CdvPurchase.Platform.APPLE_APPSTORE)?.offers?.[0]?.pricingPhases;
  return phases?.length ? phases[phases.length - 1].price : null;
}

// Products can take a moment to load from Apple after launch: wait up to ~3s for the offer.
async function findOffer(productId, tries = 10) {
  const { store, CdvPurchase } = window;
  for (let i = 0; i < tries; i++) {
    const offer = store.get(productId, CdvPurchase.Platform.APPLE_APPSTORE)?.getOffer();
    if (offer) return offer;
    await new Promise(r => setTimeout(r, 300));
  }
  return null;
}

// Start a purchase. Resolves { ok: true } once Apple's sheet completed (credit arrives via onIap "credited"),
// or { ok: false, reason: unavailable | cancelled | failed }.
export async function buy(productId) {
  if (!(await initIap())) return { ok: false, reason: "unavailable" };
  const offer = await findOffer(productId);
  if (!offer) return { ok: false, reason: "unavailable" };
  const err = await offer.order();
  if (err) return { ok: false, reason: err.code === window.CdvPurchase.ErrorCode.PAYMENT_CANCELLED ? "cancelled" : "failed" };
  return { ok: true };
}

// Restore (Apple-required button): asks the App Store to re-send past purchases; each goes through verify-purchase.
export async function restoreFromApple() {
  if (!(await initIap())) return;
  await window.store.restorePurchases();
  await new Promise(r => setTimeout(r, 2500));   // give the re-sent transactions time to be verified
}
window.BlockRushIAP = { restore: restoreFromApple };
