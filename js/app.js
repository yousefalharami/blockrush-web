import { CONFIG } from "./config.js";
import { t, buildName } from "./i18n.js";
import { N, empty, toLayers, paletteOf, parseLayers, mountBuilder, mountScene, islandLayout, arenaDiameter, newCam, colorCounts, score, draw, givenCells, islandLayout as layoutOf, HEX } from "./voxel.js";
import { loadBuilds } from "./builds.js";
import { play, isMuted, toggleMute } from "./sfx.js";
import { initBackground, play as bgPlay, pause as bgPause } from "./bg.js";
import { webOpen, restorePurchases, isUnlimited, gamesLeft, chargeMatch, claimWin, onGamesChange, syncTime, redeem, freePerDay, pendingPrize, prizeSeen } from "./games.js";
import { iapAvailable, initIap, buy, priceOf, onIap } from "./iap.js";
import { initServer, serverOn, rpc, joinPresence, playersOnline, onPlayersOnline } from "./server.js";
import { storeConfig, loadStoreConfig, cmpVersion } from "./store.js";
import { connect, transportName } from "./net/index.js";
import { createHost, STYLES } from "./host.js";
import { starShot, starProgress, applyCineFx, cinematicActive, STAR_T } from "./starcam.js";
import { ISLAND_THEMES } from "./voxel.js";
import { mountEditor } from "./editor.js";
import { askNotifications, setupNotifications, notifyStatus, pingFriends } from "./notify.js";

const app = document.getElementById("app");
const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

// Per-tab identity so two tabs in one browser are two players; survives reload for rejoin.
const selfId = (() => {
  // Not crypto.randomUUID: it's missing on plain-http LAN addresses (e.g. an iPhone on http://192.168.x.x).
  const fresh = () => Math.random().toString(36).slice(2, 10);
  try {
    let id = sessionStorage.getItem("br.id");
    if (!id) { id = fresh(); sessionStorage.setItem("br.id", id); }
    return id;
  } catch { return fresh(); }
})();

let builds = null, booted = false;
// One camera for the whole session, so the viewpoint carries over between memorize, build, judge and rounds.
const cam = newCam();
const S = { net: null, host: null, room: null, state: null, deadline: 0, lastStateAt: 0,
            key: null, build: null, plots: {}, watch: null, buildRound: 0, submitted: false, builder: null, specRedraw: null, ping: null, joinTimer: null,
            // online lobby: current quiz question
            quizQ: 0 };

// Line icons (no emoji): speaker on/off for the mute toggle, and a pixel-style trophy.
const ICON = {
  soundOn: `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  soundOff: `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  lock: `<svg class="ico lock" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2" fill="currentColor"/><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2"/></svg>`,
  chat: `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8 9.5h8M8 12.5h5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  crown: `<svg viewBox="0 0 16 16" aria-hidden="true" shape-rendering="crispEdges"><path fill="#FFB23F" d="M1 4h2v2h2V3h2v3h2V3h2v3h2V4h2v9H1z"/><path fill="#1B1400" opacity=".2" d="M1 11h14v2H1z"/></svg>`,
  share: `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 12v7h14v-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  flame: `<svg class="flame" viewBox="0 0 16 16" aria-hidden="true"><path fill="#FF6A2B" d="M8 1C9 4 13 6 13 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5C5.5 7 6.5 7.5 7 7.5 7 5 7.5 3 8 1z"/><path fill="#FFD23F" d="M8 8c.6 1.4 2.4 2.2 2.4 3.9a2.4 2.4 0 0 1-4.8 0C5.6 10.5 7 9.6 8 8z"/></svg>`,
  trophy: `<svg class="trophy" viewBox="0 0 16 16" aria-hidden="true" shape-rendering="crispEdges"><path fill="#F2C14E" d="M4 2h8v1h2v3h-1v1h-1v1h-1v1H9v2h2v1h1v2H4v-2h1v-1h2V9H5V8H4V7H3V6H2V3h2z"/><path fill="#1B1400" opacity=".25" d="M3 4h1v2H3zM12 4h1v2h-1z"/><path fill="#FFE9A8" d="M6 3h1v4H6z"/></svg>`,
};
const muteIcon = () => (isMuted() ? ICON.soundOff : ICON.soundOn);
// Winning streak beside a name (2+ online wins in a row): flame + number.
const idText = n => (n == null || n === "" ? "–" : String(n).padStart(5, "0"));   // player IDs always show 5 digits (7 → 00007)
const streakTag = n => (n >= 2 ? `<span class="streak" aria-label="${t("streakLabel", { n })}">${ICON.flame}${n}</span>` : "");

// My 5-digit player ID (Friends) and current winning streak, from the server; cached for the next launch.
let PROFILE = (() => { try { return JSON.parse(localStorage.getItem("br.profile")) || {}; } catch { return {}; } })();
async function refreshProfile() {
  if (!serverOn()) return;
  try { PROFILE = await rpc("my_profile") || {}; store.set("br.profile", JSON.stringify(PROFILE)); } catch {}
}

// Header: back / room code / mute on the left; games-left counter with a + (store) on the right.
const gamesText = () => (gamesLeft() === Infinity ? "∞" : String(gamesLeft()));
const header = extra => `<div class="top">
  <div class="top-r">${extra || ""}<button class="chip ghost" id="mute" aria-label="${t("sound")}">${muteIcon()}</button></div>
  ${webOpen ? "" : `<div class="games-pill"><button class="plus" id="buy" aria-label="${t("getGames")}">+</button>
    <span class="games-n" aria-label="${t("gamesLeftLabel")}">${gamesText()}</span></div>`}</div>`;
onGamesChange(() => { document.querySelectorAll(".games-n").forEach(e => { e.textContent = gamesText(); }); prizePopup(); });

// Monthly prize: top 3 of the monthly leaderboard win 1 free month of unlimited games (granted by the server).
// Winners get this pop-up once (not mid-match); everyone else learns about it from the trophy button.
// Website (free & open, user 2026-10-18): no monthly prize and no "+games" rewards anywhere. Flip to true to bring them back.
const WEB_REWARDS = false;
const rewardsShown = () => !webOpen || WEB_REWARDS;

function prizePopup() {
  if (!rewardsShown()) return;
  const p = pendingPrize();
  if (!p || document.querySelector(".prize-pop") || (S.state && S.state.phase !== "lobby" && S.state.phase !== "over")) return;
  const el = document.createElement("div"); el.className = "store prize-pop";
  el.innerHTML = `<div class="store-card" role="dialog" aria-modal="true">
    ${ICON.trophy}<div class="phase">${t("prizeWonTitle", { rank: p.rank })}</div>
    <p class="hint">${t("prizeWon", { month: esc(p.month), rank: p.rank, wins: p.wins })}</p>
    <button class="btn wide" id="prizeok">${t("ok")}</button></div>`;
  document.body.appendChild(el); play("win"); prizeSeen();
  el.onclick = e => { if (e.target === el || e.target.closest("#prizeok")) el.remove(); };
}
const utcMonth = () => new Date().toISOString().slice(0, 7);
const daysLeftInMonth = () => { const d = new Date(), end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  return Math.max(1, Math.ceil((end - Date.now()) / 86400000)); };
// Shown the first time the trophy is tapped each month, then it opens the leaderboard.
function prizeInfo(then) {
  const el = document.createElement("div"); el.className = "store prize-pop";
  el.innerHTML = `<div class="store-card" role="dialog" aria-modal="true">
    ${ICON.trophy}<div class="phase">${t("prizeTitle")}</div>
    <p class="hint">${t("prizeInfo")}</p>
    <p class="hint small">${t(daysLeftInMonth() === 1 ? "prizeEnds1" : "prizeEnds", { n: daysLeftInMonth() })}
      · <a href="${LEGAL.rules}" target="_blank" rel="noopener">${t("rules")}</a></p>
    <button class="btn wide" id="prizego">${t("prizeGo")}</button>
    <button class="btn ghost wide" id="prizemenu">${t("mainMenu")}</button></div>`;
  document.body.appendChild(el);
  el.onclick = e => {
    const go = !!e.target.closest("#prizego");
    if (!go && e.target !== el && !e.target.closest("#prizemenu")) return;
    el.remove(); store.set("br.prizeInfo", utcMonth());
    if (go) then(); else if (location.hash !== "#menu") location.hash = "#menu";   // Main menu (or tap outside): just close
  };
}

// Start of each month: everyone sees last month's top 3 once (winners get their own "You finished #n" pop-up).
async function winnersPopup() {
  const month = utcMonth();
  if (!rewardsShown() || !serverOn() || store.get("br.winnersSeen") === month) return;
  let r; try { r = await rpc("month_winners"); } catch { return; }
  const w = r?.winners || [];
  if (!w.length || w.some(x => x.me)) { store.set("br.winnersSeen", month); return; }
  const show = () => {
    if (document.querySelector(".prize-pop, .update-pop") || (S.state && S.state.phase !== "lobby" && S.state.phase !== "over")) return setTimeout(show, 3000);
    store.set("br.winnersSeen", month);
    const name = new Date(r.month + "-15T00:00:00Z").toLocaleString("en", { month: "long", timeZone: "UTC" });
    const el = document.createElement("div"); el.className = "store prize-pop";
    el.innerHTML = `<div class="store-card" role="dialog" aria-modal="true">
      ${ICON.trophy}<div class="phase">${t("winnersTitle", { month: name })}</div>
      <ol class="winners">${w.map(x => `<li><b>${x.rank}</b><span>${esc(x.name)}</span><em>${t("winsN", { n: x.wins })}</em></li>`).join("")}</ol>
      <p class="hint">${t("winnersPrize")}</p>
      <button class="btn wide" id="winnersgo">${t("prizeGo")}</button></div>`;
    document.body.appendChild(el); play("win");
    el.onclick = e => {
      if (e.target === el) el.remove();
      else if (e.target.closest("#winnersgo")) { el.remove(); location.hash = "#leaders"; }
    };
  };
  show();
}

const onStoreLoaded = () => document.querySelectorAll(".games-n").forEach(e => { e.textContent = gamesText(); });

// Store sheet, built from the remote store config (www/config/store.json). Real purchases arrive with the
// iOS app (App Store in-app purchases); prices there come from StoreKit.
function openStore(reason) {
  const cfg = storeConfig();
  document.querySelector(".store")?.remove();
  const el = document.createElement("div"); el.className = "store";
  el.innerHTML = `<div class="store-card" role="dialog" aria-modal="true" aria-label="${t("getGames")}">
    <button class="chip ghost store-x" aria-label="${t("close")}">×</button>
    <div class="phase">${t("getGames")}</div>
    ${reason ? `<p class="err">${reason}</p>` : ""}
    ${cfg.banner ? `<div class="store-banner ${esc(cfg.banner.color || "")}">${esc(cfg.banner.text)}</div>` : ""}
    <p class="hint">${t("freeDaily", { n: freePerDay() })}</p>
    <div class="store-opts">
      ${cfg.packs.map(p => {
        const big = p.type === "subscription" ? "∞" : p.games ?? "";
        const base = priceOf(p.productId) || p.price;   // App Store's localized price when the app has loaded it
        const price = p.type === "subscription" && p.period ? `${esc(base)}<small>/${esc(p.period)}</small>` : esc(base);
        return `<button class="store-opt" data-product="${esc(p.productId || p.id)}" data-period="${p.type === "subscription" ? esc(p.period || "") : ""}">${p.badge ? `<i class="badge-tag">${esc(p.badge)}</i>` : ""}
          <b>${big}</b><span>${esc(p.title)}</span>
          <em>${p.wasPrice ? `<s>${esc(p.wasPrice)}</s> ` : ""}${price}</em></button>`;
      }).join("")}
    </div>
    ${cfg.note ? `<p class="hint small" id="store-note">${esc(cfg.note)}</p>` : ""}
    <p class="hint small" id="buy-msg" hidden></p>
    <p class="hint small store-legal">${t("subTerms")}
      <a href="${LEGAL.terms}" target="_blank" rel="noopener">${t("termsOfUse")}</a> · <a href="${LEGAL.privacy}" target="_blank" rel="noopener">${t("privacyPolicy")}</a></p>
    <form class="promo" id="promo"><input id="promo-code" placeholder="${t("promoCode")}" autocomplete="off" autocapitalize="characters">
      <button class="btn">${t("redeem")}</button></form>
    <p class="hint small" id="promo-msg" hidden></p>
    <button class="link restore" id="restore">${t("restore")}</button>
  </div>`;
  document.body.appendChild(el);
  const close = () => el.remove();
  el.onclick = e => {
    if (e.target === el || e.target.closest(".store-x")) return close();
    const opt = e.target.closest(".store-opt"); if (opt) buyPack(opt, el);
  };
  // Restore purchases (Apple requires it for the subscription). Ownership lives on the server (players.unlimited_until),
  // so this re-reads it; once StoreKit is added it also asks the App Store to re-send past purchases first.
  el.querySelector("#restore").onclick = async e => {
    const b = e.currentTarget, msg = el.querySelector("#promo-msg");
    b.disabled = true; msg.hidden = false; msg.style.color = ""; msg.textContent = t("restoring");
    const r = await restorePurchases();
    b.disabled = false;
    msg.textContent = t(r === "offline" ? "promoOffline" : r ? "restored" : "nothingToRestore");
    msg.style.color = r === true ? "var(--good)" : r === "offline" ? "var(--bad)" : "";
    if (r === true) play("perfect");
  };
  el.querySelector("#promo").onsubmit = async e => {
    e.preventDefault();
    const btn = el.querySelector("#promo button"), msg = el.querySelector("#promo-msg");
    btn.disabled = true;
    const r = await redeem(el.querySelector("#promo-code").value);   // checked on the server
    btn.disabled = false; msg.hidden = false;
    msg.textContent = r.ok ? (r.kind === "games" ? t("promoGames", { n: r.games }) : t("promoOk"))
      : t({ used: "promoUsed", offline: "promoOffline" }[r.reason] || "promoBad");
    msg.style.color = r.ok ? "var(--good)" : "var(--bad)";
    if (r.ok) { play("perfect"); setTimeout(close, 1200); }
  };
}

// In-game "leave the match?" sheet (game-styled, instead of the browser's confirm box).
function askLeave() {
  document.querySelector(".leave-pop")?.remove();
  const el = document.createElement("div"); el.className = "store leave-pop";
  el.innerHTML = `<div class="store-card" role="alertdialog" aria-modal="true" aria-labelledby="lq">
    <div class="phase" id="lq">${t("leaveTitle")}</div>
    <p class="hint">${t("leaveGameQ")}</p>
    <div class="leave-btns"><button class="btn ghost" id="stay">${t("stay")}</button>
      <button class="btn danger" id="goleave">${t("leaveMatch")}</button></div></div>`;
  document.body.appendChild(el);
  return new Promise(res => {
    el.onclick = e => {
      const leave = !!e.target.closest("#goleave");
      if (leave || e.target === el || e.target.closest("#stay")) { el.remove(); res(leave); }
    };
  });
}

// Menu button sound for every button (mute toggle included), except ones with their own sound.
document.addEventListener("click", e => {
  const b = e.target.closest("button, .link");
  if (!b || b.disabled) return;
  if (b.id === "mute") { toggleMute(); b.innerHTML = muteIcon(); }
  if (b.id === "buy") openStore();
  if (b.id === "saybtn") return openSay(b);
  if (b.dataset.say != null) { sendSay(+b.dataset.say); document.querySelector(".say-pop")?.remove(); return; }
  if (b.id === "roomback") {   // leave the room; mid-match asks first (you'd forfeit)
    const ph = S.state?.phase;
    if (!ph || ph === "lobby" || ph === "over") home();
    else askLeave().then(ok => { if (ok && S.state) home(); });
  }
  if (b.closest("#bpal") || b.id === "bundo" || b.id === "bclear" || b.classList.contains("play")) return;
  play("button");
});

