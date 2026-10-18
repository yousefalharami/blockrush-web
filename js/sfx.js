// Sound effects (real recordings from Mixkit, free license; originals in assets-src/sfx).
// Web Audio so short sounds play instantly and overlap; unlocked on the first tap (iOS requirement).
const NAMES = ["place", "remove", "tick", "round", "perfect", "star", "boom", "board", "win", "button"];
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

let ctx = null, muted = store.get("br.mute") === "1";
const buffers = {};

function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    for (const n of NAMES) fetch(`sfx/${n}.m4a`).then(r => r.arrayBuffer())
      .then(b => new Promise((ok, no) => ctx.decodeAudioData(b, ok, no)))
      .then(buf => { buffers[n] = buf; }).catch(() => {});
  }
  if (ctx.state === "suspended") ctx.resume();
}
if (typeof addEventListener === "function")   // (absent when voxel.js is imported by Node tests)
  for (const ev of ["pointerdown", "touchend", "keydown"]) addEventListener(ev, unlock, { capture: true, passive: true });

export function play(name, volume = 1) {
  if (muted || !ctx || !buffers[name]) return;
  const src = ctx.createBufferSource(), gain = ctx.createGain();
  src.buffer = buffers[name]; gain.gain.value = volume;
  src.connect(gain).connect(ctx.destination); src.start();
}

export const isMuted = () => muted;
export function toggleMute() { muted = !muted; store.set("br.mute", muted ? "1" : "0"); return muted; }
