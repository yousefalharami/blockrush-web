// Shooting-star cinematics: while the star flies to the lowest island, the view CUTS to a dramatic camera centered on
// the doomed island (so nothing is in the way), then cuts back. Modes (html[data-starcam] / br.starcam):
//   classic — no takeover (the original view)
//   iso 1 Isometric · pov 2 Star POV · planet 3 From the planet · side 4 Side view · top 5 Top-down (being compared in #lab)
// Times are ms into the judge phase (STAR_T below, also used by app.js).
// Coordinates: the doomed island is the focused one (its center at N/2, N/2); world.center = the planet.
import { N, starPoint } from "./voxel.js";

export const STAR_MODES = ["classic", "iso", "pov", "planet", "side", "top"];
export const starMode = () => document.documentElement.dataset.starcam || "classic";

// Shared judge timeline (ms into the judge phase). JUDGE_MS 10s = this 6s sequence + the 4s scoreboard.
export const STAR_T = { cutIn: 350, star: 500, dive: 500 + .6 * 4100, hit: 4600, sunk: 5300, cutOut: 5900 };
const T = STAR_T;
const cl = v => Math.max(0, Math.min(1, v));
const seg = (e, a, b) => cl((e - a) / (b - a));
const ease = k => k * k * (3 - 2 * k);
const lerp = (a, b, k) => a + (b - a) * k;
const deg = d => d * Math.PI / 180;
// Side view yaw: left or right of the planet→island line, 50–110° off it (so the target can be left/right, near/far).
const sideYaw = (along, seed) => along + (seed < .5 ? 1 : -1) * (50 + 60 * ((seed * 7.31) % 1)) * Math.PI / 180;
// Yaw that puts point `far` straight ahead of a camera standing behind point `near`.
const yawToward = (near, far) => Math.atan2(-(far[0] - near[0]), -(far[1] - near[1]));

export const cinematicActive = (e, mode = starMode()) => mode !== "classic" && e >= T.cutIn && e < T.cutOut;

// Star progress along its path (linear in time).
export function starProgress(e, mode = starMode()) {
  const k = seg(e, T.star, T.hit);
  return k;
}

// The cinematic camera { cam, zoom, target, fx } for this moment, or null (normal view).
// seed (0..1, new each round): Side view picks a random side/angle so the camera never gives the target away.
export function starShot(e, { world, seed = .5 }, mode = starMode()) {
  if (!cinematicActive(e, mode) || !world) return null;
  const k = seg(e, T.star, T.hit), after = seg(e, T.hit, T.cutOut), H = [N / 2, N / 2], P = world.center;
  let yaw, pitch, zoom, target, fx = {};
  // All modes share the star's rise → hang → dive path; only the camera differs. up: 0 low … 1 at the top of the climb.
  const t = starProgress(e, mode), st = starPoint(world, [H[0], H[1], 1], t), S2 = [st[0], st[1]];
  const up = Math.min(1, Math.max(0, (st[2] - 1) / 9)), dk = seg(e, T.dive, T.hit), dive = ease(dk);   // dive progress
  const mid = [lerp(P[0], H[0], .5), lerp(P[1], H[1], .5)], along = yawToward(P, H);   // along: looking from the planet to the island
  const toH = (a, b, k2) => [lerp(a[0], b[0], k2), lerp(a[1], b[1], k2)];
  if (e >= T.hit) {   // after the impact every mode settles on the destroyed island
    const base = { iso: deg(45), pov: along, planet: along, side: sideYaw(along, seed), top: along }[mode] ?? along;
    yaw = base + deg(8 * after); pitch = deg(mode === "top" ? 70 : mode === "iso" ? 50 : 26); zoom = lerp(1.05, .95, after); target = H;
  } else if (mode === "iso") {          // 1 · Isometric: high fixed game angle over the whole arena
    yaw = deg(45); pitch = deg(52);
    zoom = lerp(.28, 1.0, dive * dive); target = toH(toH(P, H, .35), H, dive);
  } else if (mode === "pov") {          // 2 · Star POV: riding with the star, looking where it goes
    const ahead = starPoint(world, [H[0], H[1], 1], Math.min(1, t + .06)), A2 = [ahead[0], ahead[1]];
    const moving = Math.hypot(A2[0] - S2[0], A2[1] - S2[1]) > .2;
    yaw = e < T.dive || !moving ? along : yawToward(S2, A2);
    pitch = deg(e < T.dive ? lerp(20, 34, up) : lerp(34, 62, dive));   // looks down onto the island as it dives
    zoom = e < T.dive ? lerp(.55, .4, up) : lerp(.4, 1.7, dive * dive);
    target = e < T.dive ? toH(S2, H, .35) : toH(S2, H, .5 + .5 * dive);
  } else if (mode === "planet") {       // 3 · From the planet: behind the planet, the star flies away toward the island
    yaw = along; pitch = deg(lerp(lerp(16, 24, up), 30, dive));
    zoom = lerp(lerp(.5, .4, up), 1.0, dive * dive); target = toH(toH(P, H, .3), H, dive);
  } else if (mode === "side") {         // 4 · Side view: from the side like a cannon shot; random side + angle each round
    yaw = sideYaw(along, seed); pitch = deg(lerp(lerp(12, 8, up), 22, dive));
    // climb + hang: centered on the planet (not the target); only the dive turns toward the doomed island
    zoom = lerp(lerp(.46, .36, up), .95, dive * dive); target = toH(toH(P, S2, .3), H, dive);
  } else {                              // 5 · Top-down: bird's eye, the island grows as the star dives
    yaw = along; pitch = deg(lerp(82, 74, dive));
    zoom = lerp(.3, 1.1, dive * dive); target = toH(mid, H, dive);
  }
  fx.speed = e > T.dive && e < T.hit ? dk : 0;   // speed lines during the dive
  fx.shake = e >= T.hit && e < T.hit + 550 ? 1 - (e - T.hit) / 550 : 0;
  fx.flash = Math.max(e >= T.hit && e < T.hit + 260 ? 1 - (e - T.hit) / 260 : 0,
    1 - seg(e, T.cutIn, T.cutIn + 160), seg(e, T.cutOut - 160, T.cutOut) * .8);   // impact + the cuts in/out
  return { cam: { yaw, pitch }, zoom, target, fx };
}

// Overlay effects (bars, red pulse, speed lines, flash) + screen shake on the view element.
export function applyCineFx(view, fx) {
  if (!view) return;
  let el = view.querySelector(".cine");
  if (!fx) { if (el) el.remove(); view.style.transform = ""; return; }
  if (!el) { el = document.createElement("div"); el.className = "cine"; el.innerHTML = "<i class=bar1></i><i class=bar2></i><b class=danger></b><b class=speed></b><b class=flash></b>"; view.appendChild(el); }
  el.style.setProperty("--bars", fx.bars || 0);
  el.style.setProperty("--danger", fx.danger ? (.45 + .45 * Math.sin(performance.now() / (200 - 140 * fx.danger))) * fx.danger : 0);
  el.style.setProperty("--speed", fx.speed || 0);
  el.style.setProperty("--flash", fx.flash || 0);
  const s = (fx.shake || 0) * 16;
  view.style.transform = s ? `translate(${(Math.random() - .5) * s}px, ${(Math.random() - .5) * s}px)` : "";
}