/* ---------- design lab (temporary): pick the game-screen layout and the shooting-star camera ---------- */
function designLab() {
  const de = document.documentElement;
  const L = { card: "Current (card)", full: "A · Full world", stage: "B · Wide stage", hud: "C · Game HUD" };
  const M = { classic: "No camera", iso: "1 · Isometric", pov: "2 · Star POV", planet: "3 · From the planet", side: "4 · Side view", top: "5 · Top-down" };
  const group = (name, opts, cur) => `<div class="seg lab-seg" data-g="${name}">${Object.entries(opts).map(([k, v]) =>
    `<button class="${k === cur ? "on" : ""}" data-v="${k}">${v}</button>`).join("")}</div>`;
  app.innerHTML = `${header(backBtn)}
  <div class="stage">
    <div class="phase">DESIGN LAB</div>
    <p class="hint">Game screen layout (tap one to open it):</p>${group("layout", L, de.dataset.layout)}
    <p class="hint">Shooting star camera:</p>${group("starcam", M, de.dataset.starcam)}
    <p class="hint">Middle of the arena (tap to preview):</p>${group("core", { planet: "Planet (now)", giant: "1 · Gas giant", ice: "2 · Ice world", lava: "3 · Lava world", earth: "4 · Block Earth", neon: "5 · Neon rings" }, de.dataset.core)}
    <div class="arena lab-demo"><div id="bld"></div></div>
    <button class="btn wide" id="labplay">Watch the star</button>
    <button class="btn wide" id="labgame">Try it in a solo game</button>
    <button class="btn ghost wide" id="labnotif">Turn on notifications (test)</button>
    <p class="hint">Winning streak (2+ online wins in a row), shown on the islands above, lobby seats and leaderboards:</p>
    <ul class="seats lab-seats">${[["YOU", 2, "#FFB23F"], ["SARA", 5, "#7FD3A8"], ["OMAR", 0, "#A5A9C9"], ["LINA", 12, "#F49AC1"]].map(([n, k, c], i) =>
      `<li class="seat ${i ? "" : "me"}"><i class="av" style="--c:${c}">${n[0]}${streakTag(k)}</i><span>${n}</span></li>`).join("")}</ul>
    <ol class="board lb lab-board">${[["LINA", 9, 12], ["SARA", 6, 5], ["YOU", 4, 2], ["OMAR", 3, 0]].map(([n, w, k], i) =>
      `<li class="${n === "YOU" ? "me" : ""}"><span class="rank">${i + 1}</span><span class="nm">${n}${streakTag(k)}</span><b>${w}</b></li>`).join("")}</ol>
  </div>`;
  app.querySelector("#back").onclick = () => { location.hash = "#menu"; };
  app.querySelectorAll(".lab-seg").forEach(g => g.onclick = e => {
    const b = e.target.closest("button"); if (!b) return;
    de.dataset[g.dataset.g] = b.dataset.v; store.set("br." + g.dataset.g, b.dataset.v);
    g.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
    if (g.dataset.g === "starcam") runDemo();
    else if (g.dataset.g === "core") spinCore();
    else location.hash = "#labview";   // open that game screen on its own, with a back button
  });
  app.querySelector("#labgame").onclick = () => { location.hash = "#local"; };
  app.querySelector("#labnotif").onclick = async () => { store.set("br.notifAsked", "1"); await askNotifications(); toast(`Notifications: ${await notifyStatus() || "app only"}`); };
  // Demo: 4 islands with a duck; the 3rd island gets hit.
  const duck = builds.get("duck").vox, { offs, world } = layoutOf(4, 0), demoCam = { yaw: Math.PI / 4, pitch: Math.PI / 6 };
  const loser = 2, hit = [offs[loser][0] + N / 2, offs[loser][1] + N / 2, 1], lo = layoutOf(4, loser), NAMES4 = ["YOU", "SARA", "OMAR", "LINA"], STREAK4 = [2, 5, 0, 12];
  let e0 = 0, raf = 0, fxNow = null, demoSeed = .3, coreUntil = 0;
  const redraw = mountScene(app.querySelector("#bld"), t, demoCam, () => {
    const e = e0 ? performance.now() - e0 : 99999;
    const star = e >= STAR_T.star && e < STAR_T.hit ? starProgress(e) : null, boom = e >= STAR_T.hit && e < STAR_T.hit + 1500 ? (e - STAR_T.hit) / 1500 : null,
      fall = Math.max(0, Math.min(1, (e - STAR_T.hit) / (STAR_T.sunk - STAR_T.hit)));
    const shot = starShot(e, { world: lo.world, seed: demoSeed });
    fxNow = shot ? shot.fx : null;
    if (shot) {   // cinematic: centered on the doomed island
      const h = [N / 2, N / 2, 1];
      return { vox: duck, name: NAMES4[loser], streak: STREAK4[loser], fall, world: lo.world, cam: shot.cam, zoom: shot.zoom, target: shot.target, bigNames: true,
        fx: { star: star != null ? { to: h, t: star } : null, boom: boom != null ? { at: h, t: boom } : null },
        neighbours: lo.offs.map((off, i) => i === loser ? null : { vox: duck, off, name: NAMES4[i], streak: STREAK4[i], outline: i === 0, alpha: 1 }).filter(Boolean) };
    }
    if (coreUntil > performance.now()) {   // center object preview: camera looks at the middle of the arena
      return { vox: empty(), world, cam: { yaw: Math.PI / 4, pitch: .3 }, target: world.center, zoom: 1.1,
        neighbours: offs.slice(1).map(off => ({ vox: empty(), off })) };
    }
    return { vox: duck, name: "YOU", streak: STREAK4[0], outline: true, world, fx: { star: star != null ? { to: hit, t: star } : null, boom: boom != null ? { at: hit, t: boom } : null },
      neighbours: offs.slice(1).map((off, i) => ({ vox: duck, off, name: NAMES4[i + 1], streak: STREAK4[i + 1], fall: i + 1 === loser ? fall : 0 })) };
  });
  const loop = () => { if (!app.querySelector(".lab-demo")) return; redraw(); applyCineFx(app.querySelector(".lab-demo .view"), fxNow);
    if (performance.now() - e0 < STAR_T.cutOut + 400) raf = requestAnimationFrame(loop); else applyCineFx(app.querySelector(".lab-demo .view"), null); };
  const runDemo = () => { cancelAnimationFrame(raf); e0 = performance.now(); demoSeed = Math.random(); setTimeout(() => play("star"), STAR_T.star); setTimeout(() => play("star"), STAR_T.dive); setTimeout(() => play("boom"), STAR_T.hit); loop(); };
  app.querySelector("#labplay").onclick = runDemo;
  // Center object preview: animate a few seconds so the moving ones (crystal, cube, sun) show their motion.
  const spinCore = () => { const t0 = performance.now(); coreUntil = t0 + 8000; const go = () => { if (!app.querySelector(".lab-demo") || e0 && performance.now() - e0 < STAR_T.cutOut + 400) return;
    redraw(); if (performance.now() - t0 < 8200) requestAnimationFrame(go); }; go(); };
  window.labFrame = e => { cancelAnimationFrame(raf); e0 = performance.now() - e; redraw(); applyCineFx(app.querySelector(".lab-demo .view"), fxNow); };   // dev: freeze at e ms
}

// Lab: a playable mock of the build screen in the chosen layout (4 islands, a duck to build), with a back button.
function labView() {
  const duck = builds.get("duck").vox, { offs, world } = layoutOf(4, 0), names = ["YOU", "SARA", "OMAR", "LINA"];
  const others = offs.slice(1).map((off, i) => ({ vox: duck.map((k, j) => (k && (j * 7 + i * 3) % 10 < 6 ? k : null)), off, name: names[i + 1] }));
  const vox = empty();
  app.innerHTML = `${header(backBtn)}
  <div class="stage arena-stage">
    <div class="meta"><span>ROUND 1</span><span>4 LEFT</span></div>
    <div class="phase build" id="ph">BUILD · 24s</div><div class="timer"><i id="bar" style="width:70%"></i></div>
    <div class="arena"><div id="bld"></div></div>
    <p class="hint">${t("buildHint")}</p>
    <div class="row"><button class="btn danger" id="clearall">${t("clearAll")}</button></div>
  </div>`;
  app.querySelector("#back").onclick = () => { location.hash = "#lab"; };
  const lzoom = LAYOUT_ZOOM[document.documentElement.dataset.layout] || 1;
  const b = mountBuilder(app.querySelector("#bld"), vox, paletteOf(duck), { t, cam, limits: colorCounts(duck), outsideClear: true,
    scene: () => ({ name: "YOU", outline: true, world, neighbours: others, zoom: lzoom }) });
  app.querySelector("#clearall").onclick = () => b.clear();
  if (document.documentElement.dataset.layout !== "full") return;
  // Island position slider (up/down): drag until it feels right, then send a screenshot of the number.
  const panel = document.createElement("div"); panel.className = "tune glass";
  panel.innerHTML = `<label><span>Position</span><input type="range" data-k="shift" min="-260" max="160" step="2" value="${TUNE.shift}"><b data-v="shift"></b></label>
    <div class="tune-btns"><button class="chip ghost" id="tunereset">Reset to 18</button><button class="chip ghost" id="tunehide">Hide</button></div>`;
  app.appendChild(panel);
  const show = () => { const v = TUNE.shift; panel.querySelector("[data-v]").textContent = `${v > 0 ? "+" : ""}${v}`; };
  const setShift = v => { TUNE.shift = v; applyTune(); show(); };
  panel.oninput = e => { if (e.target.dataset.k) setShift(+e.target.value); };
  panel.querySelector("#tunereset").onclick = () => { panel.querySelector("[data-k]").value = 18; setShift(18); };
  panel.querySelector("#tunehide").onclick = () => { const h = panel.classList.toggle("min"); panel.querySelector("#tunehide").textContent = h ? "Position slider" : "Hide"; };
  show();
}

/* ---------- home ---------- */
// Screens are routed by URL hash: "" title, #menu, #local, #online, #howto, plus dev tools (#shapes, #editor, #arena).
// home(error) leaves any room; an error (bad code, host left…) lands on the Local screen to show it.
// iPhone app: text selection off while building (no blue highlight on long press), on elsewhere (text boxes work).
const textSelect = on => { try { window.webkit?.messageHandlers?.brTextSelect?.postMessage(on); } catch {} };

function home(error) {
  textSelect(true);
  leaveRoom(); stopChallenge(); document.querySelector(".feed")?.remove();
  document.querySelector(".tune")?.remove();
  if (error && !["#local", "#online"].includes(location.hash)) history.replaceState(null, "", "#local");
  const routes = { "#editor": editor, "#arena": arenaPreview, "#shapes": shapesScreen, "#local": () => localScreen(error),
                   "#online": () => onlineScreen(error), "#howto": howToPlay, "#menu": mainMenu, "#leaders": leaderboard, "#lab": designLab, "#labview": labView,
                   "#challenges": () => { history.replaceState(null, "", "#menu"); mainMenu(); openChallenges(); } };
  // Animated block background on menu screens only (dev tools and gameplay have their own canvases).
  DEV_ROUTES.includes(location.hash) ? bgPause() : bgPlay();
  // Short menu screens are locked in place (no page scroll / iOS bounce when dragging the background).
  document.documentElement.classList.toggle("locked", ["", "#menu", "#local", "#online", "#leaders"].includes(location.hash));
  if (!DEV_HOST) ["#editor", "#arena", "#shapes", "#lab", "#labview"].forEach(h => delete routes[h]);
  (routes[location.hash] || titleScreen)();
}
// Dev tools open only on the test server (laptop / LAN); the public website and the apps never show them.
const DEV_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname);
const DEV_ROUTES = DEV_HOST ? ["#editor", "#arena", "#shapes", "#lab", "#labview"] : [];
// Game-screen layout + shooting-star camera (design options being compared; picker at #lab). ?layout= / ?starcam= override.
// Camera tuning for the Full world layout (being agreed with sliders in #labview; saved per phone while testing).
const TUNE = { shift: 18 };   // island position in Full world: +18px (user, 2026-10-05). The lab slider only previews.   // island up/down in px (tilt is the player's own, zoom fixed)
const applyTune = () => document.documentElement.style.setProperty("--scene-shift", `${TUNE.shift}px`);
applyTune();
const LAYOUTS = ["card", "full", "stage", "hud"], LAYOUT_ZOOM = { card: 1, full: .84, stage: .95, hud: .8 };
{ const q = new URLSearchParams(location.search), de = document.documentElement;
  // Chosen designs are fixed for everyone; saved lab picks only count while the lab is on (dev).
  de.dataset.layout = q.get("layout") || (CONFIG.DESIGN_LAB && store.get("br.layout")) || "full";   // Full world chosen (user, 2026-10-05)
  const sc = q.get("starcam") || (CONFIG.DESIGN_LAB && store.get("br.starcam"));
  de.dataset.starcam = ["classic", "iso", "pov", "planet", "side", "top"].includes(sc) ? sc : "side";
  const core = q.get("core");   // arena center: Ice world for everyone (lab taps preview other planets for this session only)
  de.dataset.core = ["planet", "giant", "ice", "lava", "earth", "neon"].includes(core) ? core : "ice"; }   // Ice world chosen (user, 2026-10-05)   // Side view chosen (user, 2026-10-05)
const backBtn = `<button class="chip ghost" id="back" aria-label="${t("back")}">←</button>`;
const bindBack = () => { const b = app.querySelector("#back"); if (b) b.onclick = () => { location.hash = "#menu"; }; };

// Website only: "Block Rush app · Coming soon on iOS" card (title screen + main menu).
const soonCard = () => (webOpen ? `<div class="soon-ios" role="note"><img src="img/icon-192.png" alt="" width="46" height="46">
  <span><b>${t("soonTitle")}</b><small>${t("soonLabel")}</small></span></div>` : "");

// Website only (the apps have these in the store sheet): Privacy / Support / Contest rules links under the title screen,
// plus a "Get it on iPhone" link once the App Store page is live (store_config.iosLive = true, editable on the server).
function webFooter() {
  const live = storeConfig().iosLive;
  return `<footer class="web-foot">
    ${live ? `<a class="ios-get" href="https://apps.apple.com/app/id6817833615" target="_blank" rel="noopener">${t("getOnIphone")}</a>` : ""}
    <nav><a href="${LEGAL.privacy}" target="_blank" rel="noopener">${t("privacyPolicy")}</a><span>·</span>
      <a href="${LEGAL.rules.replace("#rules", "")}" target="_blank" rel="noopener">${t("support")}</a><span>·</span>
      <a href="${LEGAL.rules}" target="_blank" rel="noopener">${t("rules")}</a></nav></footer>`;
}

// Title screen: opens automatically on launch; the main menu's back button returns here.
// Your name is entered here (remembered), then PLAY → main menu.
function titleScreen() {
  app.innerHTML = `${header("", false)}
  <div class="title-screen">
    <img class="title-logo" src="img/logo.png" alt="Block Rush">
    <div class="title-controls">
      <input id="name" class="name-input" maxlength="16" autocomplete="off" autocorrect="off" spellcheck="false" autocapitalize="words" placeholder="${t("yourName")}" aria-label="${t("yourName")}" value="${esc(store.get("br.name") || "")}">
      <button class="btn play-btn" id="play">${t("play")}</button>
      ${soonCard()}
    </div>
    ${isApp() ? "" : webFooter()}
  </div>`;
  const input = app.querySelector("#name");
  const go = () => {
    const n = input.value.trim();
    if (!n) { input.classList.remove("shake"); void input.offsetWidth; input.classList.add("shake"); input.focus(); return; }
    store.set("br.name", n); if (booted) syncName(); location.hash = "#menu";
  };
  app.querySelector("#play").onclick = go;
  input.onkeydown = e => { if (e.key === "Enter") go(); };
}

