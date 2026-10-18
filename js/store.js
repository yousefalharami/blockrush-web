// Remote store config: what the "+" store sheet shows (packs, prices, badges, sale banner) and how many
// free games per day. Loaded from CONFIG.STORE_URL at launch, cached for offline, with built-in defaults.
// With the server it comes from the Supabase table store_config (row id 1, column config: edit it in the
// dashboard to change the store without an app update); otherwise from www/config/store.json.
// In the iOS app, prices shown will come from the App Store (StoreKit, by productId); the JSON price is
// the fallback / web display.
import { CONFIG } from "./config.js";
import { serverOn, select } from "./server.js";

const DEFAULTS = {
  version: 1, freePerDay: 2, banner: null, note: "", onlineBase: 0, minVersion: "0", latestVersion: "0", appStoreUrl: "",
  packs: [
    { id: "games_5", type: "games", games: 5, title: "5 games", price: "$0.99" },
    { id: "games_15", type: "games", games: 15, title: "15 games", price: "$2.99" },
    { id: "unlimited", type: "subscription", period: "month", title: "Unlimited", price: "$3.99" },
  ],
};
const CACHE = "br.storeCfg";

// Keep only well-formed fields, so a typo in the remote file can't break the store.
function clean(raw) {
  if (!raw || typeof raw !== "object") return null;
  const str = v => (typeof v === "string" && v.trim() ? v.trim() : null);
  const packs = (Array.isArray(raw.packs) ? raw.packs : []).map(p => p && str(p.title) && str(p.price) ? {
    id: str(p.id) || str(p.title), productId: str(p.productId), type: p.type === "subscription" ? "subscription" : "games",
    games: Number.isFinite(p.games) ? p.games : null, period: str(p.period), title: str(p.title), price: str(p.price),
    wasPrice: str(p.wasPrice), badge: str(p.badge),
  } : null).filter(Boolean);
  const banner = raw.banner && str(raw.banner.text) ? { text: str(raw.banner.text), color: str(raw.banner.color) } : null;
  return {
    version: raw.version || 1, packs: packs.length ? packs : DEFAULTS.packs, banner, note: str(raw.note) || "",
    freePerDay: Number.isInteger(raw.freePerDay) && raw.freePerDay >= 0 && raw.freePerDay <= 50 ? raw.freePerDay : DEFAULTS.freePerDay,
    // Added to the real "players online" count on the Online screen (0 = the real number).
    // App version gate (iOS app): below minVersion → "Update required"; below latestVersion → optional update prompt.
    minVersion: str(raw.minVersion) || "0", latestVersion: str(raw.latestVersion) || "0", appStoreUrl: str(raw.appStoreUrl) || "",
    onlineBase: Number.isInteger(raw.onlineBase) && raw.onlineBase >= 0 && raw.onlineBase <= 10000 ? raw.onlineBase : 0,
  };
}

let current = (() => { try { return clean(JSON.parse(localStorage.getItem(CACHE))); } catch { return null; } })() || DEFAULTS;
export const storeConfig = () => current;
// "1.2.10" vs "1.10.0" → negative / 0 / positive (numeric parts).
export function cmpVersion(a, b) {
  const x = String(a).split(".").map(n => parseInt(n, 10) || 0), y = String(b).split(".").map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; }
  return 0;
}

export async function loadStoreConfig() {
  try {
    if (serverOn()) {
      const cfg = clean((await select("store_config", "config"))[0]?.config);
      if (cfg) { current = cfg; try { localStorage.setItem(CACHE, JSON.stringify(cfg)); } catch {} return current; }
    }
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(CONFIG.STORE_URL || "config/store.json", { cache: "no-store", signal: ctrl.signal });
    clearTimeout(timer);
    const cfg = clean(await res.json());
    if (cfg) { current = cfg; try { localStorage.setItem(CACHE, JSON.stringify(cfg)); } catch {} }
  } catch {}
  return current;
}
