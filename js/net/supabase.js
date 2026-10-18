import { CONFIG } from "../config.js";

let client = null;

// supabase-js is bundled locally (classic script defining window.supabase), so the iOS app needs no CDN.
function loadLib() {
  if (window.supabase) return Promise.resolve(window.supabase);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = new URL("../vendor/supabase-2.117.2.js", import.meta.url).href;
    s.onload = () => resolve(window.supabase);
    s.onerror = () => reject(new Error("supabase-js failed to load"));
    document.head.appendChild(s);
  });
}

// iOS app: the (invisible, anonymous) account's session lives in the iPhone Keychain, which survives deleting and
// reinstalling the app, so wins, rank, prizes and promo Unlimited come back. "This device only" (no iCloud sync).
// A session still in localStorage from before is moved into the Keychain on first read. Web: plain localStorage.
function keychainStorage() {
  const KS = window.Capacitor?.isNativePlatform?.() && window.Capacitor.Plugins?.SecureStorage;
  if (!KS) return undefined;
  const k = key => ({ prefixedKey: `br_${key}`, sync: false });
  const ls = { get: key => { try { return localStorage.getItem(key); } catch { return null; } },
               del: key => { try { localStorage.removeItem(key); } catch {} } };
  return {
    async getItem(key) {
      try {
        const { data } = await KS.internalGetItem(k(key));
        if (data != null) return data;
      } catch {}
      const old = ls.get(key);   // migrate an older localStorage session into the Keychain
      if (old != null) { try { await KS.internalSetItem({ ...k(key), data: old, access: 3 }); } catch {} }
      return old;
    },
    async setItem(key, value) {
      try { await KS.internalSetItem({ ...k(key), data: value, access: 3 }); ls.del(key); }   // 3 = after first unlock, this device only
      catch { try { localStorage.setItem(key, value); } catch {} }
    },
    async removeItem(key) {
      try { await KS.internalRemoveItem(k(key)); } catch {}
      ls.del(key);
    },
  };
}

export async function getClient() {
  if (!client) {
    const { createClient } = await loadLib();
    const storage = keychainStorage();
    client = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, storage ? { auth: { storage } } : undefined);
  }
  return client;
}

// Room channels are private: only signed-in players (the invisible anonymous sign-in) can join or send.
export async function connect(room, onMessage) {
  const c = await getClient();
  await c.realtime.setAuth();
  const ch = c.channel(`blockrush:${room}`, { config: { private: true, broadcast: { self: true } } });
  ch.on("broadcast", { event: "msg" }, ({ payload }) => onMessage(payload));
  await new Promise((resolve, reject) => ch.subscribe(status => {
    if (status === "SUBSCRIBED") resolve();
    else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(new Error(status));
  }));
  return {
    send(msg) { ch.send({ type: "broadcast", event: "msg", payload: msg }); },
    close() { c.removeChannel(ch); },
  };
}