function mainMenu() {
  if (!store.get("br.name")) { location.hash = ""; return; }   // name comes from the title screen
  // First launch after download: How to play first, then (back on the menu) the monthly prize pop-up.
  if (!store.get("br.onboard")) { store.set("br.onboard", "prize"); location.hash = "#howto"; return; }
  // Leaderboard lives in the top bar (trophy chip), not with the big menu buttons.
  app.innerHTML = `${header(`${backBtn}<button class="chip ghost lb-chip" id="lbbtn" aria-label="${t("menuLeaders")}">${ICON.trophy}</button>`, false)}
  <img class="menu-logo" src="img/logo.png" alt="Block Rush">
  <div class="stage menu">
    <div class="tag">${t("tagline")}</div>
    <button class="btn wide big" data-go="#local">${t("menuLocal")}</button>
    <button class="btn wide big" data-go="#online">${t("menuOnline")}</button>
    <button class="btn wide big" id="chbtn">${t("menuChallenges")}</button>
    <button class="btn wide big" data-go="#howto">${t("menuHowTo")}</button>
    ${CONFIG.DESIGN_LAB ? `<button class="link" data-go="#lab">LAB · design options</button>` : ""}
    ${soonCard()}
  </div>`;
  app.querySelectorAll("[data-go]").forEach(b => b.onclick = () => { location.hash = b.dataset.go; });
  app.querySelector("#back").onclick = () => { location.hash = ""; };   // back to the title screen
  app.querySelector("#chbtn").onclick = openChallenges;
  const toBoard = () => { location.hash = "#leaders"; };
  app.querySelector("#lbbtn").onclick = () => (!rewardsShown() || store.get("br.prizeInfo") === utcMonth() ? toBoard() : prizeInfo(toBoard));
  if (store.get("br.onboard") === "prize") { store.set("br.onboard", "done"); if (rewardsShown()) prizeInfo(toBoard); }
  else notifyNudge();
  checkFriendRequests();
}

function localScreen(error) {
  if (!store.get("br.name")) { location.hash = ""; return; }   // name comes from the title screen
  app.innerHTML = `${header(backBtn)}
  <div class="stage">
    <div class="phase">${t("menuLocal")}</div>
    <p class="hint">${t("playingAs", { name: `<b>${esc(store.get("br.name"))}</b>` })}</p>
    <button class="btn wide" id="create">${t("createRoom")}</button>
    <div class="join"><input id="code" maxlength="4" placeholder="${t("roomCode")}" autocomplete="off" dir="ltr">
      <button class="btn join-go" id="join">${t("join")}</button></div>
    ${error ? `<p class="err">${esc(error)}</p>` : ""}
  </div>`;
  bindBack();
  const name = () => store.get("br.name");
  const canPlay = () => gamesLeft() > 0 || (openStore(t("outOfGames")), false);
  app.querySelector("#create").onclick = () => { if (name() && canPlay()) createRoomSheet(false); };
  const join = () => {
    const n = name(), c = app.querySelector("#code").value.trim().toUpperCase();
    if (n && /^[A-Z]{4}$/.test(c)) { if (canPlay()) enterRoom(c, n, false, null, "private"); } else if (n) app.querySelector("#code").focus();
  };
  app.querySelector("#join").onclick = join;
  app.querySelector("#code").onkeydown = e => { if (e.key === "Enter") join(); };
}

// Online: players-online pill, the list of open rooms (tap to join) with Create room beside it, then join by code. Without the server (dev relay) the list is empty and a preview note shows.
function onlineScreen(error) {
  if (!store.get("br.name")) { location.hash = ""; return; }
  const live = transportName() === "supabase";
  app.innerHTML = `${header(backBtn)}
  <div class="stage online-screen">
    <div class="online-top"><div><div class="phase">${t("menuOnline")}</div>
        <p class="hint small">${t("playingAs", { name: `<b>${esc(store.get("br.name"))}</b>` })}</p></div>
      ${live ? `<span class="online-pill"><i></i><b id="onlineN">${shownOnline(playersOnline())}</b> ${t("playersOnline")}</span>` : ""}</div>
    <div class="rooms-head"><span class="tag">${t("openRooms")}</span><button class="btn small-btn" id="create">+ ${t("createRoom")}</button></div>
    <ul class="room-list" id="rooms"><li class="rooms-empty">${live ? t("loading") : t("onlinePreview")}</li></ul>
    ${error ? `<p class="err">${esc(error)}</p>` : ""}
    <div class="online-more">
      <span class="tag">${t("haveCode")}</span>
      <div class="join"><input id="code" maxlength="4" placeholder="${t("roomCode")}" autocomplete="off" dir="ltr">
        <button class="btn join-go" id="join">${t("join")}</button></div>
    </div>
  </div>`;
  bindBack();
  const name = () => store.get("br.name");
  const canPlay = () => gamesLeft() > 0 || (openStore(t("outOfGames")), false);
  // Online rooms have no settings to choose: Create makes the room straight away (10 players, Start at 7).
  app.querySelector("#create").onclick = () => { if (canPlay()) enterRoom(newCode(), store.get("br.name"), true, { online: true, max: CONFIG.ONLINE_ROOMS[0].max }); };
  const join = () => {
    const c = app.querySelector("#code").value.trim().toUpperCase();
    if (/^[A-Z]{4}$/.test(c)) { if (canPlay()) enterRoom(c, name(), false, null, "online"); } else app.querySelector("#code").focus();
  };
  app.querySelector("#join").onclick = join;
  app.querySelector("#code").onkeydown = e => { if (e.key === "Enter") join(); };
  const list = app.querySelector("#rooms");
  list.onclick = e => { const b = e.target.closest("[data-code]"); if (b && !b.disabled && canPlay()) enterRoom(b.dataset.code, name(), false, null, "online"); };
  if (!live) return;
  // Room list, refreshed every 4s while this screen is open.
  const load = async () => {
    if (!app.contains(list)) return clearInterval(timer);
    let rooms; try { rooms = await rpc("list_rooms"); } catch { return; }
    if (!app.contains(list)) return;
    list.innerHTML = rooms.length ? rooms.map(r => {
      const open = r.status === "lobby" && r.players < r.max && !r.mine;
      const state = r.status !== "lobby" ? t("roomPlaying") : r.players >= r.max ? t("roomFull") : r.mine ? t("roomYours") : t("join");
      return `<li><button class="room-card ${open ? "" : "closed"}" data-code="${esc(r.code)}" ${open ? "" : "disabled"}>
        <span class="rc-main"><b dir="ltr">${esc(r.code)}</b><small>${t("roomOf", { name: esc(r.host) })}</small></span>
        <span class="rc-seats"><em>${r.players}/${r.max}</em><span class="lbar"><i style="width:${Math.min(1, r.players / r.max) * 100}%"></i></span></span>
        <span class="rc-go">${state}</span></button></li>`;
    }).join("") : `<li class="rooms-empty">${t("noRooms")}</li>`;
  };
  const timer = setInterval(load, 4000); load();
}

// Room options before an online room is made: room size 8 or 12 (Start unlocks at 5 / 9 players, CONFIG.ONLINE_ROOMS).
// Create-room sheet: the game settings are chosen here, before the room exists (the lobby only shows them).
// Online rooms also pick a room size; their memorize/build times are always Auto.
function createRoomSheet(online) {
  let saved = {}, g = {}; try { saved = JSON.parse(store.get("br.roomOpts") || "{}"); g = JSON.parse(store.get("br.settings") || "{}"); } catch {}
  const o = { max: CONFIG.ONLINE_ROOMS.some(r => r.max === saved.max) ? saved.max : CONFIG.ONLINE_ROOMS[0].max };
  if (!("difficulty" in g)) { delete g.showMs; delete g.buildMs; }   // old saves → new "Auto" timings
  g = { mode: "elim", difficulty: "auto", showMs: "auto", buildMs: "auto", showOthers: true, ...g };
  delete g.room;
  if (online) Object.assign(g, { showMs: "auto", buildMs: "auto", showOthers: true });   // online: always see others
  // Best of 5 is a Private-room mode for Unlimited (monthly subscription) players only.
  if (online || !isUnlimited()) g.mode = "elim";
  document.querySelector(".store")?.remove();
  const el = document.createElement("div"); el.className = "store";
  const draw = () => {
    const seg = (key, list) => `<div class="seg">${list.map(([v, l]) =>
      `<button type="button" class="${o[key] === v ? "on" : ""}" data-k="${key}" data-v="${v}">${l}</button>`).join("")}</div>`;
    el.innerHTML = `<div class="store-card create-card" role="dialog" aria-modal="true" aria-label="${t("createRoom")}">
      <button class="chip ghost store-x" aria-label="${t("close")}">×</button>
      <div class="phase">${t("createRoom")}</div>
      ${online && CONFIG.ONLINE_ROOMS.length > 1 ? `<div class="settings sheet"><div class="set-row col"><span>${t("roomSize")}</span>${seg("max", CONFIG.ONLINE_ROOMS.map(r => [r.max, t("playersN", { n: r.max })]))}</div></div>` : ""}
      ${settingsPanel(g, true, online)}
      ${online ? `<p class="hint small">${t("onlineTimes")}</p>` : ""}
      <button class="btn wide" id="make">${t("createRoom")}</button>
    </div>`;
  };
  draw(); document.body.appendChild(el);
  el.onclick = e => {
    if (e.target === el || e.target.closest(".store-x")) return el.remove();
    const k = e.target.closest("[data-k]"), b = e.target.closest("[data-set],[data-step]");
    if (k) { o.max = +k.dataset.v; return draw(); }
    if (e.target.closest("[data-locked]")) return openStore(t("bo5Store"));
    if (b) {
      if (b.dataset.step) g[b.dataset.step] = stepTime(b.dataset.step, g[b.dataset.step], +b.dataset.d);
      else g[b.dataset.set] = b.dataset.set === "showOthers" ? b.dataset.v === "1" : b.dataset.v;
      const top = el.querySelector(".store-card").scrollTop; draw(); el.querySelector(".store-card").scrollTop = top; return;
    }
    if (e.target.closest("#make")) {
      const prev = (() => { try { return JSON.parse(store.get("br.settings") || "{}"); } catch { return {}; } })();
      // online forces Auto times + visible blocks; keep the private-room choices for next time
      store.set("br.settings", JSON.stringify(online ? { ...g, showMs: prev.showMs ?? "auto", buildMs: prev.buildMs ?? "auto", showOthers: prev.showOthers ?? true } : g)); el.remove();
      if (online) { store.set("br.roomOpts", JSON.stringify(o)); enterRoom(newCode(), store.get("br.name"), true, { online: true, ...o }); }
      else enterRoom(newCode(), store.get("br.name"), true);
    }
  };
}

function howToPlay() {
  app.innerHTML = `${header(backBtn)}
  <div class="stage howto">
    <div class="phase">${t("menuHowTo")}</div>
    <video class="howto-video" src="media/how-to-play.mp4" autoplay muted loop playsinline controls preload="auto"></video>
    <ol class="steps">${["how1", "how2", "how3", "how4", "how5"].map(k => `<li>${t(k)}</li>`).join("")}</ol>
    <div class="tag">${t("modesTitle")}</div>
    <ul class="steps modes"><li>${t("howElim")}</li><li>${t("howPoints")}</li></ul>
    ${store.get("br.onboard") === "prize" ? `<button class="btn wide" id="gotit">${t("gotIt")}</button>` : ""}
  </div>`;
  bindBack();
  app.querySelector("#gotit")?.addEventListener("click", () => { location.hash = "#menu"; });
}

// Leaderboards: most online wins today / this month (server days are UTC). Top 50, my row highlighted,
// my own rank underneath when I'm outside the top 50.
function leaderboard() {
  if (!store.get("br.name")) { location.hash = ""; return; }
  let period = store.get("br.lbPeriod") === "month" ? "month" : "day";
  let who = store.get("br.lbWho") === "friends" ? "friends" : "all";   // Everyone | Friends (me + people I added by ID)
  app.innerHTML = `${header(backBtn)}
  <div class="stage leaders">
    <div class="phase">${t("menuLeaders")}</div>
    <div class="seg" id="lbwho">${[["all", t("lbEveryone")], ["friends", t("lbFriends")]].map(([v, l]) =>
      `<button type="button" data-w="${v}">${l}</button>`).join("")}</div>
    <div class="prize-banner" ${rewardsShown() ? "" : "data-off"}>${ICON.trophy}<span>${t(daysLeftInMonth() === 1 ? "prizeBanner1" : "prizeBanner", { n: daysLeftInMonth() })}</span></div>
    <div class="friend-box" hidden>
      <div class="my-id"><span>${t("myId")}</span><b dir="ltr" id="myid">${idText(PROFILE.publicId)}</b>
        <button class="chip ghost" id="copyid">${ICON.share}<span>${t("copy")}</span></button></div>
      <div class="add-friend"><input id="fid" inputmode="numeric" maxlength="5" autocomplete="off" placeholder="${t("friendIdPh")}" aria-label="${t("friendIdPh")}">
        <button class="btn join-go" id="fadd">${t("addFriend")}</button></div>
      <p class="hint small" id="fmsg"></p>
      <div id="freqs"></div>
    </div>
    <div class="seg" id="lbtabs">${[["day", t("lbToday")], ["month", t("lbMonth")]].map(([v, l]) =>
      `<button type="button" data-p="${v}">${l}</button>`).join("")}</div>
    <div id="lb"></div>
  </div>`;
  bindBack();
  const box = app.querySelector("#lb"), fbox = app.querySelector(".friend-box"), msg = app.querySelector("#fmsg");
  let seq = 0;
  const load = async () => {
    app.querySelectorAll("#lbtabs button").forEach(b => b.classList.toggle("on", b.dataset.p === period));
    app.querySelectorAll("#lbwho button").forEach(b => b.classList.toggle("on", b.dataset.w === who));
    const pb = app.querySelector(".prize-banner"); pb.hidden = who === "friends" || pb.hasAttribute("data-off");
    fbox.hidden = who !== "friends";
    if (!serverOn()) { box.innerHTML = `<p class="hint">${t("lbOffline")}</p>`; return; }
    box.innerHTML = `<p class="hint">${t("loading")}</p>`;
    const mine = ++seq;
    const row = (x, me, del) => `<li class="${me ? "me" : ""}"><span class="rank">${x.rank}</span><span class="nm">${esc(x.name)}${streakTag(x.streak)}</span><b>${x.wins}</b>${
      del ? `<button class="fdel" data-id="${x.id}" data-name="${esc(x.name)}" aria-label="${t("remove")}">×</button>` : ""}</li>`;
    try {
      if (who === "friends") {
        if (!PROFILE.publicId) await refreshProfile();
        const idEl = app.querySelector("#myid"); if (idEl) idEl.textContent = idText(PROFILE.publicId);
        loadRequests();
        const r = await rpc("friends_board", { p_period: period });
        if (mine !== seq || !app.contains(box)) return;
        const rows = r.rows || [];
        box.innerHTML = `<ol class="board lb friends">${rows.map(x => row(x, x.me, !x.me)).join("")}</ol>
          ${rows.length < 2 ? `<p class="hint small">${t("friendsEmpty")}</p>` : ""}`;
      } else {
        const r = await rpc("leaderboard", { p_period: period });
        if (mine !== seq || !app.contains(box)) return;
        box.innerHTML = r.top.length
          ? `<ol class="board lb">${r.top.map(x => row(x, x.me)).join("")}</ol>
             ${r.me && !r.top.some(x => x.me) ? `<ol class="board lb mine">${row({ ...r.me, name: store.get("br.name"), streak: PROFILE.streak }, true)}</ol>` : ""}`
          : `<p class="hint">${t(period === "day" ? "lbEmptyDay" : "lbEmptyMonth")}</p>`;
        if (!r.me) box.insertAdjacentHTML("beforeend", `<p class="hint small">${t("lbHow")}</p>`);
      }
    } catch { if (mine === seq && app.contains(box)) box.innerHTML = `<p class="err">${t("serverErr")}</p>`; }
  };
  app.querySelector("#lbtabs").onclick = e => { const b = e.target.closest("[data-p]"); if (!b || b.dataset.p === period) return;
    period = b.dataset.p; store.set("br.lbPeriod", period); load(); };
  app.querySelector("#lbwho").onclick = e => { const b = e.target.closest("[data-w]"); if (!b || b.dataset.w === who) return;
    who = b.dataset.w; store.set("br.lbWho", who); msg.textContent = ""; load(); };
  // My ID: share sheet in the app, otherwise copy to the clipboard.
  app.querySelector("#copyid").onclick = async () => {
    const id = PROFILE.publicId; if (!id) return;
    const text = t("shareIdText", { id: idText(id) });
    try { const sh = window.Capacitor?.Plugins?.Share; if (sh) { await sh.share({ text }); return; } } catch { return; }
    try { await navigator.clipboard.writeText(idText(id)); toast(t("idCopied")); } catch {}
  };
  const say = (txt, bad) => { msg.textContent = txt; msg.classList.toggle("err", !!bad); };
  const input = app.querySelector("#fid");
  input.oninput = () => { input.value = input.value.replace(/\D/g, "").slice(0, 5); };
  const add = async () => {
    const id = input.value.trim();
    if (!/^\d{5}$/.test(id)) return say(t("friendBadId"), true);
    let r; try { r = await rpc("add_friend", { p_id: +id }); } catch { return say(t("serverErr"), true); }
    if (r.ok) { input.value = ""; say(t(r.status === "friends" ? "friendNowFriends" : "friendRequestSent", { name: r.name })); play("place"); load(); return; }
    say(t({ notfound: "friendNotFound", self: "friendSelf", already: "friendAlready", full: "friendsFull", theirFull: "friendsTheirFull",
            pending: "friendPending" }[r.reason] || "serverErr", { name: r.name || "" }), true);
  };
  // Friend requests: ones waiting for my answer (Accept / Decline) and ones I sent (Cancel).
  const reqs = app.querySelector("#freqs");
  async function loadRequests() {
    let r; try { r = await rpc("friend_requests"); } catch { return; }
    if (!app.contains(reqs)) return;
    const row = (x, btns) => `<li><span class="nm">${esc(x.name)}<small dir="ltr">${idText(x.id)}</small></span>${btns(x)}</li>`;
    reqs.innerHTML = (r.incoming.length ? `<div class="tag">${t("friendRequests")}</div><ul class="freq-list">${r.incoming.map(x => row(x, x =>
        `<button class="btn join-go small" data-acc="${x.id}">${t("accept")}</button><button class="btn ghost small" data-dec="${x.id}">${t("decline")}</button>`)).join("")}</ul>` : "")
      + (r.sent.length ? `<div class="tag">${t("friendSent")}</div><ul class="freq-list sent">${r.sent.map(x => row(x, x =>
        `<button class="btn ghost small" data-can="${x.id}">${t("cancel")}</button>`)).join("")}</ul>` : "");
    const tab = app.querySelector('#lbwho [data-w="friends"]');
    if (tab) tab.textContent = r.incoming.length ? `${t("lbFriends")} (${r.incoming.length})` : t("lbFriends");
  }
  reqs.onclick = async e => {
    const b = e.target.closest("[data-acc],[data-dec],[data-can]"); if (!b) return;
    b.disabled = true;
    try {
      if (b.dataset.can) await rpc("cancel_friend_request", { p_id: +b.dataset.can });
      else {
        const r = await rpc("answer_friend_request", { p_id: +(b.dataset.acc || b.dataset.dec), p_accept: !!b.dataset.acc });
        if (!r.ok && r.reason) say(t(r.reason === "full" ? "friendsFull" : "friendsTheirFull", { name: "" }), true);
        else if (b.dataset.acc) play("place");
      }
    } catch { say(t("serverErr"), true); }
    load();
  };
  app.querySelector("#fadd").onclick = add;
  input.onkeydown = e => { if (e.key === "Enter") add(); };
  box.onclick = async e => {
    const b = e.target.closest(".fdel"); if (!b) return;
    if (!(await confirmPop(t("removeFriendQ", { name: b.dataset.name }), t("remove")))) return;
    try { await rpc("remove_friend", { p_id: +b.dataset.id }); } catch { return say(t("serverErr"), true); }
    say(""); load();
  };
  load();
}

