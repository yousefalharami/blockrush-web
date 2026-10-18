// Supabase backend: invisible anonymous sign-in, then RPC calls (games, rooms, wins, promo codes, leaderboards).
// If it can't sign in (no internet, not configured, anonymous sign-ins off), the app falls back to the dev
// relay for rooms and on-device game counts.
import { CONFIG } from "./config.js";
import { getClient } from "./net/supabase.js";

let ok = false, pending = null, settled = false;
export const serverOn = () => ok;
// False until the first sign-in attempt finishes (the title screen shows before that).
export const serverSettled = () => settled;

export function initServer() {
  if (pending) return pending;
  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) return (pending = Promise.resolve(false));
  const signIn = (async () => {
    const c = await getClient();
    const { data } = await c.auth.getSession();
    if (!data.session) {
      const { error } = await c.auth.signInAnonymously();
      if (error) throw error;
    }
    return true;
  })();
  const timeout = new Promise(res => setTimeout(() => res(false), 8000));
  return (pending = Promise.race([signIn, timeout]).catch(e => { console.warn("server sign-in failed:", e.message || e); return false; })
    .then(v => { settled = true; return (ok = !!v); }));
}

export async function rpc(fn, args = {}) {
  const c = await getClient();
  const { data, error } = await c.rpc(fn, args);
  if (error) throw error;
  return data;
}

export async function select(table, columns = "*") {
  const c = await getClient();
  const { data, error } = await c.from(table).select(columns);
  if (error) throw error;
  return data;
}

// Players online right now: everyone with the app open joins one presence channel (keyed by player id).
let onlineCount = null;
const countListeners = new Set();
export const playersOnline = () => onlineCount;
export const onPlayersOnline = f => countListeners.add(f);
export async function joinPresence() {
  if (!ok) return;
  try {
    const c = await getClient();
    await c.realtime.setAuth();
    const { data } = await c.auth.getSession();
    const ch = c.channel("blockrush:presence", { config: { private: true, presence: { key: data.session?.user.id || "?" } } });
    ch.on("presence", { event: "sync" }, () => {
      onlineCount = Object.keys(ch.presenceState()).length;
      countListeners.forEach(f => f(onlineCount));
    });
    let retried = false;
    const retry = () => { if (retried) return; retried = true; c.removeChannel(ch); setTimeout(joinPresence, 3000); };
    // The socket can still be (re)connecting right after sign-in: on error / time-out, try again shortly.
    ch.subscribe(status => {
      if (status === "SUBSCRIBED") ch.track({ at: Date.now() });
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") retry();
    });
  } catch (e) { console.warn("presence failed:", e.message || e); setTimeout(joinPresence, 5000); }
}
