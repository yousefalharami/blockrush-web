// Daily game allowance: 2 free games per day + purchased/won/promo extra games, or unlimited.
// One game = one match you play (host or guest, local or online), charged when round 1 starts.
// With the server (Supabase, signed in): the server keeps the counts per player, rolls the day over at midnight
// in the time zone saved on first launch, validates promo codes and online wins (first 2 wins a day = +1 game).
// Without it (dev relay / offline): the old on-device counts, with the day taken from a server Date header.
import { CONFIG } from "./config.js";
import { storeConfig } from "./store.js";
import { serverOn as serverReady, serverSettled, rpc } from "./server.js";
import { getClient } from "./net/supabase.js";
// Server mode, or still connecting with a cached server state (show the last known count, not the offline default).
const serverOn = () => serverReady() || (!serverSettled() && !!srv);
// The website is free and open (user, 2026-10-18): no game counter, nothing runs out. Matches are still recorded on the
// server (charge_game p_free) so online wins, leaderboards and streaks work. The iPhone/Android apps keep daily games.
export const webOpen = !window.Capacitor?.isNativePlatform?.();
// Free games per day come from the store config (default 2).
export const freePerDay = () => (serverOn() && srv ? srv.freePerDay : storeConfig().freePerDay);
const K = { day: "br.gamesDay", used: "br.gamesUsed", extra: "br.gamesExtra", unlimited: "br.unlimited", last: "br.lastGame", trust: "br.trustMax" };
const get = k => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k, v) => { try { localStorage.setItem(k, String(v)); } catch {} };
const dayOf = ms => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
const changed = () => listeners.forEach(f => f());

/* ---------- server mode ---------- */
// Last known server state { left, unlimited, freePerDay, rewardsLeft } (cached so the counter shows at launch).
let srv = (() => { try { return JSON.parse(get("br.srvGames")); } catch { return null; } })();
const keep = st => { if (st) { srv = st; set("br.srvGames", JSON.stringify(st)); changed(); } return st; };
const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; } };

// Ask the server for my games (creates my player on first launch). Safe to call often.
export async function refreshGames() {
  if (!serverReady()) return;
  try { keep(await rpc("my_games", { p_tz: tz() })); } catch { return; }
  if (srv?.unlimited) set("br.hadSub", "1");
  else if (get("br.hadSub") === "1") await renewalCheck();
}
// Unlimited just ended on the server for a player who had it: ask the server to re-check their own App Store
// subscription with Apple (it may have renewed while the app was closed), then re-read. At most once a minute.
let renewalAt = 0;
async function renewalCheck() {
  if (Date.now() - renewalAt < 60000) return;
  renewalAt = Date.now();
  try {
    const { data } = await (await getClient()).functions.invoke("verify-purchase", { body: { refresh: true } });
    if (data?.refreshed === false) { try { localStorage.removeItem("br.hadSub"); } catch {} return; }   // no subscription (promo/prize ended)
    if (data?.expires && new Date(data.expires).getTime() < Date.now()) { try { localStorage.removeItem("br.hadSub"); } catch {} }   // really ended (cancelled)
    if (data?.ok) keep(await rpc("my_games", { p_tz: tz() }));
  } catch {}
}
// Spend one game for this match. Resolves true if I may play (charged now or already charged for it).
export async function chargeMatch(matchKey, room) {
  if (webOpen) { if (serverReady()) rpc("charge_game", { p_match: matchKey, p_room: room, p_free: true }).catch(() => {}); return true; }
  if (!serverReady()) { if (gamesLeft() < 1 && get(K.last) !== matchKey) return false; consumeGame(matchKey); return true; }
  try { const r = await rpc("charge_game", { p_match: matchKey, p_room: room }); keep(r.state); return r.ok; }
  catch { return true; }   // server hiccup: don't kick the player out mid-match
}
// Online win: the server checks it and rewards the first 2 a day. Resolves 1 or 2 (which reward), or 0.
export async function claimWin(matchKey) {
  if (!serverReady()) return 0;
  try { const r = await rpc("award_win", { p_match: matchKey }); keep(r.state); return r.ok ? r.reward : 0; }
  catch { return 0; }
}
// Promo code → { ok, kind, games } or { ok: false, reason: invalid | used | offline }.
export async function redeem(code) {
  if (!serverReady()) return { ok: false, reason: "offline" };
  try { const r = await rpc("redeem_promo", { p_code: String(code) }); keep(r.state); return r; }
  catch { return { ok: false, reason: "offline" }; }
}

// Restore purchases → true (Unlimited is active), false (nothing to restore) or "offline".
// Subscription status is kept on the SERVER (players.unlimited_until), never decided by the phone at launch, so a
// subscriber is never locked out just because StoreKit wasn't ready yet. When StoreKit is added: ask it to restore
// (re-send past transactions to the server for verification), then re-read the server.
export async function restorePurchases() {
  if (!serverReady()) return "offline";
  try { await window.BlockRushIAP?.restore?.(); } catch {}
  try { keep(await rpc("my_games", { p_tz: tz() })); } catch { return "offline"; }
  return !!srv?.unlimited;
}

// Monthly prize I won (top 3 of last month's leaderboard) and haven't seen yet: { month, rank, wins } or null.
export const pendingPrize = () => (serverOn() && srv?.prize) || null;
export function prizeSeen() {
  if (srv) { srv = { ...srv, prize: null }; set("br.srvGames", JSON.stringify(srv)); }
  rpc("prize_seen").catch(() => {});
}

/* ---------- on-device fallback ---------- */
let offset = null;   // serverTime − Date.now(), once known
// Ask the server what time it is. Resolves quietly on failure (offline → no refills this session).
export async function syncTime() {
  if (serverReady()) return refreshGames();
  try {
    const url = CONFIG.TIME_URL || `${location.pathname}?t=${Date.now()}`;
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(url, { method: "HEAD", cache: "no-store", signal: ctrl.signal }); clearTimeout(timer);
    const server = Date.parse(res.headers.get("date"));
    if (!Number.isFinite(server)) return;
    offset = server - Date.now();
    set(K.trust, Math.max(server, +get(K.trust) || 0));   // never let the trusted clock go backwards
    changed();
  } catch {}
}
const trustedNow = () => (offset === null ? null : Math.max(Date.now() + offset, +get(K.trust) || 0));

function rollDay() {
  const now = trustedNow();
  if (now === null) return;   // no trusted time yet: keep today's count as is
  if (get(K.day) !== dayOf(now)) { set(K.day, dayOf(now)); set(K.used, 0); }
}
export const isUnlimited = () => webOpen || (serverOn() ? !!srv?.unlimited : get(K.unlimited) === "1");
export function gamesLeft() {
  if (webOpen) return Infinity;
  if (serverOn()) return !srv ? freePerDay() : srv.unlimited ? Infinity : srv.left;
  rollDay();
  if (isUnlimited()) return Infinity;
  return Math.max(0, freePerDay() - (+get(K.used) || 0)) + (+get(K.extra) || 0);
}
// Spend one game for this match (idempotent per match key, so reloads don't double-charge).
function consumeGame(matchKey) {
  if (get(K.last) === matchKey) return;
  set(K.last, matchKey); rollDay();
  if (isUnlimited()) return;
  const used = +get(K.used) || 0;
  if (used < freePerDay()) set(K.used, used + 1);
  else set(K.extra, Math.max(0, (+get(K.extra) || 0) - 1));
  changed();
}
const listeners = new Set();
export const onGamesChange = f => listeners.add(f);