// Small yes/no pop-up (same look as the leave-match one). Resolves true when the red button is pressed.
function confirmPop(text, yes, title = "") {
  document.querySelector(".leave-pop")?.remove();
  const el = document.createElement("div"); el.className = "store leave-pop";
  el.innerHTML = `<div class="store-card" role="alertdialog" aria-modal="true">
    ${title ? `<div class="phase">${title}</div>` : ""}<p class="hint">${text}</p>
    <div class="leave-btns"><button class="btn ghost" id="stay">${t("close")}</button>
      <button class="btn danger" id="goleave">${yes}</button></div></div>`;
  document.body.appendChild(el);
  return new Promise(res => {
    el.onclick = e => {
      const ok = !!e.target.closest("#goleave");
      if (ok || e.target === el || e.target.closest("#stay")) { el.remove(); res(ok); }
    };
  });
}

/* ---------- Daily / Weekly challenge ---------- */
// Solo and checked by the SERVER: it picks my random shapes one at a time (daily: easy, medium, medium; weekly: 3 hard),
// times each shape and scores the build itself. 100% on all 3 → +1 game (daily) / +5 (weekly). 1 try per day / week.
// Day = midnight Qatar time, week = Saturday 12:00 noon Qatar time (server side). Free: costs no game.
const CH_KINDS = ["daily", "weekly"];
let CH = null;   // the challenge being played { kind, shape, step, build, given, showEnd, buildEnd, ... }
const untilText = iso => { const ms = Math.max(0, Date.parse(iso) - Date.now()), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60;
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : h ? `${h}h ${m}m` : `${Math.max(1, m)}m`; };
const canonKey = k => Object.keys(HEX).find(c => HEX[c] === HEX[k]);   // keys sharing a color are one color (server cells use the first)

// Challenges button: a bottom sheet over the main menu (the menu behind is dimmed); tap outside or × to close.
function openChallenges() {
  stopChallenge();
  document.querySelector(".ch-sheet")?.remove();
  const el = document.createElement("div"); el.className = "store ch-sheet";
  el.innerHTML = `<div class="ch-panel" role="dialog" aria-modal="true" aria-label="${t("menuChallenges")}">
    <i class="ch-grab" aria-hidden="true"></i>
    <button class="chip ghost store-x" aria-label="${t("close")}">×</button>
    <div class="phase">${t("menuChallenges")}</div>
    ${CH_KINDS.map(k => `<div class="ch-card ${k}" id="ch-${k}">
      <div class="ch-head"><b>${t(k === "daily" ? "chDaily" : "chWeekly")}</b>${rewardsShown() ? `<span class="ch-prize">${t(k === "daily" ? "chPrizeDaily" : "chPrizeWeekly")}</span>` : ""}</div>
      <p class="hint">${t("chRequire")}</p>
      <div class="ch-body"><p class="hint small">${t("loading")}</p></div></div>`).join("")}
  </div>`;
  document.body.appendChild(el);
  const close = () => { el.classList.add("out"); setTimeout(() => el.remove(), 200); };
  el.onclick = e => { if (e.target === el || e.target.closest(".store-x")) close(); };
  if (!serverOn()) { el.querySelectorAll(".ch-body").forEach(b => { b.innerHTML = `<p class="hint">${t("chOffline")}</p>`; }); return; }
  for (const k of CH_KINDS) rpc("challenge_status", { p_kind: k }).then(v => chCard(k, v))
    .catch(() => { const b = document.querySelector(`#ch-${k} .ch-body`); if (b) b.innerHTML = `<p class="err">${t("serverErr")}</p>`; });
}

function chCard(kind, v) {
  const body = document.querySelector(`#ch-${kind} .ch-body`); if (!body) return;
  const open = v.status === "new" || v.status === "playing";
  body.innerHTML = `
    ${open ? `<button class="btn wide ch-go" data-k="${kind}">${t(v.status === "new" ? "chPlay" : "chContinue")}</button>`
      : `<p class="${v.status === "won" ? "good" : "err"}">${v.status === "won" ? t(!rewardsShown() ? "chWonPlain" : kind === "daily" ? "chWonDaily" : "chWonWeekly") : t("chLostCard")}</p>
         <p class="hint small">${t("chResets", { t: untilText(v.resetsAt) })}</p>`}
    ${kind === "weekly" && v.winPct != null ? `<p class="hint small ch-pct">${v.winPct ? t("chWinPct", { n: v.winPct }) : t("chWinPct0")}</p>` : ""}`;
  const go = body.querySelector(".ch-go");
  if (go) go.onclick = async () => {
    if (v.status === "new" && !(await confirmPop(t("chReady"), t("chStart"), t("chReadyTitle")))) return;
    document.querySelector(".ch-sheet")?.remove();
    chStart(kind);
  };
}

// After a challenge: main menu with the Challenges sheet open again.
function backToChallenges() { stopChallenge(); if (location.hash !== "#menu") history.replaceState(null, "", "#menu"); home(); openChallenges(); }

function stopChallenge() { if (CH) { clearInterval(CH.tick); CH = null; } }

async function chStart(kind) {
  stopChallenge();
  const run = CH = { kind };
  let r; try { r = await rpc("challenge_next", { p_kind: kind }); } catch { if (CH === run) { CH = null; toast(t("serverErr")); } return; }
  if (CH !== run) return;
  if (!r.ok) return chEnd(run, r.view);
  chShape(run, r);
}

// A new shape from the server: memorize / build deadlines come from the server's clock (elapsed), not this phone's.
function chShape(run, r) {
  const tgt = builds.get(r.shape);
  if (!tgt) { CH = null; toast(t("serverErr")); return backToChallenges(); }
  const t0 = Date.now() - (r.elapsed || 0);
  Object.assign(run, { shape: tgt, step: r.step, showMs: r.show, buildMs: r.build, showEnd: t0 + r.show, buildEnd: t0 + r.show + r.build, sent: false, lastTick: 0 });
  run.build = empty(); run.given = givenCells(tgt.vox);   // unique hidden blocks come pre-placed, like in matches
  for (const i of run.given) run.build[i] = tgt.vox[i];
  chRender(run);
  clearInterval(run.tick);
  run.tick = setInterval(() => chTick(run), 100);
}

function chRender(run) {
  if (CH !== run) return;
  textSelect(false);
  bgPause();
  const tgt = run.shape, memorize = Date.now() < run.showEnd;
  run.phase = memorize ? "show" : "build";
  app.innerHTML = `${header(`<button class="chip ghost" id="chback" aria-label="${t("back")}">←</button>`)}
  <div class="stage arena-stage">
    <div class="meta"><span>${t(run.kind === "daily" ? "chDaily" : "chWeekly")}</span><span>${t("chShapeN", { n: run.step + 1 })}</span></div>
    ${timerBlock(run.phase, t(memorize ? "memorize" : "build"))}
    <div class="arena"><div id="bld"></div><div class="pop" id="pop" hidden></div>
      ${memorize ? `<div class="shape-name">${esc(buildName(tgt))}</div>` : ""}</div>
    <p class="hint">${t(memorize ? "memorizeHint" : "buildHint")}</p>
    <div class="row"><button class="btn danger" id="clearall" ${memorize ? "disabled" : ""}>${t("clearAll")}</button></div>
    ${memorize ? "" : `<p class="kbd-hint">${t("kbdHint")}</p>`}
  </div>`;
  const { world } = islandLayout(1, 0), zoom = LAYOUT_ZOOM[document.documentElement.dataset.layout] || 1;
  run.builder = mountBuilder(app.querySelector("#bld"), run.build, paletteOf(tgt.vox), { t, cam, limits: colorCounts(tgt.vox), outsideClear: true, fixed: run.given,
    scene: () => ({ vox: Date.now() < run.showEnd ? tgt.vox : null, name: store.get("br.name"), style: store.get("br.style") || null,
                    streak: PROFILE.streak, outline: true, world, zoom }),
    onChange: () => { if (score(tgt.vox, run.build) === 100) { play("perfect"); chSubmit(run); } } });   // 100% → sent at once
  app.querySelector("#clearall").onclick = () => run.builder.clear();
  if (memorize) run.builder.disable();
  app.querySelector("#chback").onclick = async () => {
    if (!(await confirmPop(t("chLeaveQ"), t("leaveMatch"), t("chLeaveTitle")))) return;
    if (CH === run) { stopChallenge(); location.hash = "#menu"; }
  };
}

function chTick(run) {
  if (CH !== run || run.sent) return;
  const now = Date.now();
  if (run.phase === "show" && now >= run.showEnd) return chRender(run);   // memorize over: the shape disappears, build
  if (run.phase === "build" && now >= run.buildEnd) return chSubmit(run);  // time's up: send what I have
  const end = run.phase === "show" ? run.showEnd : run.buildEnd;
  const left = Math.max(0, end - now), span = run.phase === "show" ? run.showMs : run.buildMs;
  const bar = app.querySelector("#bar"), ph = app.querySelector("#ph");
  if (bar && span) bar.style.width = `${Math.min(100, (left / span) * 100)}%`;
  if (ph && ph.dataset.label) ph.textContent = `${ph.dataset.label} · ${Math.ceil(left / 1000)}s`;
  const sec = Math.ceil(left / 1000);
  if (run.phase === "build" && sec >= 1 && sec <= 7 && run.lastTick !== sec) { run.lastTick = sec; play("tick"); }
}

async function chSubmit(run) {
  if (run.sent || CH !== run) return;
  run.sent = true; clearInterval(run.tick);
  run.builder?.disable();
  const b = app.querySelector("#clearall"); if (b) b.disabled = true;
  const pop = app.querySelector("#pop");
  if (pop) { pop.innerHTML = `<div class="pop-sub">${t("chChecking")}</div>`; pop.hidden = false; }
  const cells = run.build.map(c => (c ? canonKey(c) : ".")).join("");
  let r = null;
  for (let i = 0; i < 3 && !r; i++) {
    try { r = await rpc("challenge_submit", { p_kind: run.kind, p_build: cells }); }
    catch { await new Promise(res => setTimeout(res, 1500)); }
  }
  if (CH !== run) return;
  if (!r) { CH = null; toast(t("serverErr")); return backToChallenges(); }
  if (!r.ok) {   // already decided (time ran out, or an earlier send got through): show the server's verdict
    let v = r.view; if (!v) { try { v = await rpc("challenge_status", { p_kind: run.kind }); } catch {} }
    return v ? chEnd(run, v) : backToChallenges();
  }
  if (r.view.status === "playing") {   // perfect, more shapes to go
    if (pop) { pop.innerHTML = `<div class="pop-title perfect">${t("perfect")}</div><div class="pop-sub">${t("chNextShape")}</div>`; pop.hidden = false; }
    setTimeout(async () => {
      if (CH !== run) return;
      let n; try { n = await rpc("challenge_next", { p_kind: run.kind }); } catch { CH = null; toast(t("serverErr")); return backToChallenges(); }
      if (CH !== run) return;
      n.ok ? chShape(run, n) : chEnd(run, n.view);
    }, 1800);
  } else chEnd(run, r.view);
}

// Result pop-up: won (+games) or over (which shape, its %), then back to the Challenges screen.
function chEnd(run, v) {
  if (CH === run) stopChallenge();
  const won = v.status === "won", daily = run.kind === "daily";
  const last = v.scores.length, time = !won && last <= v.step;   // no score for the current shape = its time ran out
  if (won) syncTime();   // games left goes up
  setTimeout(maybeAskNotifications, 2500);
  const el = document.createElement("div"); el.className = "store reward-pop";
  el.innerHTML = `<div class="store-card" role="dialog" aria-modal="true">
    <div class="phase">${t(won ? "chWinTitle" : "chFailTitle")}</div>
    ${won ? (rewardsShown() ? `<div class="reward-big">+${v.reward}</div><p class="hint">${t(daily ? "chWinDaily" : "chWinWeekly")}</p>` : `<p class="hint">${t("chWinPlain")}</p>`)
      : `<p class="hint">${time ? t("chFailTime", { s: v.step + 1 }) : t("chFail", { n: v.scores[last - 1], s: last })}</p>
         <p class="hint small">${t(daily ? "chAgainDay" : "chAgainWeek")}</p>`}
    <button class="btn wide" id="chok">${t("ok")}</button></div>`;
  document.body.appendChild(el); play(won ? "win" : "remove");
  el.onclick = e => { if (e.target === el || e.target.closest("#chok")) { el.remove(); backToChallenges(); } };
}

// My display name on the server (leaderboards).
function syncName() { const n = store.get("br.name"); if (serverOn() && n) rpc("set_name", { p_name: n }).catch(() => {}); }

const newCode = () => Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ"[Math.floor(Math.random() * 24)]).join("");

function editor() {
  mountEditor(app, { builds, header, onExit: () => { location.hash = "#menu"; } });
}

// Shapes library: every build sits on its own island around the circle; ‹ › flies to the next one.
function shapesScreen() {
  const list = [...builds.values()], scam = { ...newCam(), pitch: 22 * Math.PI / 180 };
  let at = 0;
  app.innerHTML = `${header(`<button class="chip ghost" id="back">←</button>`)}
  <div class="stage">
    <div class="phase">${t("shapes")}</div>
    <div class="specnav"><button class="chip" id="sprev" aria-label="${t("prevShape")}">‹</button>
      <span id="swho"></span><button class="chip" id="snext" aria-label="${t("nextShape")}">›</button></div>
    <div id="bld"></div>
    <p class="hint" id="sinfo"></p>
  </div>`;
  const redraw = mountScene(app.querySelector("#bld"), t, scam, () => {
    // Library only: roomy circle (~20 tiles between neighbours) since it holds many more islands than a game.
    const b = list[at], { offs, world } = islandLayout(list.length, at, Math.max(arenaDiameter(list.length), 20 * list.length / Math.PI));
    app.querySelector("#swho").textContent = `${at + 1} / ${list.length} · ${b.name.en}`;
    app.querySelector("#sinfo").textContent = t("shapeInfo", { n: b.vox.filter(Boolean).length, c: ((k) => `${k} color${k === 1 ? "" : "s"}`)(paletteOf(b.vox).length) });
    return { vox: b.vox, name: b.name.en, world,
             neighbours: list.map((o, i) => i === at ? null : { vox: o.vox, off: offs[i], name: o.name.en }).filter(Boolean) };
  });
  const step = d => { at = (at + d + list.length) % list.length; redraw(); };
  app.querySelector("#sprev").onclick = () => step(-1);
  app.querySelector("#snext").onclick = () => step(1);
  app.querySelector("#back").onclick = () => { location.hash = "#menu"; };
}

// Arena preview: empty islands laid out for a chosen player count, to check spacing and look.
function arenaPreview(n = 2) {
  const pcam = { ...newCam(), pitch: 18 * Math.PI / 180 };   // a bit lower than in-game so the circle is visible
  const render = () => {
    app.innerHTML = `${header(`<button class="chip ghost" id="back">←</button>`)}
    <div class="stage">
      <div class="phase">${t("arenaPreview")}</div>
      <div class="row layers" id="counts">${Array.from({ length: 15 }, (_, i) => i + 2).map(k =>
        `<button data-n="${k}" class="${k === n ? "on" : ""}">${k}</button>`).join("")}</div>
      <div id="bld"></div>
      <p class="hint">${t("arenaHint", { n, d: Math.round(arenaDiameter(n)) })}</p>
    </div>`;
    const names = Array.from({ length: n }, (_, i) => `P${i + 1}`), none = empty();
    mountScene(app.querySelector("#bld"), t, pcam, () => {
      const { offs, world } = islandLayout(n, 0);
      return { vox: none, name: names[0], outline: true, world,
               neighbours: offs.slice(1).map((off, i) => ({ vox: none, off, name: names[i + 1] })) };
    });
    app.querySelector("#back").onclick = () => { location.hash = "#menu"; };
    app.querySelector("#counts").onclick = e => { const b = e.target.closest("button"); if (b) { n = +b.dataset.n; render(); } };
  };
  render();
}

/* ---------- room connection ---------- */
// Keep the room's server entry fresh while I'm its host: player count + lobby/playing. A new host after migration
// first (re)claims the code (the old host removed it on leave, or it goes stale after 30s).
function keepListed(code, online, max, claimed = false) {
  const beat = async () => {
    if (!S.host || !S.state) return;
    try {
      if (!claimed) claimed = await rpc("claim_room", { p_code: code, p_online: online, p_max: max });
      if (claimed) await rpc("room_heartbeat", { p_code: code, p_players: S.state.players.length, p_status: S.state.phase === "lobby" ? "lobby" : "playing" });
    } catch {}
  };
  clearInterval(S.roomBeat); S.roomBeat = setInterval(beat, CONFIG.ROOM_HEARTBEAT_MS); S.listed = code; setTimeout(beat, 1500);
}

// kind ("online" | "private"): which screen a joiner came from; the host rejects codes of the other kind.
async function enterRoom(code, name, asHost, room = null, kind = null) {
  app.innerHTML = `${header(roomBack)}<div class="stage"><p class="hint">${t("connecting")}</p></div>`;
  const listed = asHost && transportName() === "supabase";
  if (listed) {   // register the code (online rooms show up in Quick match); taken → try another code
    let got = false;
    for (let i = 0; i < 5 && !got; i++) {
      try { got = await rpc("claim_room", { p_code: code, p_online: !!room?.online, p_max: room?.max || CONFIG.MAX_PLAYERS }); } catch (e) { return home(t("serverErr")); }
      if (!got) code = newCode();
    }
    if (!got) return home(t("serverErr"));
  }
  S.room = code;
  try {
    // Messages from a room I already left (late broadcasts) must not redraw its lobby: only the current connection counts.
    const conn = S.conn = {};
    const net = await connect(code, m => { if (S.conn === conn) onMessage(m); });
    if (S.conn !== conn) { net.close(); return; }   // left while connecting
    S.net = net;
  } catch (e) { return home(String(e.message || e)); }
  if (asHost) {
    let saved = {}; try { saved = JSON.parse(store.get("br.settings") || "{}"); } catch {}
    if (!("difficulty" in saved)) { delete saved.showMs; delete saved.buildMs; }   // old saves → new "Auto" timings
    delete saved.room;
    // Online rooms always use Auto timings (by shape level).
    // Online rooms have no settings (user, 2026-10-07): Elimination, Auto difficulty + timings, everyone's blocks visible.
    if (room) Object.assign(saved, { room, difficulty: "auto", showMs: "auto", buildMs: "auto", showOthers: true });
    if (room || !isUnlimited()) saved.mode = "elim";   // Best of 5: Private rooms + Unlimited only
    S.host = createHost({ net: S.net, selfId, builds, settings: saved });
    if (listed) keepListed(code, !!room?.online, room?.max || CONFIG.MAX_PLAYERS, true);
  }
  S.hello = () => ({ t: "hello", from: selfId, name, kind, ver: CONFIG.APP_VERSION, unl: isUnlimited(), style: store.get("br.style") || null, streak: PROFILE.streak || 0 });
  S.net.send(S.hello());   // host ignores it in local rooms
  S.ping = setInterval(() => {
    if (!S.net) return;
    S.net.send({ t: "ping", from: selfId });
    if (S.state && (S.state.phase === "build" || S.state.phase === "collect") && me()?.alive) sendProgress(true);   // resync
  }, CONFIG.HEARTBEAT_MS);
  if (!asHost) S.joinTimer = setTimeout(() => { if (!S.state) home(t("noRoom")); }, 4000);
}

function leaveRoom() {
  if (S.net) { S.net.send({ t: "bye", from: selfId }); S.net.close(); }
  if (S.host) S.host.stop();
  if (S.listed) rpc("close_room", { p_code: S.listed }).catch(() => {});
  clearInterval(S.ping); clearInterval(S.roomBeat); clearTimeout(S.joinTimer);
  document.querySelector(".say-pop")?.remove();
  if (S.migrating) clearTimeout(S.migrating.timer);
  document.querySelector(".migrate")?.remove();
  Object.assign(S, { migrating: null, lastSubmit: null, says: {}, net: null, conn: null, host: null, room: null, listed: null, roomBeat: null, buildRound: 0, state: null, key: null, build: null, submitted: false, builder: null, specRedraw: null,
    quizQ: 0 });
}

function onMessage(m) {
  if (S.host) S.host.onMessage(m);
  if (m.t === "reject" && m.to === selfId) {
    if (m.reason === "needsUnlimited") { home(); return openStore(t("needsUnlimited")); }   // Best of 5 room
    return home(t(m.reason));
  }
  if (m.t === "bye" && S.state && m.from === S.state.host && m.from !== selfId) return startMigration();
  if (m.t === "say") return onSay(m);
  if (m.t === "progress") {   // live neighbour blocks
    if (m.from !== selfId && S.state && m.round === S.state.round && m.game === S.state.game) {
      S.plots[m.from] = parseLayers(m.layers);
      S.builder && S.builder.redraw(); S.specRedraw && S.specRedraw();
    }
    return;
  }
  if (m.t !== "state") return;
  if (S.host && m.from !== selfId && m.state.host !== selfId && S.state && m.state.matchId === S.state.matchId) {
    // I was the host but my phone was away too long and the room picked a new host: stop hosting, follow them.
    S.host.stop(); S.host = null;
    if (S.state) S.state = { ...S.state, host: m.state.host };
    if (!m.state.players.some(p => p.id === selfId)) {
      if (m.state.phase === "lobby") S.net.send(S.hello());
      else return home(t("awayTooLong"));
    }
  }
  // Only our host's states count; during a host migration, the chosen new host's too.
  if (S.state && m.from !== S.state.host && !(S.migrating && m.from === S.migrating.order[S.migrating.pick])) return;
  if (!m.state.players.some(p => p.id === selfId)) return;  // not (yet) in this room
  clearTimeout(S.joinTimer);
  if (S.migrating && m.state.host !== S.migrating.old) finishMigration(m.state);
  const prev = S.state?.phase;
  S.state = m.state; S.deadline = Date.now() + m.state.remainingMs; S.lastStateAt = Date.now();
  S.autoStartAt = m.state.autoStartMs != null ? Date.now() + m.state.autoStartMs : 0;
  const now = m.state.phase;
  if (now === "show" && m.state.round === 1 && prev !== "show") {   // a new match starts → spend a game
    const key = matchKey(m.state);
    chargeMatch(key, S.room).then(ok => { if (!ok && S.state && matchKey(S.state) === key) { home(); openStore(t("outOfGames")); } });
  }
  if (prev && prev !== now) {   // phase-change sounds
    if (now === "build" || (prev === "build" && (now === "collect" || now === "judge"))) play("round");
    if (now === "over") {
      play("win");
      // Online wins count for the leaderboards; the first 2 a day earn a free game (the server checks both;
      // Private wins don't count, so they can't be farmed with friends on one Wi-Fi).
      if (m.state.winner === selfId && transportName() === "supabase" && m.state.settings.room?.online)
        claimWin(matchKey(m.state)).then(n => { if (n && !webOpen) winRewardPopup(n); });   // website: games are unlimited, no "+1 game" pop-up
    }
  }
  render();
}

const matchKey = st => `${S.room}:${st.matchId || st.game}`;

// Pop-up after an online win that earned a free game (1st or 2nd of the day).
function winRewardPopup(n) {
  document.querySelector(".reward-pop")?.remove();
  const el = document.createElement("div"); el.className = "store reward-pop";
  el.innerHTML = `<div class="store-card" role="dialog" aria-modal="true">
    <div class="phase">${t("rewardTitle")}</div>
    <div class="reward-big">+1</div>
    <p class="hint">${t(n === 1 ? "rewardFirst" : "rewardLast")}</p>
    <button class="btn wide" id="rewardok">${t("ok")}</button></div>`;
  document.body.appendChild(el); play("perfect");
  el.onclick = e => { if (e.target === el || e.target.closest("#rewardok")) el.remove(); };
}

// "N online" pill: real players right now + `onlineBase` from the remote store config (Supabase store_config,
// default 0 = the real count), so it can be changed without an app update.
const shownOnline = n => (n == null ? "–" : String(n + (storeConfig().onlineBase || 0)));

/* ---------- app version gate ---------- */
// iOS app only (the website is always current): compared with the server's store_config on launch and on return
// to the foreground. Below minVersion → blocking "Update required"; below latestVersion → optional prompt (once per version).
const isApp = () => !!window.Capacitor?.isNativePlatform?.();
function checkVersion() {
  if (!isApp() || window.Capacitor.getPlatform?.() !== "ios") return;   // App Store link + version numbers are iPhone-only for now
  const cfg = storeConfig(), v = CONFIG.APP_VERSION;
  const must = cmpVersion(v, cfg.minVersion) < 0, can = cmpVersion(v, cfg.latestVersion) < 0;
  document.querySelector(".update-pop")?.remove();
  if (!must && (!can || store.get("br.skipVersion") === cfg.latestVersion)) return;
  const el = document.createElement("div"); el.className = "store update-pop";
  el.innerHTML = `<div class="store-card" role="alertdialog" aria-modal="true">
    <img src="img/icon-192.png" alt="" class="update-icon">
    <div class="phase">${t(must ? "updateTitle" : "updateNewTitle")}</div>
    <p class="hint">${t(must ? "updateBody" : "updateNewBody")}</p>
    <button class="btn wide" id="doupdate">${t("updateBtn")}</button>
    ${must ? "" : `<button class="link" id="later">${t("later")}</button>`}</div>`;
  document.body.appendChild(el);
  el.querySelector("#doupdate").onclick = () => { if (cfg.appStoreUrl) location.href = cfg.appStoreUrl; };
  el.querySelector("#later")?.addEventListener("click", () => { store.set("br.skipVersion", cfg.latestVersion); el.remove(); });
}

/* ---------- host migration ---------- */
// The host left (bye) or went silent: the game pauses, everyone shows the same countdown and picks the same new
// host (next player in join order). That player rebuilds the room from the last state and continues the phase
// with the time that was left; if they don't take over in time, the next player in line does.
const MIGRATE_MS = 3000, NEW_HOST_WAIT_MS = 4000;
function startMigration() {
  if (S.migrating || !S.state || !S.net || S.host) return;
  const snap = JSON.parse(JSON.stringify(S.state)), old = snap.host;
  const order = snap.players.map(p => p.id).filter(id => id !== old);
  if (!order.length) return home(t("hostLeft"));
  S.migrating = { snap, old, order, pick: 0, remaining: Math.max(0, S.deadline - S.lastStateAt) };
  S.builder?.disable();
  play("round");
  migrateStep();
}
function migrateStep() {
  const mg = S.migrating; if (!mg) return;
  const cand = mg.order[mg.pick];
  if (!cand) return home(t("hostLeft"));
  mg.until = Date.now() + MIGRATE_MS;
  clearTimeout(mg.timer);
  mg.timer = setTimeout(() => {
    if (S.migrating !== mg) return;
    if (cand === selfId) becomeHost(mg);
    else mg.timer = setTimeout(() => { if (S.migrating === mg) { mg.pick++; migrateStep(); } }, NEW_HOST_WAIT_MS);
  }, MIGRATE_MS);
  migrateTick();
}
function becomeHost(mg) {
  const settings = mg.snap.settings;
  S.host = createHost({ net: S.net, selfId, builds, settings, resume: { snap: mg.snap, oldHost: mg.old, remainingMs: mg.remaining } });
  if (transportName() === "supabase") keepListed(S.room, !!settings.room?.online, settings.room?.max || CONFIG.MAX_PLAYERS);
}
function finishMigration(st) {
  const mg = S.migrating; clearTimeout(mg.timer); S.migrating = null;
  document.querySelector(".migrate")?.remove();
  const who = st.players.find(p => p.id === st.host);
  toast(st.host === selfId ? t("youAreHost") : t("newHost", { name: esc(who?.name || "?") }));
  S.key = null;   // redraw the screen (re-enables building)
  if (S.submitted && S.lastSubmit && S.lastSubmit.round === st.round) S.net.send(S.lastSubmit);   // the new host needs my build
}
// Pause pop-up: "Host left" + 3-2-1 while choosing, then "Waiting for <name>…".
function migrateTick() {
  const mg = S.migrating; if (!mg) return;
  let el = document.querySelector(".migrate");
  if (!el) {
    el = document.createElement("div"); el.className = "migrate";
    el.innerHTML = `<div class="cd-card"><div class="tag">${t("hostLeftTag")}</div><b></b><span></span></div>`;
    document.body.appendChild(el);
  }
  const sec = Math.ceil((mg.until - Date.now()) / 1000), b = el.querySelector("b"), sp = el.querySelector("span");
  const cand = mg.snap.players.find(p => p.id === mg.order[mg.pick]);
  if (sec > 0) {
    if (b.textContent !== String(sec)) { b.textContent = sec; b.classList.remove("bump"); void b.offsetWidth; b.classList.add("bump"); play("tick"); }
    sp.textContent = t("choosingHost");
  } else { b.textContent = "…"; sp.textContent = cand?.id === selfId ? t("youAreHost") : t("waitingFor", { name: cand?.name || "?" }); }
}

/* ---------- purchases ---------- */
// Store buttons → Apple's purchase sheet (iOS app). The server verifies with Apple and credits the player; the
// "credited" event then shows the result. On the web there's nothing to buy yet.
const LEGAL = { terms: "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/",
                rules: "https://yousefalharami.github.io/block-rush/support.html#rules",
                privacy: "https://yousefalharami.github.io/block-rush/privacy.html" };
async function buyPack(opt, el) {
  const msg = el.querySelector("#buy-msg"), show = (k, color = "") => { msg.hidden = false; msg.textContent = t(k); msg.style.color = color; };
  if (!iapAvailable()) return show("buyInApp");
  if (el.querySelector(".store-opt[disabled]")) return;
  el.querySelectorAll(".store-opt").forEach(b => { b.disabled = true; });
  show("buyOpening");
  const r = await buy(opt.dataset.product);
  if (!el.isConnected) return;
  el.querySelectorAll(".store-opt").forEach(b => { b.disabled = false; });
  if (r.ok) show("buyChecking");
  else show(r.reason === "cancelled" ? "buyCancelled" : r.reason === "unavailable" ? "buyUnavailable" : "buyFailed", r.reason === "cancelled" ? "" : "var(--bad)");
}
onIap(e => {
  const el = document.querySelector(".store"), msg = el?.querySelector("#buy-msg");
  if (e.type === "products" && el && !el.querySelector(".store-opt[disabled]")) {   // swap in App Store prices
    el.querySelectorAll(".store-opt").forEach(b => { const p = priceOf(b.dataset.product), em = b.querySelector("em");
      if (p && em && !em.querySelector("s")) em.textContent = b.dataset.period ? `${p} / ${b.dataset.period}` : p; });
  }
  if (e.type === "credited") {
    play("perfect");
    toast(e.kind === "games" && e.games ? t("buyGames", { n: e.games }) : e.kind === "subscription" ? t("promoOk") : t("restored"));
    if (msg) { msg.hidden = false; msg.textContent = t(e.kind === "games" && e.games ? "buyDone" : "restored"); msg.style.color = "var(--good)"; }
  }
  if (e.type === "failed" && msg) { msg.hidden = false; msg.textContent = t("buyVerifyFailed"); msg.style.color = "var(--bad)"; }
});

/* ---------- quick chat ---------- */
// Players can only send fixed phrases (by index), no typing: nothing to moderate. Shown for SAY_MS as a speech
// bubble over the sender's seat (lobby) or island name tag (match), or as a toast on the game-over screen.
const PHRASES = ["say0", "say1", "say2", "say3", "say4", "say5", "say6", "say7"];
const SAY_MS = 3000;
function openSay(btn) {
  const old = document.querySelector(".say-pop"); if (old) return old.remove();
  const el = document.createElement("div"); el.className = "say-pop";
  el.innerHTML = PHRASES.map((k, i) => `<button type="button" data-say="${i}">${t(k)}</button>`).join("");
  const r = btn.getBoundingClientRect();
  el.style.top = `${r.bottom + 8}px`; el.style.left = `${Math.max(8, r.left)}px`;
  document.body.appendChild(el);
  const off = e => { if (!el.contains(e.target) && e.target.closest("#saybtn") !== btn) { el.remove(); document.removeEventListener("pointerdown", off, true); } };
  document.addEventListener("pointerdown", off, true);
}
function sendSay(i) {
  if (!S.net || Date.now() - (S.lastSay || 0) < 2000) return;   // one phrase every 2s
  S.lastSay = Date.now(); onSay({ from: selfId, i }, true);   // my own bubble shows at once, no round trip
  S.net.send({ t: "say", from: selfId, i });
}
const sayOf = id => { const x = S.says?.[id]; return x && x.until > Date.now() ? t(PHRASES[x.i]) : null; };
function onSay(m, local = false) {
  if (m.from === selfId && !local) return;   // my own echo (already shown)
  const who = S.state?.players.find(p => p.id === m.from);
  if (!who || !Number.isInteger(m.i) || m.i < 0 || m.i >= PHRASES.length) return;
  S.says = S.says || {};
  const prev = S.says[m.from]; if (!local && prev && Date.now() - prev.at < 1500) return;   // ignore spam
  S.says[m.from] = { i: m.i, at: Date.now(), until: Date.now() + SAY_MS };
  play("button");
  showSays();
  setTimeout(showSays, SAY_MS + 50);
  if (S.state.phase === "over") toast(`<b>${esc(who.name)}</b> ${esc(t(PHRASES[m.i]))}`);
}
function showSays() {
  S.builder?.redraw(); S.specRedraw?.();
  app.querySelectorAll(".seat[data-id]").forEach(el => {
    const text = sayOf(el.dataset.id), b = el.querySelector(".say");
    if (text && (!b || b.textContent !== text)) { b?.remove(); el.insertAdjacentHTML("afterbegin", `<em class="say">${esc(text)}</em>`); }
    else if (!text && b) b.remove();
  });
}

/* ---------- in-room rendering ---------- */
const me = () => S.state.players.find(p => p.id === selfId);
const target = () => builds.get(S.state.targetId);
const phaseMs = () => ({ show: S.state.times.show, build: S.state.times.build, collect: CONFIG.COLLECT_MS, judge: S.state.maxRounds ? CONFIG.POINTS_JUDGE_MS : CONFIG.JUDGE_MS });

function render() {
  const st = S.state, screen = st.phase === "collect" ? "build" : st.phase;
  const key = screen === "lobby" || screen === "over"
    ? `${screen}|${JSON.stringify(st.players)}|${JSON.stringify(st.settings)}|${S.host?.canStart()}|${st.autoBy}`
    : `${screen}|${st.round}`;
  if (st.phase === "collect" && me()?.alive && !S.submitted) submit();
  if (key === S.key) return update();
  S.key = key; S.builder = null; S.specRedraw = null;
  document.documentElement.classList.remove("locked");   // in-room screens can scroll (long lobbies, build UI)
  ["show", "build", "judge"].includes(screen) ? bgPause() : bgPlay();   // arena has its own sky
  ({ lobby, show, build, judge, over })[screen]();
  update();
}

const roomBack = `<button class="chip ghost" id="roomback" aria-label="${t("back")}">←</button>`;
const roomChip = () => roomBack + `<span class="chip ghost" dir="ltr">${S.room}</span>`
  + `<button class="chip ghost" id="saybtn" aria-label="${t("quickChat")}">${ICON.chat}</button>`;
const statusLine = () => {
  const st = S.state, alive = st.players.filter(p => p.alive).length;
  if (st.maxRounds) {   // Best of 5: round x/5, my total and my place
    const { total, place } = standing(selfId);
    return `<div class="meta"><span>${t("roundOf", { n: st.round, m: st.maxRounds })}</span>
      <span>${t("standing", { total, place, n: st.players.length })}</span></div>`;
  }
  return `<div class="meta"><span>${t("round", { n: st.round })}</span><span>${t("alive", { n: alive })}</span></div>`;
};

// Lobby. Online rooms add things to do while waiting: pick an island theme (floor, rock, crystal, name tag;
// used in the match too) and play "Spot the odd one" (host-run, first right tap scores).

function lobby() {
  const st = S.state, online = !!st.settings.room?.online, mine = store.get("br.style") || "";
  const n = st.players.length, max = online ? st.settings.room.max : null;
  const min = S.host ? S.host.minPlayers() : online ? CONFIG.ONLINE_ROOMS.find(r => r.max === max)?.min ?? 1 : 1;
  // Who just arrived / left since the last lobby draw (seat pop-in, toast, sound).
  const ids = st.players.map(p => p.id), seen = S.lobbySeen?.room === S.room ? S.lobbySeen.ids : null;
  const joined = seen ? st.players.filter(p => !seen.includes(p.id) && p.id !== selfId) : [];
  const left = seen ? (S.lobbyNames || []).filter(p => !ids.includes(p.id)) : [];
  S.lobbySeen = { room: S.room, ids }; S.lobbyNames = st.players.map(({ id, name }) => ({ id, name }));
  if (joined.length) { play("place"); toast(t("joinedRoom", { name: esc(joined[joined.length - 1].name) })); }
  else if (left.length) { play("remove"); toast(t("leftRoom", { name: esc(left[0].name) })); }
  // Status line + progress toward the minimum needed to start.
  const counting = st.autoStartMs != null;
  const [head, sub, prog, ready] = online
    ? counting ? [t("lobbyStarting"), t("lobbyStartingSub"), 1, true]
      : n < min ? [t("lobbyWaiting"), t("lobbyNeed", { n, m: min }), n / min, false]
      : [t("lobbyReady"), n < max ? t("lobbyAutoFull", { n, m: max }) : t("lobbyFull"), 1, true]
    : [t("lobbyWaitingFriends"), S.host ? t("lobbyStartAny") : t("lobbyHostStarts"), null, true];
  // Seats: online rooms show every seat (empty ones pulse); private rooms show who's in plus one open seat.
  const seats = online ? max : n + 1;
  const seat = i => { const p = st.players[i];
    if (!p) return `<li class="seat open"><i class="av"></i><span>&nbsp;</span></li>`;
    const col = (ISLAND_THEMES[p.style || "night"] || {}).tag || "#A5A9C9";
    return `<li class="seat ${p.id === selfId ? "me" : ""} ${joined.some(j => j.id === p.id) ? "new" : ""}" data-id="${esc(p.id)}">${sayOf(p.id) ? `<em class="say">${esc(sayOf(p.id))}</em>` : ""}
      <i class="av" style="--c:${col}">${esc([...p.name.trim()][0] || "?").toUpperCase()}${p.id === st.host ? `<b class="crown" aria-label="${t("host")}">${ICON.crown}</b>` : ""}${streakTag(p.streak)}</i>
      <span>${esc(p.name)}</span></li>`; };
  const tab = store.get("br.lobbyTab") === "quiz" ? "quiz" : "island";
  app.innerHTML = `${header(roomChip())}
  <div class="stage lobby">
    <div class="tag">${t("roomCodeLabel")}</div>
    <div class="code" dir="ltr">${S.room}</div>
    <button class="chip ghost invite" id="invite">${ICON.share}<span>${t("invite")}</span></button>
    <div class="room-info">${online ? `<span class="live">${t("menuOnline")}</span>` : settingsSummary(st.settings)}</div>
    <div class="lobby-status ${ready ? "ready" : ""}">
      <b>${head}<span class="dots"><i></i><i></i><i></i></span></b><small>${sub}</small>
      ${prog != null ? `<div class="lbar"><i style="width:${Math.min(1, prog) * 100}%"></i></div>` : ""}
    </div>
    <ul class="seats ${online ? (max > 10 ? "s12" : max > 8 ? "s10" : "s8") : ""}">${Array.from({ length: seats }, (_, i) => seat(i)).join("")}</ul>
    ${gamesLeft() < 1 ? `<p class="err">${t("outOfGames")}</p><button class="btn ghost wide" id="lobbybuy">${t("getGames")}</button>` : ""}
    ${S.host
      ? `<button class="btn wide" id="start" ${S.host.canStart() && gamesLeft() > 0 && !counting ? "" : "disabled"}>${t(counting ? "startingIn" : "start")}</button>`
      : `<p class="hint">${t("waitingHost")}</p>`}
    ${online ? `
    <div class="seg lobby-tabs" id="ltabs"><button type="button" data-tab="island" class="${tab === "island" ? "on" : ""}">${t("yourIsland")}</button>
      <button type="button" data-tab="quiz" class="${tab === "quiz" ? "on" : ""}">${t("quizTitle")}</button></div>
    <div class="island-pick" ${tab === "island" ? "" : "hidden"}>
      <canvas id="icv" width="400" height="260" aria-hidden="true"></canvas>
      <div class="styles" id="styles">${["", ...STYLES].map(k => { const th = ISLAND_THEMES[k || "night"];
        return `<button class="dot ${k === mine ? "on" : ""}" data-k="${k}" aria-label="${k || "night"}"
          style="background:${th.tile};box-shadow:inset 0 0 0 5px ${th.line},0 0 0 2px ${th.tag || "#A5A9C9"}"></button>`; }).join("")}</div></div>
    <div class="quiz" id="quiz" ${tab === "quiz" ? "" : "hidden"}>
      <p class="hint" id="qinfo"></p>
      <div class="qbar"><i id="qbar"></i></div>
      <div class="qboards" id="qchoices">${[0, 1, 2, 3].map(i => `<button class="qb" data-i="${i}"><canvas width="300" height="240"></canvas></button>`).join("")}</div>
      <ol class="qscores" id="qscores"></ol></div>` : ""}
    <button class="link" id="leave">${t("leave")}</button>
  </div>`;
  app.querySelector("#lobbybuy")?.addEventListener("click", () => openStore());
  app.querySelector("#invite").onclick = () => shareCode(S.room);
  if (online) {
    app.querySelector("#ltabs").onclick = e => {
      const b = e.target.closest("[data-tab]"); if (!b) return;
      store.set("br.lobbyTab", b.dataset.tab);
      app.querySelectorAll("#ltabs button").forEach(x => x.classList.toggle("on", x === b));
      app.querySelector(".island-pick").hidden = b.dataset.tab !== "island";
      app.querySelector("#quiz").hidden = b.dataset.tab !== "quiz";
    };
    app.querySelector("#styles").onclick = e => {
      const b = e.target.closest("[data-k]"); if (!b) return;
      store.set("br.style", b.dataset.k);
      S.net.send({ t: "hello", from: selfId, name: me()?.name || store.get("br.name"), style: b.dataset.k || null });
    };
    app.querySelector("#qchoices").onclick = e => {
      const b = e.target.closest("[data-i]"), q = S.state.quiz; if (!b || !q || q.reveal || b.disabled) return;
      S.net.send({ t: "guess", from: selfId, q: q.q, pick: +b.dataset.i }); S.quizPick = { q: q.q, i: +b.dataset.i }; quizUpdate();
    };
    S.quizQ = 0; quizUpdate(); islandPreview(); quizBar();
  }
  if (S.host) {
    app.querySelector("#start").onclick = () => S.host.start();
  }
  app.querySelector("#leave").onclick = () => home();
}

// Invite: the iPhone share sheet when available, otherwise copy the code (works on plain-http test links too).
async function shareCode(code) {
  const text = t("inviteText", { code });
  const Share = window.Capacitor?.isNativePlatform?.() && window.Capacitor.Plugins?.Share;   // iOS app: native share sheet
  if (Share) { try { await Share.share({ text }); } catch {} return; }
  try { if (navigator.share) { await navigator.share({ text }); return; } } catch (e) { if (e.name === "AbortError") return; }
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch {}
  if (!ok) { const ta = document.createElement("textarea"); ta.value = text; ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;opacity:0"; document.body.appendChild(ta); ta.select();
    try { ok = document.execCommand("copy"); } catch {} ta.remove(); }
  toast(t(ok ? "codeCopied" : "codeIs", { code }));
}

// Short message at the top of the screen (joins/leaves, copied…).
function toast(html) {
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div"); el.className = "toast"; el.innerHTML = html;
  document.body.appendChild(el); setTimeout(() => el.remove(), 2400);
}

// Quiz card: draw the 4 boards when a new question arrives, then mark my tap / the answer.
const QCAM = { yaw: Math.PI / 4, pitch: .95 };
function quizUpdate() {
  const q = S.state?.quiz, box = app.querySelector("#qchoices"); if (!box) return;
  const info = app.querySelector("#qinfo");
  if (!q) { info.textContent = t("quizWait"); return; }
  if (S.quizQ !== q.q) {
    S.quizQ = q.q; S.quizEnds = Date.now() + q.remainingMs; S.quizTotal = CONFIG.QUIZ_MS;
    // Same scale for all four, each centered in its tile, so no island looks bigger or cut off.
    const cvs = [...box.querySelectorAll("canvas")];
    fitDraw(cvs, cvs.map((_, i) => [parseLayers(q.boards[i]), { cam: { ...QCAM, yaw: q.yaws?.[i] ?? QCAM.yaw } }]));
  }
  if (q.reveal && !S.quizRevealed) { S.quizEnds = Date.now() + q.remainingMs; S.quizTotal = CONFIG.QUIZ_REVEAL_MS; }
  S.quizRevealed = q.reveal;
  const myPick = S.quizPick?.q === q.q ? S.quizPick.i : null, iMissed = q.wrong.includes(selfId);
  box.querySelectorAll("[data-i]").forEach(b => {
    const i = +b.dataset.i;
    b.disabled = q.reveal || myPick !== null || iMissed;
    b.classList.toggle("right", q.reveal && i === q.answer);
    b.classList.toggle("wrong", i === myPick && (iMissed || (q.reveal && i !== q.answer)));
  });
  const name = id => esc(S.state.players.find(p => p.id === id)?.name || "?");
  info.innerHTML = q.reveal ? (q.winner ? (q.winner === selfId ? t("quizYou") : t("quizGot", { name: `<b>${name(q.winner)}</b>` })) : t("quizNobody"))
    : iMissed ? t("quizMissed") : t("quizAsk");
  if (q.reveal && q.winner === selfId && S.quizCheered !== q.q) { S.quizCheered = q.q; play("perfect"); }
  const top = Object.entries(q.scores).filter(([id]) => S.state.players.some(p => p.id === id)).sort((a, b) => b[1] - a[1]).slice(0, 3);
  app.querySelector("#qscores").innerHTML = top.map(([id, n]) => `<li class="${id === selfId ? "me" : ""}"><span>${name(id)}</span><b>${n}</b></li>`).join("");
}

// Draws scenes cropped to their content: each is rendered off-screen, trimmed to its visible pixels, then
// scaled (one shared scale for the group) and centered in its canvas with a small margin.
const off = document.createElement("canvas"); off.width = 760; off.height = 720;
function fitDraw(canvases, scenes, pad = .08) {
  const shots = scenes.map(([vox, opts]) => {
    draw(off, vox, { ...opts, transparent: true });
    const { width: W, height: H } = off, d = off.getContext("2d").getImageData(0, 0, W, H).data;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) if (d[(y * W + x) * 4 + 3] > 8) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const img = document.createElement("canvas"); img.width = off.width; img.height = off.height;
    img.getContext("2d").drawImage(off, 0, 0);
    return { img, x0, y0, w: Math.max(1, x1 - x0 + 2), h: Math.max(1, y1 - y0 + 2) };
  });
  const k = Math.min(...shots.map((sh, i) => Math.min(canvases[i].width * (1 - 2 * pad) / sh.w, canvases[i].height * (1 - 2 * pad) / sh.h)));
  shots.forEach((sh, i) => {
    const cv = canvases[i], ctx = cv.getContext("2d"), w = sh.w * k, h = sh.h * k;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(sh.img, sh.x0, sh.y0, sh.w, sh.h, (cv.width - w) / 2, (cv.height - h) / 2, w, h);
  });
}

// Still preview of my island in its theme (redrawn when the lobby re-renders, e.g. after picking a theme).
function islandPreview() {
  const cv = app.querySelector("#icv"), p = me(); if (!cv) return;
  fitDraw([cv], [[empty(), { cam: { yaw: Math.PI / 5, pitch: .5 }, name: p?.name, style: p?.style }]], .06);
}

// Quiz timer bar (runs while the lobby is shown).
function quizBar() {
  const frame = () => {
    const bar = app.querySelector("#qbar"); if (!bar) return;
    if (S.quizEnds) { bar.style.width = `${Math.max(0, (S.quizEnds - Date.now()) / S.quizTotal) * 100}%`; bar.classList.toggle("rev", !!S.quizRevealed); }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// Game settings controls, used in the create-room sheet. Mode = two cards, difficulty = segmented control,
// times = ‹ value › steppers, others' blocks = switch. Online rooms always use Auto timings (fixed rows).
function settingsPanel(st, edit, online) {
  const opt = (name, v, cur, inner, cls = "") => `<button type="button" class="${cls} ${v === cur ? "on" : ""}" data-set="${name}" data-v="${v}" ${edit ? "" : "disabled"}>${inner}</button>`;
  const modes = [["elim", t("modeElim"), t("modeElimDesc")], ["points", t("modePoints"), t("modePointsDesc")]];
  const diffs = [["auto", t("auto")], ["easy", t("diffEasy")], ["intermediate", t("diffMed")], ["hard", t("diffHard")]];
  const timeText = ms => (ms === "auto" ? t("auto") : t("secondsN", { n: ms / 1000 }));
  const stepper = (name, cur) => online ? `<span class="fixed">${t("auto")}</span>` : `<div class="stepper">
      <button type="button" data-step="${name}" data-d="-1" ${edit ? "" : "disabled"} aria-label="-">‹</button>
      <b>${timeText(cur)}</b>
      <button type="button" data-step="${name}" data-d="1" ${edit ? "" : "disabled"} aria-label="+">›</button></div>`;
  return `<div class="settings${edit ? "" : " ro"}"><div class="tag">${t("settings")}</div>
    ${online ? "" : `<div class="modes">${modes.map(([v, name, desc]) => v === "points" && !isUnlimited()
      ? `<button type="button" class="mode-card locked" data-locked="points" ${edit ? "" : "disabled"}><b>${name} ${ICON.lock}</b><small>${t("bo5Locked")}</small></button>`
      : opt("mode", v, st.mode, `<b>${name}</b><small>${desc}</small>`, "mode-card")).join("")}</div>`}
    <div class="set-row col"><span>${t("difficulty")}</span><div class="seg">${diffs.map(([v, l]) => opt("difficulty", v, st.difficulty, l)).join("")}</div></div>
    <div class="set-row"><span>${t("showTime")}</span>${stepper("showMs", st.showMs)}</div>
    <div class="set-row"><span>${t("buildTime")}</span>${stepper("buildMs", st.buildMs)}</div>
    ${online ? "" : `<div class="set-row"><span>${t("othersBlocks")}</span>
      <button type="button" class="switch ${st.showOthers ? "on" : ""}" data-set="showOthers" data-v="${st.showOthers ? 0 : 1}" role="switch" aria-checked="${st.showOthers}" ${edit ? "" : "disabled"}><i></i></button></div>`}
  </div>`;
}

// Lobby: the room's settings (chosen when it was created) as small chips next to the room info.
function settingsSummary(st) {
  const time = (label, ms) => (ms === "auto" ? "" : `<span>${label} ${ms / 1000}s</span>`);
  const diff = { easy: t("diffEasy"), intermediate: t("diffMed"), hard: t("diffHard") }[st.difficulty];
  return `<span>${st.mode === "points" ? t("modePoints") : t("modeElim")}</span>${diff ? `<span>${diff}</span>` : ""}
    ${time(t("chipShow"), st.showMs)}${time(t("chipBuild"), st.buildMs)}${st.showOthers ? "" : `<span>${t("chipHidden")}</span>`}`;
}

// Next value for a ‹ › time stepper: Auto, then the fixed choices, wrapping around.
function stepTime(name, cur, d) {
  const list = ["auto", ...(name === "showMs" ? CONFIG.SHOW_CHOICES : CONFIG.BUILD_CHOICES).map(n => n * 1000)];
  const i = Math.max(0, list.indexOf(cur));
  return list[(i + d + list.length) % list.length];
}

function timerBlock(cls, label) {
  return `<div class="phase ${cls}" id="ph" data-label="${label}">${label}</div><div class="timer"><i id="bar"></i></div>`;
}

// Memorize and build share one arena screen, so the view doesn't jump between them. During memorize every
// island (and a center island) shows the target and building is locked; at build the target disappears.
function show() { arena("show"); }
function build() { arena("build"); }
function judge() { arena("judge"); }

// Memorize, build and judging all happen in one arena screen, so nobody leaves their island mid-round.
// Memorize: every island shows the target, building locked. Build: target gone. Judge: a shooting star
// from the center planet destroys the loser's island, then everyone gets a score popup.
function arena(phase) {
  const st = S.state;
  // Round numbers restart each game (and game numbers each room), so key by room + match too.
  const roundKey = `${S.room}:${st.matchId || st.game}:${st.round}`;
  if (S.buildRound !== roundKey) {
    Object.assign(S, { build: empty(), plots: {}, buildRound: roundKey, submitted: false, perfect: false, lastEdit: 0, buildStart: 0 });
    S.given = givenCells(target().vox);   // unique hidden blocks come pre-placed (nobody could know them)
    for (const i of S.given) S.build[i] = target().vox[i];
  }
  if (phase === "build" && !S.buildStart) S.buildStart = S.deadline - st.times.build;   // aligned with the host's clock
  const playing = phase === "judge" ? st.results.some(r => r.id === selfId) : me()?.alive;
  textSelect(false);
  const memorize = phase === "show", label = { show: "memorize", build: "build", judge: "judge" }[phase];
  app.innerHTML = `${header(roomChip())}
  <div class="stage arena-stage">${statusLine()}${timerBlock(phase, t(label))}
    ${playing ? "" : `<div class="specnav" dir="ltr"><button class="chip" id="sprev" aria-label="${t("prevPlayer")}">‹</button>
      <span id="swho"></span><button class="chip" id="snext" aria-label="${t("nextPlayer")}">›</button></div>`}
    <div class="arena"><div id="bld"></div><div class="pop" id="pop" hidden></div>
      ${memorize ? `<div class="shape-name">${esc(buildName(target()))}</div>` : ""}</div>
    ${playing ? `<p class="hint">${t(memorize ? "memorizeHint" : phase === "judge" ? (st.maxRounds ? "judgeHintPoints" : "judgeHint") : "buildHint")}</p>
      <div class="row"><button class="btn danger" id="clearall" ${phase === "build" ? "" : "disabled"}>${t("clearAll")}</button></div>
      ${phase === "build" ? `<p class="kbd-hint">${t("kbdHint")}</p>` : ""}
      <p class="hint" id="subnote" hidden>${t("submitted")}</p>`
      : `<p class="hint spec">${t("spectating")}</p>`}
  </div>`;
  if (playing) {
    S.builder = mountBuilder(app.querySelector("#bld"), S.build, paletteOf(target().vox), { t, cam, limits: colorCounts(target().vox), outsideClear: true, fixed: S.given,
      scene: () => islands(selfId),
      onChange: () => {
        S.lastEdit = Date.now(); sendProgress();
        if (score(target().vox, S.build) === 100) { S.perfect = true; play("perfect"); submit(); }   // perfect → auto-submit + lock
      } });
    app.querySelector("#clearall").onclick = () => S.builder.clear();   // no Submit: builds are sent when time is up (or at 100%)
    if (phase !== "build") S.builder.disable();
    else if (S.submitted) lockBuilder();
  } else spectate();
  if (phase === "judge") judgeShow();
}

// Players on the board this round: during judging that's everyone who was scored (the loser included).
function roster() {
  const st = S.state;
  return st.phase === "judge" ? st.players.filter(p => st.results.some(r => r.id === p.id)) : st.players.filter(p => p.alive);
}

// Island scene focused on one player, other islands around the circle, planet in the middle.
// Other players' blocks come from S.plots (live `progress` broadcasts); when judging, from the results.
function islands(focusId) {
  const st = S.state, list = roster();
  // Star cinematic: the view cuts to the (first) doomed island, so the camera has a clear shot.
  const cine = S.fx && S.fx.e != null && cinematicActive(S.fx.e) && list.some(p => p.id === S.fx.losers[0]);
  if (cine) focusId = S.fx.losers[0];
  const at = Math.max(0, list.findIndex(p => p.id === focusId));
  const focus = list[at] || me();
  const { offs, world } = islandLayout(list.length, at);
  const memorize = st.phase === "show", judging = st.phase === "judge", tgt = target().vox;
  const result = id => judging && st.results.find(r => r.id === id);
  // Hidden setting: alive players see empty islands for everyone else while building (spectators see all).
  const hideOthers = !st.settings.showOthers && me()?.alive && !judging;
  const blocks = id => memorize ? tgt
    : result(id) ? parseLayers(result(id).layers)
    : id === selfId ? S.build : hideOthers ? empty() : (S.plots[id] || empty());
  const fall = id => (S.fx && S.fx.losers.includes(id) ? S.fx.fall : 0);
  const neighbours = list.map((p, i) => i === at ? null : { vox: blocks(p.id), off: offs[i], name: p.name, style: p.style, streak: p.streak, fall: fall(p.id), say: sayOf(p.id),
    ...(cine ? { alpha: 1 } : {}) }).filter(Boolean);   // star cinematic: all islands look the same (no hint)
  // Shooting-star targets: each destroyed island's center, in this focused frame (one star per island).
  const fx = S.fx ? S.fx.losers.map(id => list.findIndex(p => p.id === id)).filter(i => i >= 0).map(i => {
    const hit = [offs[i][0] + N / 2, offs[i][1] + N / 2, 1];
    return { star: S.fx.star != null ? { to: hit, t: S.fx.star } : null, boom: S.fx.boom != null ? { at: hit, t: S.fx.boom } : null };
  }) : null;
  const zoom = LAYOUT_ZOOM[document.documentElement.dataset.layout] || 1;
  // Star cinematic: the camera takes over while the star flies to the (first) lowest island.
  const shot = cine ? starShot(S.fx.e, { world, seed: S.fx.seed }) : null;
  S.cineFx = shot ? shot.fx : null;
  return { vox: blocks(focus.id), name: focus.name, style: focus.style, streak: focus.streak, outline: focus.id === selfId, world, neighbours, fall: fall(focus.id), fx, say: sayOf(focus.id),
    zoom: shot ? shot.zoom : zoom, ...(shot ? { cam: shot.cam, target: shot.target, bigNames: true } : {}) };
}

// Judging animation timeline (ms into the judge phase): star flies, island blows up and sinks, popup.
const JUDGE_T = { star: STAR_T.star, hit: STAR_T.hit, sunk: STAR_T.sunk, popup: CONFIG.JUDGE_MS - CONFIG.SCOREBOARD_MS };
function judgeShow() {
  const st = S.state, round = st.round, losers = st.results.filter(r => r.elim), loser = losers[0] || null;
  const seed = Math.random();   // camera side for this round's star (Side view)
  const start = S.deadline - phaseMs().judge;
  const clamp = v => Math.max(0, Math.min(1, v));
  const tick = () => {
    if (S.state?.phase !== "judge" || S.state.round !== round) { S.fx = null; S.cineFx = null; applyCineFx(app.querySelector("#bld .view"), null); return; }
    const e = Date.now() - start;
    S.fx = loser ? {
      losers: losers.map(r => r.id), seed,
      e, star: e >= JUDGE_T.star && e < JUDGE_T.hit ? starProgress(e) : null,
      boom: e >= JUDGE_T.hit && e < JUDGE_T.hit + 1500 ? (e - JUDGE_T.hit) / 1500 : null,
      fall: clamp((e - JUDGE_T.hit) / (JUDGE_T.sunk - JUDGE_T.hit)),
    } : null;
    S.builder ? S.builder.redraw() : S.specRedraw && S.specRedraw();
    applyCineFx(app.querySelector("#bld .view"), S.cineFx);
    requestAnimationFrame(tick);
  };
  tick();
  if (loser) {   // star launch + impact sounds, timed to the animation
    const at = (ms, name) => setTimeout(() => { if (S.state?.phase === "judge" && S.state.round === round) play(name); }, Math.max(0, start + ms - Date.now()));
    at(JUDGE_T.star, "star"); at(STAR_T.dive, "star"); at(JUDGE_T.hit, "boom");
  }
  // Popup on its own timer: animation frames pause while the page is hidden, the popup shouldn't.
  setTimeout(() => { if (S.state?.phase === "judge" && S.state.round === round) showScorePopup(losers); },
    Math.max(0, start + (loser ? JUDGE_T.popup : 800) - Date.now()));
}

// Best of 5: a player's running total and 1-based place (ties share a place).
function standing(id) {
  const tot = S.state.totals, total = tot[id] || 0;
  return { total, place: 1 + S.state.players.filter(p => (tot[p.id] || 0) > total).length };
}

function showScorePopup(losers) {
  const pop = app.querySelector("#pop"); if (!pop || !pop.hidden) return;
  const st = S.state, mine = st.results.find(r => r.id === selfId);
  if (st.maxRounds) {   // Best of 5: scoreboard ranked by running total, with this round's score
    const ranked = [...st.players].sort((a, b) => (st.totals[b.id] || 0) - (st.totals[a.id] || 0));
    pop.innerHTML = `<div class="pop-title">${t("scoreboard")} · ${t("roundOf", { n: st.round, m: st.maxRounds })}</div>
      <ol class="board">${ranked.map((p, i) => { const r = st.results.find(x => x.id === p.id);
        return `<li class="${p.id === selfId ? "me" : ""}"><span class="rank">${i + 1}</span><span class="nm">${esc(p.name)}</span>
          <span class="rnd">+${r ? r.score : 0}%</span><b>${st.totals[p.id] || 0}%</b></li>`; }).join("")}</ol>
      <button class="btn skip" id="skip">${t("skip")}</button>`;
    pop.classList.add("wide"); pop.hidden = false; play("board");
    pop.querySelector("#skip").onclick = () => {
      if (!S.net) return;
      S.net.send({ t: "skip", from: selfId, round: st.round }); S.skipped = `${st.game}:${st.round}`; skipLabel();
    };
    skipLabel(); return;
  }
  // Elimination: scoreboard for everyone (results arrive ranked best → worst), me highlighted, loser in red.
  pop.innerHTML = `<div class="pop-title">${t("scoreboard")}</div>
    <ol class="board">${st.results.map((r, i) => `<li class="${r.id === selfId ? "me" : ""} ${r.elim ? "out" : ""}">
      <span class="rank">${i + 1}</span><span class="nm">${esc(r.name)}</span><b>${r.score}%</b></li>`).join("")}</ol>
    ${losers.length ? `<div class="pop-sub">${losers.some(l => l.id === selfId) ? t("destroyed")
      : losers.length === 1 ? t("wasDestroyed", { name: esc(losers[0].name) }) : t("manyDestroyed", { n: losers.length })}</div>` : ""}`;
  pop.classList.add("wide");
  pop.hidden = false; play("board");
}

// Skip button text: how many alive players pressed it (host advances when all have).
function skipLabel() {
  const b = app.querySelector("#skip"), st = S.state; if (!b || !st) return;
  const alive = st.players.filter(p => p.alive), n = alive.filter(p => (st.skips || []).includes(p.id)).length;
  const mine = S.skipped === `${st.game}:${st.round}` || (st.skips || []).includes(selfId);
  b.disabled = mine; b.textContent = `${t("skip")} · ${n}/${alive.length}`;
}

// Eliminated players watch the other islands, switching with ‹ ›.
function spectate() {
  const valid = () => { const a = roster(); if (!a.some(p => p.id === S.watch)) S.watch = a[0]?.id ?? null; return a; };
  const redraw = S.specRedraw = mountScene(app.querySelector("#bld"), t, cam, () => {
    valid(); const who = roster().find(p => p.id === S.watch), el = app.querySelector("#swho");
    if (el) el.textContent = who ? t("watching", { name: who.name }) : "";
    return islands(S.watch);
  });
  const step = d => { const a = valid(); if (!a.length) return;
    const i = a.findIndex(p => p.id === S.watch); S.watch = a[(i + d + a.length) % a.length].id; redraw(); };
  app.querySelector("#sprev").onclick = () => step(-1);
  app.querySelector("#snext").onclick = () => step(1);
}

// Broadcast my blocks so neighbours see them (throttled; `now` skips the wait).
let progressTimer = null;
function sendProgress(now) {
  const go = () => { progressTimer = null;
    if (S.net && S.build && S.state) S.net.send({ t: "progress", from: selfId, game: S.state.game, round: S.state.round, layers: toLayers(S.build) }); };
  if (now) { clearTimeout(progressTimer); return go(); }
  if (!progressTimer) progressTimer = setTimeout(go, 120);
}

function submit() {
  if (S.submitted || !S.net) return;
  S.submitted = true;
  // doneAt = when my build reached its final state (last edit), for the host's tie-break.
  const doneAt = S.lastEdit && S.buildStart ? S.lastEdit - S.buildStart : null;
  S.lastSubmit = { t: "submit", from: selfId, round: S.state.round, layers: toLayers(S.build), doneAt };
  S.net.send(S.lastSubmit);
  lockBuilder();
}
function lockBuilder() {
  S.builder && S.builder.disable();
  const b = app.querySelector("#clearall"), n = app.querySelector("#subnote");
  if (b) b.disabled = true;
  if (S.perfect) {   // perfect match: big popup, island stays locked in place until the round ends
    const pop = app.querySelector("#pop");
    if (pop) { pop.innerHTML = `<div class="pop-title perfect">${t("perfect")}</div><div class="pop-sub">${t("perfectSub")}</div>`; pop.hidden = false; }
  } else if (n) n.hidden = false;
}

function over() {
  const st = S.state, w = st.players.find(p => p.id === st.winner);
  const title = w ? (w.id === selfId ? t("youWin") : t("winner", { name: esc(w.name) })) : st.maxRounds ? t("draw") : t("noWinner");
  if (st.settings.room?.online) setTimeout(refreshProfile, 4000);
  setTimeout(maybeAskNotifications, 2500);   // my streak changes once the winner's win is recorded
  const totals = st.maxRounds ? `<ul class="players">${[...st.players].sort((a, b) => (st.totals[b.id] || 0) - (st.totals[a.id] || 0))
    .map(p => `<li>${esc(p.name)}<b class="total">${st.totals[p.id] || 0}%</b></li>`).join("")}</ul>` : "";
  app.innerHTML = `${header(roomChip())}
  <div class="stage">
    <div class="phase build big">${title}</div>
    ${w || st.maxRounds ? ICON.trophy : ""}
    ${totals}
    ${S.host ? `<button class="btn wide" id="again">${t("playAgain")}</button>` : `<p class="hint">${t("waitingHost")}</p>`}
    <button class="link" id="leave">${t("backHome")}</button>
  </div>`;
  if (S.host) app.querySelector("#again").onclick = () => S.host.reset();
  app.querySelector("#leave").onclick = () => home();
}

// Match feed, bottom-left over the arena: newest message at the bottom, the one before it moves up and fades;
// a third message pushes the oldest out. Each one also fades away by itself after 6s.
function feedPush(html) {
  let box = document.querySelector(".feed");
  if (!box) { box = document.createElement("div"); box.className = "feed"; document.body.appendChild(box); }
  const el = document.createElement("div"); el.className = "feed-msg"; el.innerHTML = html; box.appendChild(el);
  while (box.children.length > 2) box.firstElementChild.remove();
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 400); }, 6000);
}

// Lightweight per-state updates that must not rebuild the screen (e.g. keep the build grid intact).
function update() {
  const st = S.state;
  // Feed: a player who submits while building has hit 100% (there's no Submit button), so announce it once per round.
  if (st.phase === "build") {
    const key = `${S.room}:${st.matchId || st.game}:${st.round}`;
    if (S.feedKey !== key) { S.feedKey = key; S.feedSeen = new Set(st.players.filter(p => p.submitted).map(p => p.id)); }
    for (const p of st.players) if (p.alive && p.submitted && !S.feedSeen.has(p.id)) {
      S.feedSeen.add(p.id); feedPush(p.id === selfId ? t("feedYou") : t("feedGot", { name: esc(p.name) }));
    }
  }
  if (st.phase === "judge") skipLabel();
  if (st.phase === "lobby") quizUpdate();
}

/* ---------- clock ---------- */
// Full online room: big 5-4-3-2-1 countdown pop-up over the lobby before the match starts by itself.
function autoStartCountdown() {
  let el = document.querySelector(".countdown");
  const sec = S.autoStartAt && S.state?.phase === "lobby" ? Math.ceil((S.autoStartAt - Date.now()) / 1000) : 0;
  if (sec < 1) { el?.remove(); return; }
  if (!el) {
    el = document.createElement("div"); el.className = "countdown";
    el.innerHTML = `<div class="cd-card"><div class="tag">${t(S.state.autoBy === "full" ? "fullHouse" : "getReady")}</div><b></b><span>${t("startingIn")}</span></div>`;
    document.body.appendChild(el);
  }
  const b = el.querySelector("b");
  if (b.textContent !== String(sec)) {   // re-trigger the pop animation for each new number
    b.textContent = sec; b.classList.remove("bump"); void b.offsetWidth; b.classList.add("bump"); play("tick");
  }
}

setInterval(() => {
  autoStartCountdown();
  if (!S.state) return;
  if (S.migrating) return migrateTick();   // game clock frozen while a new host takes over
  const nowT = Date.now();
  if (nowT - (S.tickAt || nowT) > 2000) S.lastStateAt = nowT;   // this phone was frozen (background): fresh grace
  S.tickAt = nowT;
  const hostWait = S.state.phase === "lobby" || S.state.phase === "over" ? CONFIG.HOST_TIMEOUT_LOBBY_MS : CONFIG.HOST_TIMEOUT_MS;
  if (!S.host && nowT - S.lastStateAt > hostWait) return startMigration();
  const st = S.state, left = Math.max(0, S.deadline - Date.now()), total = phaseMs()[st.phase];
  const bar = app.querySelector("#bar"), ph = app.querySelector("#ph");
  // collect (the host's short wait for everyone's final build) is invisible to players: the build timer just stays at 0.
  const collect = st.phase === "collect";
  if (bar && total) bar.style.width = collect ? "0%" : `${(left / total) * 100}%`;
  if (ph && ph.dataset.label) ph.textContent = `${ph.dataset.label} · ${collect ? 0 : Math.ceil(left / 1000)}s`;
  // Countdown tick once per second for the last 7 seconds of building.
  const sec = Math.ceil(left / 1000), key = `${st.game}:${st.round}:${sec}`;
  if (st.phase === "build" && sec >= 1 && sec <= 7 && S.lastTick !== key) { S.lastTick = key; play("tick"); }
}, 100);

addEventListener("pagehide", () => { if (S.net && !isApp()) S.net.send({ t: "bye", from: selfId }); });   // website tab closed (the app may be coming back)
addEventListener("hashchange", () => { if (!S.net && booted) home(); });   // before boot, home() runs once it's done

// Friend requests inside the app (no push): a number badge on the trophy button, and a one-time pop-up message on the main
// menu for each new request ("Sara sent you a friend request"; tap → Friends tab).
async function checkFriendRequests() {
  if (!serverOn()) return;
  let r; try { r = await rpc("friend_requests"); } catch { return; }
  const n = r.incoming.length, chip = document.querySelector("#lbbtn");
  if (chip) { chip.querySelector(".badge-n")?.remove(); if (n) chip.insertAdjacentHTML("beforeend", `<i class="badge-n">${n}</i>`); }
  let seen; try { seen = JSON.parse(store.get("br.reqSeen") || "[]"); } catch { seen = []; }
  const fresh = r.incoming.filter(x => !seen.includes(x.id));
  store.set("br.reqSeen", JSON.stringify(r.incoming.map(x => x.id)));
  if (!fresh.length || location.hash !== "#menu" || document.querySelector(".store")) return;
  const el = document.createElement("button"); el.className = "req-pop";
  el.innerHTML = fresh.length === 1 ? t("reqFrom", { name: esc(fresh[0].name) }) : t("reqMany", { n: fresh.length });
  el.onclick = () => { el.remove(); store.set("br.lbWho", "friends"); location.hash = "#leaders"; };
  document.body.appendChild(el); play("place");
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 400); }, 5000);
}

// Notifications: the iPhone "Allow notifications?" pop-up comes once, after the first finished game or challenge.
// If they said no, the main menu shows a gentle note at most once a week (never blocks anything).
function maybeAskNotifications() {
  if (store.get("br.notifAsked")) return;
  store.set("br.notifAsked", "1"); askNotifications();
}
async function notifyNudge() {
  if ((await notifyStatus()) !== "denied" || Date.now() - (+store.get("br.notifNudge") || 0) < 7 * 86400000) return;
  store.set("br.notifNudge", String(Date.now())); toast(t("notifNudge"));
}

// Android back button: closes an open pop-up first; otherwise does what the screen's own ← does (leaving a match still
// asks first); on the title screen it closes the app. iPhone has no back button, so this only runs on Android.
window.Capacitor?.Plugins?.App?.addListener?.("backButton", () => {
  const leave = document.querySelector(".leave-pop");
  if (leave) return leave.querySelector("#stay")?.click();
  const pop = document.querySelector(".store:not(.update-pop), .say-pop, .req-pop");
  if (pop) return pop.remove();
  const btn = app.querySelector("#roomback, #chback, #back");
  if (btn) return btn.click();
  if (app.querySelector(".title-screen")) return window.Capacitor.Plugins.App.exitApp();
  location.hash = "#menu";
});

// Website (keyboard): while building, 1–9 pick a color (in the color bar's order), 0 / Delete / Backspace = eraser,
// Z (or Ctrl/Cmd+Z) = undo. Ignored while typing in a text box.
document.addEventListener("keydown", e => {
  if (e.target.closest?.("input, textarea") || e.altKey) return;
  const pal = app.querySelector("#bpal"); if (!pal) return;
  const k = e.key.toLowerCase();
  if (k === "z") { app.querySelector("#bundo")?.click(); e.preventDefault(); return; }
  if (e.metaKey || e.ctrlKey) return;
  const colors = [...pal.querySelectorAll(".sw[data-c]")].filter(b => b.dataset.c);
  if (/^[1-9]$/.test(k) && colors[+k - 1]) { colors[+k - 1].click(); return; }
  if (k === "0" || k === "delete" || k === "backspace") { pal.querySelector(".sw.erase")?.click(); e.preventDefault(); }
});

/* ---------- boot ---------- */
if (!store.get("br.onboard") && store.get("br.name")) store.set("br.onboard", "done");   // already playing before the first-launch tour existed
// No text selection (the blue highlight) anywhere except real text boxes, even on long-press + drag on iPhone.
document.addEventListener("selectstart", e => {
  const el = e.target.nodeType === 1 ? e.target : e.target.parentElement;
  if (!el?.closest("input, textarea")) e.preventDefault();
});
initBackground();
// Every launch starts on the title screen (dev tool links still open directly).
if (!DEV_ROUTES.includes(location.hash) && location.hash) history.replaceState(null, "", location.pathname + location.search);
// The title screen needs neither the shapes nor the server, so show it at once (no blank screen on a cold start).
if (!location.hash) { bgPlay(); document.documentElement.classList.add("locked"); titleScreen(); }
// Sign in to the server (invisible, anonymous) while the shapes load; without it the app falls back to the dev relay.
[builds] = await Promise.all([loadBuilds(), initServer()]);
loadStoreConfig().then(() => { onStoreLoaded(); checkVersion(); });   // store / free-games config + version gate
syncTime();   // games left today (server), or the trusted date for on-device counts
syncName();
refreshProfile();
setupNotifications(); pingFriends();   // reminders re-planned; friends hear I'm playing (server: max once / 48h each)
joinPresence();   // counts me in "players online"
initIap();        // iOS app: load App Store products; verifies any purchase left unfinished last time
winnersPopup();   // once a month: last month's top 3
onPlayersOnline(n => { const el = document.getElementById("onlineN"); if (el) el.textContent = shownOnline(n); });
addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  syncTime(); loadStoreConfig().then(checkVersion); winnersPopup(); refreshProfile(); setupNotifications(); pingFriends(); if (location.hash === "#menu") checkFriendRequests();   // app reopened
  if (S.net && !S.host && S.hello) { S.lastStateAt = Date.now(); S.net.send(S.hello()); }   // back in the room: host refreshes (or re-adds) me
});
booted = true;
if (location.hash || !app.querySelector(".title-screen")) home();   // the title screen is already up (keep what was typed)
