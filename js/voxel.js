// Grid, build format, isometric renderer and scoring — ported from prototype/block-rush.html.
import { play } from "./sfx.js";

export const N = 5, LAYERS = 5, SIZE = N * N * LAYERS;
export const HEX = {
  W: "#EDE6D6", D: "#8A5A3C", G: "#6EC3F0", R: "#D9534F", T: "#8A5A3C", L: "#4CAF6A", C: "#6B3E26",
  K: "#55556A", B: "#E84B4B", Y: "#F2C14E", M: "#D9C29C", P: "#FF7FA8", O: "#F28C3A", V: "#8E5BD9", N: "#2B2D42",
  // Textured blocks (see TEXTURES below); the hex is their swatch/base color and identity for scoring.
  S: "#8C8FA3", H: "#B5533C", F: "#B07A45", Q: "#5DA84E", J: "#8FD3F5", X: "#9C6B3A", U: "#2E3A66", I: "#BDEBF7",
};

// Face textures for the textured block keys. paint(api, top) draws in the face's own unit square:
// u runs along the face, v runs up a side face (or across the top). api.shade(hex) applies the face's light.
export const TEXTURES = {
  S: { name: "Stone brick", paint(a) {   // grey stone brick: 3 staggered rows
    const m = a.shade("#5E6173");
    a.line(0, 1 / 3, 1, 1 / 3, m); a.line(0, 2 / 3, 1, 2 / 3, m);
    a.line(.5, 0, .5, 1 / 3, m); a.line(.25, 1 / 3, .25, 2 / 3, m); a.line(.75, 1 / 3, .75, 2 / 3, m); a.line(.5, 2 / 3, .5, 1, m);
  } },
  H: { name: "Brick", paint(a) {   // red brick with pale mortar: 4 rows
    const m = a.shade("#E3D3C0");
    for (const v of [.25, .5, .75]) a.line(0, v, 1, v, m, .05);
    [[0, .33, .67], [.25, .5], [.5, .33, .67], [.75, .5]].forEach(([v0, ...us]) => us.forEach(u => a.line(u, v0, u, v0 + .25, m, .05)));
  } },
  F: { name: "Wood planks", paint(a) {
    const m = a.shade("#7A5230");
    for (const v of [.25, .5, .75]) a.line(0, v, 1, v, m);
    [[0, .6], [.25, .3], [.5, .8], [.75, .45]].forEach(([v0, u]) => a.line(u, v0, u, v0 + .25, m));
  } },
  Q: { name: "Grass", side: "#8A5A3C", paint(a, top) {   // grass on top, dirt sides with a grassy fringe
    const g = a.shade("#5DA84E");
    if (top) { for (const [u, v] of [[.2, .3], [.6, .2], [.75, .7], [.35, .75], [.5, .45]]) a.fill([[u, v], [u + .09, v], [u + .09, v + .09], [u, v + .09]], a.shade("#7BC46A")); return; }
    const edge = [[0, 1], [1, 1], [1, .7]];
    for (let i = 4; i >= 0; i--) edge.push([i * .2 + .1, i % 2 ? .6 : .74], [i * .2, .7]);
    a.fill(edge, g);
  } },
  J: { name: "Window", base: "#E8ECF2", paint(a) {
    a.fill([[.13, .13], [.87, .13], [.87, .87], [.13, .87]], a.shade("#8FD3F5"));
    a.fill([[.2, .6], [.35, .8], [.4, .8], [.25, .6]], "rgba(255,255,255,.55)");
    const f = a.shade("#E8ECF2"); a.line(.5, .13, .5, .87, f, .07); a.line(.13, .5, .87, .5, f, .07);
  } },
  X: { name: "Crate", paint(a) {
    const m = a.shade("#6B4424");
    a.line(.08, .08, .92, .08, m, .09); a.line(.92, .08, .92, .92, m, .09); a.line(.92, .92, .08, .92, m, .09); a.line(.08, .92, .08, .08, m, .09);
    a.line(.14, .14, .86, .86, m, .1);
  } },
  U: { name: "Screen", base: "#1E2238", paint(a, top) {
    if (top) return;
    a.fill([[.12, .14], [.88, .14], [.88, .86], [.12, .86]], a.shade("#3FA9F5"));
    a.line(.18, .62, .7, .62, "rgba(255,255,255,.45)", .05); a.line(.18, .45, .55, .45, "rgba(255,255,255,.3)", .05);
  } },
  I: { name: "Ice", paint(a) {
    a.fill([[.15, 0], [.4, 0], [.1, 1], [-.15, 1]].map(([u, v]) => [Math.max(0, u), v]), "rgba(255,255,255,.55)");
    a.fill([[.55, 0], [.68, 0], [.38, 1], [.25, 1]], "rgba(255,255,255,.4)");
  } },
};

// Paints a textured block face into quad pts [p0, p1, p2, p3] (p0→p1 = u, p0→p3 = v), lit by factor f.
export function paintFace(ctx, pts, key, f, top) {
  const T = TEXTURES[key];
  const [p0, p1, , p3] = pts, M = (u, v) => [p0[0] + (p1[0] - p0[0]) * u + (p3[0] - p0[0]) * v, p0[1] + (p1[1] - p0[1]) * u + (p3[1] - p0[1]) * v];
  const size = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  const quad = uvs => { ctx.beginPath(); uvs.forEach(([u, v], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, ...M(u, v))); ctx.closePath(); };
  // Pattern lines stop short of the face edges (0/1 → inset), so only real cube edges run corner to corner.
  const inset = t => t <= 0 ? .07 : t >= 1 ? .93 : t;
  const api = {
    shade: hex => shade(hex, f),
    fill: (uvs, color) => { quad(uvs); ctx.fillStyle = color; ctx.fill(); },
    line: (u1, v1, u2, v2, color, w = .045) => {
      ctx.beginPath(); ctx.moveTo(...M(inset(u1), inset(v1))); ctx.lineTo(...M(inset(u2), inset(v2)));
      ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, size * w); ctx.lineCap = "round"; ctx.stroke();
    },
  };
  api.fill([[0, 0], [1, 0], [1, 1], [0, 1]], shade((top ? T.top : T.side) || T.base || HEX[key], f));
  T.paint(api, top);
  // Strong outline so every textured cube is easy to count.
  quad([[0, 0], [1, 0], [1, 1], [0, 1]]);
  ctx.strokeStyle = "rgba(8,8,20,.62)"; ctx.lineWidth = Math.max(1.4, size * .05); ctx.lineJoin = "round"; ctx.stroke();
}

// 2D isometric cube (palette icons, menu background), textured when the key has a texture.
export function drawIsoCube(ctx, x, y, s, key, alpha = 1) {
  const h = s / 2, q = s / 4, col = HEX[key] || "#A5A9C9", tex = TEXTURES[key];
  const faces = [   // [p0, p1, p2, p3] offsets, light, top?
    [[[-h, -q], [0, -h], [h, -q], [0, 0]], 1, true],
    [[[-h, q], [0, h], [0, 0], [-h, -q]], .72, false],
    [[[0, h], [h, q], [h, -q], [0, 0]], .52, false],
  ];
  ctx.save(); ctx.globalAlpha *= alpha; ctx.translate(x, y);
  for (const [pts, f, top] of faces) {
    if (tex) paintFace(ctx, pts, key, f, top);
    else { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, ...p)); ctx.closePath(); ctx.fillStyle = shade(col, f); ctx.fill(); }
  }
  ctx.restore();
}
export const CENTER = Math.floor(N / 2);
export const idx = (x, y, z) => z * N * N + y * N + x;
export const empty = () => Array(SIZE).fill(null);

// layers: bottom→top, each 5 rows (back→front) of 5 chars (left→right), "." = empty.
export function parseLayers(layers) {
  const v = empty();
  (layers || []).slice(0, LAYERS).forEach((rows, z) => rows.slice(0, N).forEach((row, y) =>
    [...row].slice(0, N).forEach((ch, x) => { if (ch !== "." && HEX[ch]) v[idx(x, y, z)] = ch; })));
  return v;
}

export function toLayers(v) {
  const layers = [];
  for (let z = 0; z < LAYERS; z++) {
    const rows = [];
    for (let y = 0; y < N; y++) {
      let row = "";
      for (let x = 0; x < N; x++) row += v[idx(x, y, z)] || ".";
      rows.push(row);
    }
    layers.push(rows);
  }
  while (layers.length && layers[layers.length - 1].every(r => r === ".".repeat(N))) layers.pop();
  return layers;
}

// Shape level from block count b and colors c (score = b + 6·(c−1)): very easy b ≤ 11, easy ≤ 24, medium ≤ 42, hard.
export function tierOf(v) {
  const cells = v.filter(Boolean), b = cells.length, sc = b + 6 * (new Set(cells).size - 1);
  return b <= 11 ? "very easy" : sc <= 24 ? "easy" : sc <= 42 ? "medium" : "hard";
}

// Distinct colors used by a build (one key per hex color), in first-seen order.
export const paletteOf = v => {
  const seen = new Map();
  for (const c of v) if (c && !seen.has(HEX[c])) seen.set(HEX[c], c);
  return [...seen.values()];
};
// Blocks per color (keyed like paletteOf), e.g. { W: 12, R: 8 }.
export const colorCounts = v => {
  const out = {}, pal = paletteOf(v);
  for (const c of v) if (c) { const k = pal.find(p => HEX[p] === HEX[c]); out[k] = (out[k] || 0) + 1; }
  return out;
};
const same = (a, b) => HEX[a] === HEX[b];   // keys sharing a color (e.g. D/T) are interchangeable

// correct / (target blocks + extra blocks), as an integer percent.
// A target block nobody can see: blocks on top and on all 4 sides (its bottom only shows from under the island).
export function hiddenCells(target) {
  const at = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < N && y < N && z < 5 && !!target[(z * N + y) * N + x];
  const hidden = new Set();
  target.forEach((c, i) => {
    if (!c) return;
    const x = i % N, y = Math.floor(i / N) % N, z = Math.floor(i / (N * N));
    if (at(x, y, z + 1) && at(x + 1, y, z) && at(x - 1, y, z) && at(x, y + 1, z) && at(x, y - 1, z)) hidden.add(i);
  });
  return hidden;
}
// "Unique" hidden blocks: hidden AND a different color from most blocks around them (e.g. a yellow core inside red)
// — nobody can know them, so the game places them for the player at the start of building. Hidden blocks with the
// surrounding color (the inside of a solid wall) are guessable and stay the player's job. 40 cells in 23 shapes.
export function givenCells(target) {
  const out = new Set();
  for (const i of hiddenCells(target)) {
    const x = i % N, y = Math.floor(i / N) % N, z = Math.floor(i / (N * N)), cnt = {};
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const X = x + dx, Y = y + dy, Z = z + dz;
      if (X < 0 || Y < 0 || Z < 0 || X >= N || Y >= N || Z >= 5) continue;
      const c = target[(Z * N + Y) * N + X]; if (c) cnt[c] = (cnt[c] || 0) + 1;
    }
    const top = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (top && !same(top, target[i])) out.add(i);
  }
  return out;
}
export function score(target, build) {
  const given = givenCells(target);   // pre-placed by the game: always right, so they don't count (doing nothing = 0%)
  let hit = 0, filled = 0, extra = 0;
  target.forEach((c, i) => { if (given.has(i)) return; if (c) { filled++; if (same(build[i], c)) hit++; } else if (build[i]) extra++; });
  return filled + extra ? Math.round(100 * hit / (filled + extra)) : 0;
}

// Winning-streak flame centered at (x, y), height ~2r: orange outer, yellow core (same look as ICON.flame in app.js).
function flame(ctx, x, y, r) {
  ctx.save();
  const path = k => { ctx.beginPath(); ctx.moveTo(x, y - r * k);
    ctx.bezierCurveTo(x + r * .9 * k, y - r * .2 * k, x + r * .75 * k, y + r * k, x, y + r * k);
    ctx.bezierCurveTo(x - r * .75 * k, y + r * k, x - r * .9 * k, y - r * .2 * k, x, y - r * k); ctx.fill(); };
  ctx.fillStyle = "#FF6A2B"; path(1);
  ctx.fillStyle = "#FFD23F"; ctx.translate(0, r * .35); path(.5);
  ctx.restore();
}

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16), r = n >> 16, g = n >> 8 & 255, b = n & 255;
  return `rgb(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)})`;
}

// Free-orbit camera: yaw spins around the fixed floor, pitch tilts between near-side and top-down.
export const newCam = () => ({ yaw: Math.PI / 4, pitch: Math.PI / 6 });
// Repairs a camera whose angles went non-finite (NaN would blank every canvas that uses it).
const sane = cam => {
  if (!Number.isFinite(cam.yaw)) cam.yaw = Math.PI / 4;
  if (!Number.isFinite(cam.pitch)) cam.pitch = Math.PI / 6;
  return cam;
};
// Negative pitch = looking from under the island (to reach block bottoms and build downward).
const PITCH_MIN = -75 * Math.PI / 180, PITCH_MAX = 88 * Math.PI / 180;
const FACES = [   // side faces: normal (nx, ny) + corners as [dx, dy] offsets from the cube's (x, y)
  { n: [1, 0], c: [[1, 0], [1, 1]] }, { n: [-1, 0], c: [[0, 1], [0, 0]] },
  { n: [0, 1], c: [[1, 1], [0, 1]] }, { n: [0, -1], c: [[0, 0], [1, 0]] },
];

// Island floor: lighter slate so it stands out against space.
const FLOOR = { tile: "#3A4174", line: "#565FA0", front: "#F2C14E" };   // start tile = a darker shade of the island's floor

// Island themes players can pick in online rooms: floor, rock and crystal colors + the name-tag color.
// Floors and rock are deliberately dark, low-saturation tones so they never look like a build block;
// the start tile is a darker shade of each theme's floor; the gold front edge is the same on every theme.
export const ISLAND_THEMES = {
  night:  { tile: "#3A4174", line: "#565FA0", rock: "#3B3656", crystal: "#7FE3FF", tag: null },
  moss:   { tile: "#2C4E42", line: "#467361", rock: "#34443A", crystal: "#9CFFB0", tag: "#5BD6A0" },
  ocean:  { tile: "#244A64", line: "#3C6C8C", rock: "#2C3C52", crystal: "#8FDBFF", tag: "#5BC0FF" },
  rose:   { tile: "#55304A", line: "#7C4A70", rock: "#462C42", crystal: "#FFA8D6", tag: "#FF7FA8" },
  violet: { tile: "#402E66", line: "#614B96", rock: "#372C54", crystal: "#CDB0FF", tag: "#B08CFF" },
  ember:  { tile: "#553628", line: "#7E533E", rock: "#453027", crystal: "#FFBE8A", tag: "#FF8A5B" },
  frost:  { tile: "#46505E", line: "#687686", rock: "#3C424D", crystal: "#EAF6FF", tag: "#F3EFE4" },
};
const themeOf = id => ISLAND_THEMES[id] || ISLAND_THEMES.night;
const darken = (hex, f) => "#" + [16, 8, 0].map(b => Math.round((parseInt(hex.slice(1), 16) >> b & 255) * f).toString(16).padStart(2, "0")).join("");

// Space backdrop: deep gradient, soft nebulae and a fixed star field that drifts with the camera (parallax).
const rand = (seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647)(42);
const STARS = Array.from({ length: 180 }, () => ({ x: rand(), y: rand(), r: rand() ** 3 * 2.2 + .4, a: .35 + rand() * .65 }));
function space(ctx, W, H, yaw, pitch) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#03040C"); g.addColorStop(.6, "#080A1C"); g.addColorStop(1, "#0E1030");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const px = yaw / (2 * Math.PI), py = (pitch - Math.PI / 6) * .25;
  for (const [x0, y0, rad, col] of [[.2, .3, .55, "rgba(120,60,170,.22)"], [.8, .65, .5, "rgba(40,120,170,.18)"], [.55, .1, .35, "rgba(200,90,120,.10)"]]) {
    const cx = ((x0 + px) % 1 + 1) % 1 * W, cy = (y0 + py) * H, n = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad * W);
    n.addColorStop(0, col); n.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = n; ctx.fillRect(0, 0, W, H);
  }
  for (const st of STARS) {
    const x = ((st.x + px * 2) % 1 + 1) % 1 * W, y = (((st.y + py) % 1) + 1) % 1 * H;
    ctx.globalAlpha = st.a; ctx.fillStyle = st.r > 1.8 ? "#FFE9C4" : "#DDE3FF";
    ctx.beginPath(); ctx.arc(x, y, st.r, 0, 2 * Math.PI); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// Background shooting stars on their own animated canvas behind the scene, so they can move without
// redrawing the islands. Turn off with ?sky=plain.
export const SKY_METEORS = typeof location === "undefined" || new URLSearchParams(location.search).get("sky") !== "plain";
const METEOR_EVERY_MS = 10_000;

// Animated sky loop for one background canvas; stops by itself once the canvas leaves the page.
export function startSky(canvas, cam) {
  const ctx = canvas.getContext("2d"), W = canvas.width, H = canvas.height, meteors = [];
  let next = performance.now() + 2500;
  const frame = now => {
    if (!canvas.isConnected) return;
    sane(cam); space(ctx, W, H, cam.yaw, cam.pitch);
    if (SKY_METEORS) {
      if (now > next) {   // a shooting star every 10s, crossing the upper sky
        meteors.push({ t0: now, x: Math.random() * .8 + .1, y: Math.random() * .3, dx: (Math.random() < .5 ? -1 : 1) * (.35 + Math.random() * .25), dy: .18 + Math.random() * .1, dur: 900 + Math.random() * 500 });
        next = now + METEOR_EVERY_MS;
      }
      for (let i = meteors.length - 1; i >= 0; i--) {
        const m = meteors[i], k = (now - m.t0) / m.dur;
        if (k >= 1) { meteors.splice(i, 1); continue; }
        const hx = (m.x + m.dx * k) * W, hy = (m.y + m.dy * k) * H, tx = hx - m.dx * .12 * W, ty = hy - m.dy * .12 * H;
        const g = ctx.createLinearGradient(tx, ty, hx, hy);
        g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(1, `rgba(255,248,230,${Math.sin(Math.PI * k)})`);
        ctx.strokeStyle = g; ctx.lineWidth = 2.2; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

const CAM_DIST = 30;   // camera distance (tiles) from the focused island; smaller = stronger perspective
// Planet: center height (same level as the islands) and radius, in tiles. STAR_ARC: how high the shooting star climbs.
const PLANET = { z: 1, r: 1.8 }, STAR_ARC = 7;
// Arena center planet designs (design lab html[data-core]). ball = gradient light → dark; rings [scale, color, width].
// Lava world cracks: a few jagged lines spread round the sphere (fixed, so they turn with the planet).
const LAVA_CRACKS = Array.from({ length: 22 }, (_, k) => {
  const rnd = n => (Math.sin(k * 91.7 + n * 12.9) * 43758.5) % 1, pts = [[k * .29, -.9 + 1.8 * Math.abs(rnd(1))]];
  for (let j = 0; j < 4; j++) { const [lo, la] = pts[pts.length - 1]; pts.push([lo + .12 + .1 * rnd(j + 2), la + .3 * rnd(j + 7)]); }
  return pts;
});
const PLANETS = {
  giant: { spin: .25, ball: ["#FFE2B0", "#E59A52", "#7A3A1A"], glow: "rgba(255,160,80,.5)",
    bands: [[.55, .1, "rgba(150,70,30,.55)"], [.25, .07, "rgba(255,235,200,.5)"], [0, .11, "rgba(170,85,40,.5)"], [-.3, .08, "rgba(255,225,180,.45)"], [-.6, .09, "rgba(130,60,25,.5)"]],
    spots: [[0, -.15, .26, "rgba(200,60,40,.85)"]] },
  ice: { spin: .2, ball: ["#FFFFFF", "#9FE3FF", "#3A6FA8"], glow: "rgba(150,220,255,.6)", cap: "rgba(255,255,255,.9)",
    rings: [[1.75, "rgba(220,235,255,.7)", .07], [2.05, "rgba(200,220,255,.45)", .05]],
    spots: [[1, .2, .12, "rgba(255,255,255,.5)"], [2.6, -.3, .16, "rgba(255,255,255,.4)"], [4.2, .1, .1, "rgba(200,240,255,.6)"]] },
  lava: { spin: .3, ball: ["#5A3A33", "#2B1A1A", "#0E0707"], glow: "rgba(255,90,30,.75)", cracks: "#FF7A2B", atmo: "rgba(255,110,40,.55)",
    spots: [[.5, .3, .14, "rgba(255,140,40,.7)"], [3, -.2, .18, "rgba(255,100,30,.6)"]] },
  earth: { spin: .3, ball: ["#BFF0FF", "#3E8EE8", "#173B8C"], glow: "rgba(110,190,255,.6)", atmo: "rgba(170,225,255,.6)", landColors: ["#4FC66A", "#2E9E4F"],
    land: [[-.3, .55, [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [3, 1], [1, 2], [2, 2], [1, 3]]],
           [1.9, .3, [[0, 0], [1, 0], [0, 1], [1, 1], [2, 1], [1, 2], [2, 2], [1, 3], [1, 4], [2, 4]]],
           [3.9, .6, [[0, 0], [1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [2, 2], [3, 2]]],
           [5.2, -.25, [[0, 0], [1, 0], [0, 1], [1, 1], [1, 2]]]], cap: "rgba(255,255,255,.85)" },
  neon: { spin: .35, ball: ["#FFD6F5", "#C04BE0", "#3A1170"], glow: "rgba(230,90,255,.7)",
    bands: [[.3, .06, "rgba(255,120,220,.45)"], [-.2, .05, "rgba(120,220,255,.4)"]],
    rings: [[1.6, "rgba(255,90,200,.8)", .06], [1.85, "rgba(255,210,80,.75)", .05], [2.1, "rgba(80,220,255,.7)", .05]] },
};
// Shooting-star position at progress t (0..1) from the planet to `to`: rises in an arc and dives (shared with the star cameras).
// Path (user, 2026-10-05: the lap made people dizzy): the star climbs out of the planet in a slow, gentle spiral
// (0–45%), hangs at the top drifting toward its target (45–60%), then swoops down onto the island in a smooth curve,
// speeding up until impact (60–100%).
const RISE_END = .45, HANG_END = .6, APEX_Z = 10;
export function starPoint(world, to, t) {
  const [cx, cy] = world.center, dx = to[0] - cx, dy = to[1] - cy, sm = k => k * k * (3 - 2 * k);
  const apex = [cx + dx * .25, cy + dy * .25, APEX_Z];   // top of the climb, a little toward the target
  if (t <= RISE_END) {
    const k = sm(t / RISE_END), a = 1.5 * Math.PI * k, r = 1.6 * Math.sin(Math.PI * k);   // ¾ turn, widest mid-climb
    return [cx + (apex[0] - cx) * k + Math.cos(a) * r, cy + (apex[1] - cy) * k + Math.sin(a) * r, PLANET.z + (APEX_Z - PLANET.z) * k];
  }
  if (t <= HANG_END) {   // hover: a slow drift + a tiny float
    const k = (t - RISE_END) / (HANG_END - RISE_END);
    return [apex[0] + dx * .05 * k, apex[1] + dy * .05 * k, APEX_Z + .6 * Math.sin(Math.PI * k)];
  }
  const k = (t - HANG_END) / (1 - HANG_END), e = k * k;   // dive: accelerating
  const from = [apex[0] + dx * .05, apex[1] + dy * .05, APEX_Z];
  const bow = 3 * Math.sin(Math.PI * k) * (1 - k);   // a soft sideways curve, settling onto the target
  const px = -dy / (Math.hypot(dx, dy) || 1), py = dx / (Math.hypot(dx, dy) || 1);
  return [from[0] + (to[0] - from[0]) * e + px * bow, from[1] + (to[1] - from[1]) * e + py * bow, from[2] + (to[2] - from[2]) * (1 - Math.cos(Math.PI * k / 2))];
}

// Circle diameter (tiles) by player count; counts in between are interpolated.
// 10–16 players: the old 8→16 line (+2.75 per player) plus extra room: +4 at 10, then +2 more per player.
const DIAMETERS = [[2, 30], [4, 30], [6, 46], [8, 54], [9, 56.75], [10, 63.5], [11, 68.25], [12, 73], [13, 77.75],
                   [14, 82.5], [15, 87.25], [16, 92]];
export function arenaDiameter(n) {
  if (n <= DIAMETERS[0][0]) return DIAMETERS[0][1];
  for (let i = 1; i < DIAMETERS.length; i++) {
    const [n0, d0] = DIAMETERS[i - 1], [n1, d1] = DIAMETERS[i];
    if (n <= n1) return d0 + (d1 - d0) * (n - n0) / (n1 - n0);
  }
  return DIAMETERS[DIAMETERS.length - 1][1];
}

// Floating-rock underside hanging below every island: stepped stone that tapers to a glowing crystal.
// Rows back→front like build layers, top layer first (z = -1, -2, …).
const UNDERSIDE = (() => {
  const L = [
    ["#####", "#####", "#####", "#####", "#####"],
    [".###.", "#####", "#####", "#####", ".###."],
    [".....", ".###.", ".###.", ".###.", "....."],
    [".....", "..#..", ".###.", "..#..", "....."],
    [".....", ".....", "..*..", ".....", "....."],
  ];
  const out = [];   // colors come from the island theme at draw time: rock darkens with depth (level i)
  L.forEach((rows, i) => rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch !== ".") out.push({ x, y, z: -1 - i, level: i, glow: ch === "*" });
  })));
  return out;
})();
const UNDER_AT = new Set(UNDERSIDE.map(b => `${b.x},${b.y},${b.z}`));
// Islands sit evenly on a circle. The focused island (index `at`) is placed so the circle's center lies
// "behind" it for the default camera, keeping the other islands in view in the background.
// Returns island offsets relative to the focused island, plus the circle center/radius in the same frame.
export function islandLayout(n, at, diameter = arenaDiameter(Math.max(n, 2))) {
  const R = diameter / 2;   // solo: same as 2 players, leaves room for the center island
  const ang = i => Math.PI / 4 + 2 * Math.PI * (i - at) / n;
  const pos = i => [R * Math.cos(ang(i)), R * Math.sin(ang(i))];
  const [fx, fy] = pos(at);
  return { offs: Array.from({ length: n }, (_, i) => { const [x, y] = pos(i); return [x - fx, y - fy]; }),
           world: { center: [N / 2 - fx, N / 2 - fy], r: R } };
}

// Renders the focused island (camera centered on it) plus optional neighbour islands.
// opts: { cam: {yaw, pitch}, hits: [] to collect tappable polygons (focused island only),
//         ghost: [x, y, z, colorKey] preview, name, outline (amber rim = "my island"),
//         neighbours: [{ vox, off: [dx, dy], name }] drawn at 70% opacity,
//         world: { center: [x, y], r } shared ground the islands sit around }
// Each hit is { pts, place: [x,y,z] (cell a new block would go), cell: [x,y,z] | null (block under it) },
// pushed in paint order, so the last hit containing a point is the one on top.
export function draw(canvas, vox, opts = {}) {
  const { yaw, pitch } = sane(opts.cam || newCam());
  const ctx = canvas.getContext("2d"), W = canvas.width, Hc = canvas.height, hits = opts.hits;
  ctx.clearRect(0, 0, W, Hc);
  if (!opts.transparent) space(ctx, W, Hc, yaw, pitch);   // mounted views draw the sky on a layer behind
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const diag = N * Math.SQRT2;
  const plots = [{ vox, off: [0, 0], alpha: 1, main: true, name: opts.name, outline: opts.outline, fall: opts.fall, style: opts.style, say: opts.say, streak: opts.streak },
    ...(opts.neighbours || []).map(n => ({ alpha: .7, ...n }))];
  // Fixed scale that fits the focused grid at any angle, so dragging never zooms.
  const multi = plots.length > 1;
  // opts.zoom / opts.target (camera look-at point) are used by the how-to-play video; the game leaves them default.
  const s = Math.min(W / (diag + .4), Hc / (Math.hypot(diag, LAYERS) + .4)) * (opts.zoom || 1);
  const [tx0, ty0] = opts.target || [N / 2, N / 2];
  const camDist = CAM_DIST / (opts.zoom || 1);   // zooming out = pulling the camera back (keeps perspective sane)
  const ox = W / 2, oy = Hc / 2 + (LAYERS * s * cp) / 2;   // centers floor + max height vertically
  // Perspective camera orbiting the focused island: it keeps the same size as before (f = 1 at its center),
  // while far islands shrink with distance, like in a real scene.
  const proj = (x, y, z) => {
    const dx = x - tx0, dy = y - ty0;
    const u = dx * cy - dy * sy, v = dx * sy + dy * cy;
    const f = camDist / Math.max(camDist - (v * cp + z * sp), 1);
    return [ox + u * s * f, oy + (v * sp - z * cp) * s * f];
  };
  const depth = (x, y, z) => { const dx = x - tx0, dy = y - ty0; return (dx * sy + dy * cy) * cp + z * sp; };
  const poly = (pts, fill, stroke, lw = 1.5) => {
    ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(...p) : ctx.moveTo(...p)); ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
    return pts;
  };
  const facing = pts => {   // screen-space winding: > 0 means the face points at the camera
    let a = 0; for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; a += x1 * y2 - x2 * y1; }
    return a > 0;
  };
  const sideShade = (nx, ny) => .62 - .1 * (nx * cy - ny * sy);   // left-facing lighter, right darker

  // Faint orbit ring through the island centers.
  if (multi && opts.world) {
    const { center: [wx, wy], r } = opts.world, ring = (rad, z) =>
      Array.from({ length: 64 }, (_, i) => { const a = i / 64 * 2 * Math.PI; return proj(wx + rad * Math.cos(a), wy + rad * Math.sin(a), z); });
    poly(ring(r, -1.5), null, "rgba(255,178,63,.16)", 2);
  }

  const has = (v, x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < N && y < N && z < LAYERS && !!v[idx(x, y, z)];

  // One island: rock underside, floor, then its blocks (far → near). `fall` (0..1) sinks and fades it
  // when it's destroyed. Islands never overlap, so drawing them whole in depth order is correct.
  function drawIsland(p) {
    const [px, py] = p.off, fall = p.fall || 0, dz = -fall * fall * 9;
    const P = (x, y, z) => proj(x, y, z + dz);
    const corners = [[px, py], [px + N, py], [px + N, py + N], [px, py + N]];
    const tappable = p.main && hits && !fall;
    const below = sp < 0;   // camera under the floor: hide the rock, draw the floor see-through on top
    ctx.globalAlpha = p.alpha * (1 - fall);
    const th = themeOf(p.style), rockCol = [1, .85, .71, .57].map(f => darken(th.rock, f));
    const under = below ? [] : UNDERSIDE.map(b => ({ ...b, d: depth(px + b.x + .5, py + b.y + .5, b.z + .5) })).sort((a, b) => a.d - b.d);
    for (const { x, y, z, level, glow } of under) {
      const col = glow ? th.crystal : rockCol[level];
      if (glow) { ctx.shadowColor = col; ctx.shadowBlur = s * .6; }
      for (const { n: [nx, ny], c } of FACES) {
        if (UNDER_AT.has(`${x + nx},${y + ny},${z}`)) continue;   // hidden by a neighbouring rock
        const [a, b] = c.map(([ax, ay]) => [px + x + ax, py + y + ay]);
        const pts = [P(a[0], a[1], z), P(b[0], b[1], z), P(b[0], b[1], z + 1), P(a[0], a[1], z + 1)];
        if (facing(pts)) poly(pts, glow ? col : shade(col, sideShade(nx, ny) + .3), glow ? null : "rgba(0,0,0,.3)");
      }
      ctx.shadowBlur = 0;
    }
    const floor = () => {
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const mid = x === CENTER && y === CENTER;   // highlighted start tile
        const X = px + x, Y = py + y;
        const pts = poly([P(X, Y, 0), P(X + 1, Y, 0), P(X + 1, Y + 1, 0), P(X, Y + 1, 0)], mid ? darken(th.tile, .62) : th.tile, th.line);
        if (tappable && !below) hits.push({ pts, place: [x, y, 0], cell: null });
      }
      if (p.outline) poly(corners.map(([x, y]) => P(x, y, 0)), null, "rgba(255,178,63,.4)", 2);
      // Gold front edge (row 5 side) on every island, so "front" is the same direction for everyone.
      ctx.beginPath(); ctx.moveTo(...P(px, py + N, 0)); ctx.lineTo(...P(px + N, py + N, 0));
      ctx.strokeStyle = FLOOR.front; ctx.lineWidth = Math.max(3, s * .07); ctx.lineCap = "round"; ctx.stroke();
    };
    if (!below) floor();

    const list = [];
    for (let z = 0; z < LAYERS; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const k = p.vox[idx(x, y, z)];
      if (k) list.push({ x, y, z, key: k, d: depth(px + x + .5, py + y + .5, z + .5) });
    }
    const g = p.main && opts.ghost;
    if (g && !has(p.vox, g[0], g[1], g[2])) list.push({ x: g[0], y: g[1], z: g[2], key: g[3], ghost: true, d: depth(g[0] + .5, g[1] + .5, g[2] + .5) });
    list.sort((a, b) => a.d - b.d);
    for (const { x, y, z, key, ghost } of list) {
      const col = HEX[key] || "#A5A9C9", X = px + x, Y = py + y;
      ctx.globalAlpha = p.alpha * (1 - fall);
      const face = (pts, f, n, top) => {
        const stroke = ghost ? "rgba(255,255,255,.7)" : "rgba(0,0,0,.18)";
        if (TEXTURES[key]) { paintFace(ctx, pts, key, f, top); poly(pts, null, stroke); }
        else poly(pts, shade(col, f), stroke);
        if (tappable && !ghost) hits.push({ pts, place: [x + n[0], y + n[1], z + n[2]], cell: [x, y, z] });
      };
      for (const { n: [nx, ny], c } of FACES) {
        if (!ghost && has(p.vox, x + nx, y + ny, z)) continue;   // hidden by a neighbour block
        const [a, b] = c.map(([ax, ay]) => [X + ax, Y + ay]);
        const pts = [P(a[0], a[1], z), P(b[0], b[1], z), P(b[0], b[1], z + 1), P(a[0], a[1], z + 1)];
        if (facing(pts)) face(pts, sideShade(nx, ny), [nx, ny, 0], false);
      }
      if (ghost || !has(p.vox, x, y, z + 1)) {
        const pts = [P(X, Y, z + 1), P(X + 1, Y, z + 1), P(X + 1, Y + 1, z + 1), P(X, Y + 1, z + 1)];
        if (facing(pts)) face(pts, 1, [0, 0, 1], true);
      }
      if (ghost || !has(p.vox, x, y, z - 1)) {   // bottom face: seen from below; tapping it builds downward
        const pts = [P(X, Y, z), P(X, Y + 1, z), P(X + 1, Y + 1, z), P(X + 1, Y, z)];
        if (facing(pts)) face(pts, .45, [0, 0, -1], true);
      }
    }
    if (below) {   // seen from under the island: a clearly visible (but see-through) floor, so the island never vanishes
      ctx.globalAlpha = p.alpha * (1 - fall) * .62; floor();
      ctx.globalAlpha = p.alpha * (1 - fall) * .9;
      poly(corners.map(([x, y]) => P(x, y, 0)), null, "rgba(165,169,201,.85)", Math.max(2, s * .04));
    }
    ctx.globalAlpha = 1;
  }

  // Ringed planet floating over the arena's center (source of the shooting star).
  const world = multi && opts.world;
  const planetAt = world ? [world.center[0], world.center[1], PLANET.z] : null;
  function drawPlanet() {
    const [cx, cy0] = proj(...planetAt);
    const r = Math.hypot(...[0, 1].map(i => proj(planetAt[0] + cy * PLANET.r, planetAt[1] - sy * PLANET.r, PLANET.z)[i] - [cx, cy0][i]));
    const ring = half => {   // back (0) or front (1) half of the tilted ring; from below (sp < 0) the halves swap
      if (sp < 0) half = 1 - half;   // (the minor radius must stay positive or the whole frame stops drawing)
      ctx.beginPath(); ctx.ellipse(cx, cy0, r * 1.9, r * 1.9 * Math.abs(sp) * .9 + r * .08, 0, half ? 0 : Math.PI, half ? Math.PI : 2 * Math.PI);
      ctx.strokeStyle = "rgba(242,193,78,.75)"; ctx.lineWidth = Math.max(2, r * .16); ctx.stroke();
    };
    ctx.globalAlpha = 1; ring(0);
    const g = ctx.createRadialGradient(cx - r * .35, cy0 - r * .4, r * .1, cx, cy0, r);
    g.addColorStop(0, "#9FE0FF"); g.addColorStop(.45, "#5B6BD9"); g.addColorStop(1, "#2A1F5C");
    ctx.shadowColor = "rgba(120,160,255,.6)"; ctx.shadowBlur = r * .5;
    ctx.beginPath(); ctx.arc(cx, cy0, r, 0, 2 * Math.PI); ctx.fillStyle = g; ctx.fill(); ctx.shadowBlur = 0;
    ring(1);
  }
  // Arena center planet (design lab html[data-core]): planet = the original; giant, ice, lava, earth, neon = new designs.
  const coreKind = typeof document !== "undefined" ? document.documentElement.dataset.core || "planet" : "planet";
  function drawCore() {
    if (!PLANETS[coreKind]) return drawPlanet();
    const P = PLANETS[coreKind];
    const [cx, cy0] = proj(...planetAt);
    const r = Math.hypot(...[0, 1].map(i => proj(planetAt[0] + cy * PLANET.r, planetAt[1] - sy * PLANET.r, PLANET.z)[i] - [cx, cy0][i]));
    const now = (typeof performance !== "undefined" ? performance.now() : 0) / 1000, turn = now * P.spin;
    const rings = (half) => (P.rings || []).forEach(([scale, color, w]) => {   // tilted rings, back half before the ball
      const h = sp < 0 ? 1 - half : half;
      ctx.beginPath(); ctx.ellipse(cx, cy0, r * scale, r * scale * Math.abs(sp) * .9 + r * .06, 0, h ? 0 : Math.PI, h ? Math.PI : 2 * Math.PI);
      ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.5, r * w); ctx.stroke();
    });
    ctx.save(); ctx.globalAlpha = 1;
    rings(0);
    // glow + ball
    ctx.shadowColor = P.glow; ctx.shadowBlur = r * .7;
    const g = ctx.createRadialGradient(cx - r * .35, cy0 - r * .4, r * .1, cx, cy0, r);
    P.ball.forEach((c, i) => g.addColorStop(i / (P.ball.length - 1), c));
    ctx.beginPath(); ctx.arc(cx, cy0, r, 0, 2 * Math.PI); ctx.fillStyle = g; ctx.fill(); ctx.shadowBlur = 0;
    // surface details, clipped to the ball; features move with the spin (lon → x on the sphere)
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy0, r, 0, 2 * Math.PI); ctx.clip();
    const onBall = (lon, lat) => { const L = lon + turn, c = Math.cos(lat);
      return { x: cx + Math.sin(L) * c * r, y: cy0 - Math.sin(lat) * r, front: Math.cos(L), w: Math.max(0, Math.cos(L)) * c }; };
    if (P.bands) for (const [lat, hh, col] of P.bands) {   // horizontal stripes (gas giant / neon)
      ctx.fillStyle = col; ctx.beginPath();
      ctx.ellipse(cx, cy0 - Math.sin(lat) * r, r * Math.cos(lat) * 1.02, r * hh, 0, 0, 2 * Math.PI); ctx.fill();
    }
    if (P.spots) for (const [lon, lat, size, col] of P.spots) {   // storm spot / craters
      const q = onBall(lon, lat); if (q.front <= 0) continue;
      ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(q.x, q.y, r * size * q.w + .5, r * size * .6, 0, 0, 2 * Math.PI); ctx.fill();
    }
    if (P.land) for (const [lon, lat, cells] of P.land) {   // blocky continents: little squares on the sphere
      for (const [dx, dy] of cells) {
        const q = onBall(lon + dx * .21, lat - dy * .21); if (q.front <= .05) continue;
        const sz = r * .21; ctx.fillStyle = dy % 2 ? P.landColors[1] : P.landColors[0];
        ctx.fillRect(q.x - sz * q.w / 2, q.y - sz / 2, sz * q.w + .5, sz);
      }
    }
    if (P.cracks) { ctx.strokeStyle = P.cracks; ctx.lineWidth = Math.max(1, r * .06); ctx.shadowColor = P.cracks; ctx.shadowBlur = r * .3;
      for (const crack of LAVA_CRACKS) {   // glowing lava cracks (fixed random polylines on the sphere)
        ctx.beginPath(); let first = true;
        for (const [lon, lat] of crack) { const q = onBall(lon, lat); if (q.front <= .05) { first = true; continue; }
          first ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y); first = false; }
        ctx.stroke();
      }
      ctx.shadowBlur = 0; }
    if (P.cap) { ctx.fillStyle = P.cap; ctx.beginPath(); ctx.ellipse(cx, cy0 - r * .92, r * .55, r * .22, 0, 0, 2 * Math.PI); ctx.fill(); }
    // night side shading + rim light
    const sh = ctx.createRadialGradient(cx - r * .45, cy0 - r * .45, r * .2, cx, cy0, r * 1.05);
    sh.addColorStop(0, "rgba(255,255,255,.18)"); sh.addColorStop(.55, "rgba(0,0,0,0)"); sh.addColorStop(1, "rgba(0,0,20,.55)");
    ctx.fillStyle = sh; ctx.fillRect(cx - r, cy0 - r, r * 2, r * 2);
    ctx.restore();
    if (P.atmo) { ctx.beginPath(); ctx.arc(cx, cy0, r * 1.04, 0, 2 * Math.PI); ctx.strokeStyle = P.atmo; ctx.lineWidth = Math.max(1.5, r * .08); ctx.stroke(); }
    rings(1);
    ctx.restore();
  }

  const items = plots.map(p => ({ p, d: depth(p.off[0] + N / 2, p.off[1] + N / 2, 0) }));
  if (planetAt) items.push({ planet: true, d: depth(...planetAt) });
  items.sort((a, b) => a.d - b.d);
  for (const it of items) it.planet ? drawCore() : drawIsland(it.p);

  // Free-floating blocks at fractional positions (e.g. blocks dropping in), drawn on top: { x, y, z, key, size, alpha }.
  for (const d of [...(opts.drops || [])].sort((a, b) => depth(a.x + .5, a.y + .5, a.z + .5) - depth(b.x + .5, b.y + .5, b.z + .5))) {
    const col = HEX[d.key] || "#A5A9C9", h = (d.size ?? 1) / 2, cx = d.x + .5, cy2 = d.y + .5, cz = d.z + .5;
    const P = (x, y, z) => proj(cx + x * h, cy2 + y * h, cz + z * h);
    ctx.globalAlpha = d.alpha ?? 1;
    for (const { n: [nx, ny], c } of FACES) {
      const [a, b] = c.map(([ax, ay]) => [ax * 2 - 1, ay * 2 - 1]);
      const pts = [P(a[0], a[1], -1), P(b[0], b[1], -1), P(b[0], b[1], 1), P(a[0], a[1], 1)];
      if (!facing(pts)) continue;
      if (TEXTURES[d.key]) { paintFace(ctx, pts, d.key, sideShade(nx, ny), false); poly(pts, null, "rgba(0,0,0,.18)"); }
      else poly(pts, shade(col, sideShade(nx, ny)), "rgba(0,0,0,.18)");
    }
    const tp = [P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)];
    if (TEXTURES[d.key]) { paintFace(ctx, tp, d.key, 1, true); poly(tp, null, "rgba(0,0,0,.18)"); } else poly(tp, col, "rgba(0,0,0,.18)");
    ctx.globalAlpha = 1;
  }

  // Shooting stars (planet → target point) and impact flashes. opts.fx: one { star, boom } or a list of them
  // (several islands destroyed in the same round).
  for (const fx of [].concat(opts.fx || [])) {
  if (fx.star && planetAt) {
    // Shooting star: long tapered tail (white core → blue-violet glow) along the curved path, sparkle dust, and a
    // bright head with a 4-point lens-flare cross.
    const { to, t } = fx.star, at = k => proj(...starPoint(world, to, Math.max(0, k)));
    const head = at(t), TAIL = 38, span = Math.min(t, .2), now = performance.now();
    const pts = Array.from({ length: TAIL }, (_, i) => at(t - span * i / (TAIL - 1)));
    ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.globalCompositeOperation = "lighter";
    for (let pass = 0; pass < 3; pass++) {   // outer glow, mid violet, white core
      const W = [s * .5, s * .26, s * .1][pass], col = [[120, 90, 255], [150, 130, 255], [255, 250, 255]][pass], A = [.22, .5, .95][pass];
      for (let i = 1; i < TAIL; i++) {
        const k = 1 - i / TAIL;   // 1 at the head → 0 at the tip
        ctx.beginPath(); ctx.moveTo(...pts[i - 1]); ctx.lineTo(...pts[i]);
        ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${A * k * k})`; ctx.lineWidth = Math.max(.5, W * (.15 + .85 * k)); ctx.stroke();
      }
    }
    // sparkle dust drifting off the tail
    for (let i = 0; i < 26; i++) {
      const j = 2 + ((i * 7) % (TAIL - 3)), p = pts[j], k = 1 - j / TAIL, ph = (now / 90 + i * 1.7) % 6.283;
      const off = s * .35 * (1 - k) * Math.sin(i * 12.9898), off2 = s * .35 * (1 - k) * Math.cos(i * 78.233);
      ctx.fillStyle = `rgba(${i % 3 ? "200,190,255" : "255,255,255"},${.85 * k * (.5 + .5 * Math.sin(ph))})`;
      const r = s * .035 * (.6 + k);
      ctx.beginPath(); ctx.arc(p[0] + off, p[1] + off2, r, 0, 6.283); ctx.fill();
    }
    // head: glow, bright core, 4-point flare (long cross + short diagonals), slowly twinkling
    const g = ctx.createRadialGradient(...head, 0, ...head, s * .9);
    g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(.18, "rgba(200,190,255,.85)"); g.addColorStop(.5, "rgba(120,90,255,.25)"); g.addColorStop(1, "rgba(120,90,255,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(...head, s * .9, 0, 6.283); ctx.fill();
    const tw = 1 + .15 * Math.sin(now / 70), spike = (ang, L, w) => {
      ctx.save(); ctx.translate(...head); ctx.rotate(ang);
      const sg = ctx.createLinearGradient(-L, 0, L, 0);
      sg.addColorStop(0, "rgba(255,255,255,0)"); sg.addColorStop(.5, "rgba(255,255,255,.95)"); sg.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = sg; ctx.beginPath(); ctx.moveTo(-L, 0); ctx.lineTo(0, -w); ctx.lineTo(L, 0); ctx.lineTo(0, w); ctx.closePath(); ctx.fill(); ctx.restore();
    };
    spike(0, s * 1.15 * tw, s * .05); spike(Math.PI / 2, s * 1.15 * tw, s * .05);
    spike(Math.PI / 4, s * .5 * tw, s * .03); spike(-Math.PI / 4, s * .5 * tw, s * .03);
    ctx.fillStyle = "#FFFFFF"; ctx.beginPath(); ctx.arc(...head, s * .12, 0, 6.283); ctx.fill();
    ctx.restore();
  }
  if (fx.boom) {
    const { at: b, t } = fx.boom, [bx, by] = proj(...b), rad = s * (0.5 + t * 4);
    const g = ctx.createRadialGradient(bx, by, 0, bx, by, rad);
    g.addColorStop(0, `rgba(255,246,221,${1 - t})`); g.addColorStop(.4, `rgba(255,178,63,${.8 * (1 - t)})`); g.addColorStop(1, "rgba(255,90,60,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(bx, by, rad, 0, 2 * Math.PI); ctx.fill();
  }
  }

  // Name labels float above each island.
  ctx.globalAlpha = 1; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
  // opts.bigNames (star cinematic, zoomed out): names stay readable however far the camera pulls back.
  const ls = opts.bigNames ? Math.max(s, W * .14) : s;
  ctx.font = `400 ${Math.round(ls * .26)}px Bungee, system-ui, sans-serif`;
  for (const p of plots) if (p.name && (p.fall || 0) < 1) {
    // Neighbours: just above their back corner, clear of their build. Focused island: a nameplate under
    // its front corner, so it never covers the islands behind it.
    let top = 0; p.vox.forEach((k, i) => { if (k) top = Math.max(top, Math.floor(i / (N * N)) + 1); });
    const corners = [[0, 0], [N, 0], [N, N], [0, N]].map(([x, y]) => [p.off[0] + x, p.off[1] + y])
      .sort((a, b) => depth(a[0], a[1], 0) - depth(b[0], b[1], 0));
    const plate = p.main && !opts.bigNames;   // during the star cinematic every island gets the same tag (no hint)
    const [bx, by] = plate ? corners[3] : corners[0];
    let [tx, ty] = proj(bx, by, plate ? 0 : top + .5);
    if (plate) { ctx.textBaseline = "top"; ty += 6; } else ctx.textBaseline = "bottom";
    ctx.globalAlpha = p.alpha * (1 - (p.fall || 0));
    // Winning streak (2+): a small flame + number after the name, inside the same pill.
    const stk = p.streak >= 2 ? String(p.streak) : "", fw = stk ? ls * .2 + ctx.measureText(stk).width + ls * .12 : 0;
    const nw = ctx.measureText(p.name).width, w = nw + fw, fh = ls * .3, pad = ls * .1;   // dark pill keeps labels readable
    const top0 = ctx.textBaseline === "top" ? ty : ty - fh;
    // style = the player's island theme; its tag color fills the name pill (dark text); none = the default dark pill.
    const tag = themeOf(p.style).tag;
    ctx.fillStyle = tag || "rgba(6,8,22,.72)"; ctx.beginPath();
    const rx = tx - w / 2 - pad, ry = top0 - pad * .6, rw = w + pad * 2, rh = fh + pad * 1.2;
    ctx.roundRect ? ctx.roundRect(rx, ry, rw, rh, fh / 2) : ctx.rect(rx, ry, rw, rh);   // roundRect: iOS 16+
    ctx.fill();
    ctx.fillStyle = tag ? "#14162C" : opts.bigNames ? "#F3EFE4" : "#A5A9C9"; ctx.fillText(p.name, tx - fw / 2, ty);
    if (stk) {
      const fx0 = tx - w / 2 + nw + ls * .12, fy = top0 + fh * .5, fs = fh * .5;
      flame(ctx, fx0 + ls * .08, fy, fs);
      ctx.save(); ctx.textAlign = "left"; ctx.fillStyle = tag ? "#14162C" : "#FF9A3C";
      ctx.fillText(stk, fx0 + ls * .2, ty); ctx.restore();
    }
    // Quick-chat phrase: a speech bubble just above the name pill, tail pointing down at it.
    if (p.say) {
      ctx.save(); ctx.textBaseline = "middle";
      ctx.font = `400 ${Math.round(s * .38)}px Bungee, system-ui, sans-serif`;
      const bw = ctx.measureText(p.say).width + s * .56, bh = s * .7, bx0 = tx - bw / 2, by0 = ry - bh - s * .2;
      ctx.fillStyle = "#FFF6DD"; ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(bx0, by0, bw, bh, bh / 2) : ctx.rect(bx0, by0, bw, bh);
      ctx.moveTo(tx - s * .13, by0 + bh - 1); ctx.lineTo(tx, by0 + bh + s * .17); ctx.lineTo(tx + s * .13, by0 + bh - 1);
      ctx.fill();
      ctx.fillStyle = "#14162C"; ctx.fillText(p.say, tx, by0 + bh / 2 + 1);
      ctx.restore();
      ctx.font = `400 ${Math.round(s * .26)}px Bungee, system-ui, sans-serif`;
    }
  }
  ctx.globalAlpha = 1;
}


const inside = ([px, py], pts) => {
  let r = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) r = !r;
  }
  return r;
};
// Topmost hit under a pointer event, or null.
export function pick(canvas, hits, e) {
  const r = canvas.getBoundingClientRect();
  const p = [(e.clientX - r.left) * canvas.width / r.width, (e.clientY - r.top) * canvas.height / r.height];
  for (let i = hits.length - 1; i >= 0; i--) if (inside(p, hits[i].pts)) return hits[i];
  return null;
}
const inBounds = ([x, y, z]) => x >= 0 && y >= 0 && z >= 0 && x < N && y < N && z < LAYERS;

// Drag on a canvas to orbit the camera; a press that barely moves counts as a tap → onTap(e).
// onHover(e | null) fires for mouse movement without a press (desktop placement preview).
export function orbit(canvas, cam, redraw, { onTap, onHover } = {}) {
  let last = null, moved = 0, vel = 0, lastT = 0, spin = 0;
  const stopSpin = () => { cancelAnimationFrame(spin); spin = 0; };
  canvas.classList.add("orbit");
  canvas.onpointerdown = e => { stopSpin(); last = [e.clientX, e.clientY]; moved = 0; vel = 0; lastT = e.timeStamp; try { canvas.setPointerCapture(e.pointerId); } catch {} };
  canvas.onpointermove = e => {
    if (!last) { if (onHover && e.pointerType === "mouse") onHover(e); return; }
    const dx = e.clientX - last[0], dy = e.clientY - last[1];
    moved += Math.abs(dx) + Math.abs(dy);
    if (moved < 8) return;   // still might be a tap
    const w = canvas.getBoundingClientRect().width;
    if (!canvas.isConnected || !w) { last = null; return; }   // view was replaced mid-drag (phase change)
    const kYaw = 2 * Math.PI / w, kPitch = Math.PI / w;   // full-width drag = a full 360° turn (tilt: 180°)
    cam.yaw -= dx * kYaw;
    cam.pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, cam.pitch + dy * kPitch));
    const dt = Math.max(1, e.timeStamp - lastT);   // smoothed spin speed (rad/ms) for the flick
    vel = vel * .6 + (-dx * kYaw / dt) * .4; lastT = e.timeStamp;
    last = [e.clientX, e.clientY]; redraw();
  };
  canvas.onpointerup = e => {
    const tap = last && moved < 8, released = !!last; last = null;
    if (tap && onTap) return onTap(e);
    // Flick: keep spinning around the island and ease out, unless the drag had already stopped.
    if (released && Math.abs(vel) > .0004 && e.timeStamp - lastT < 80) {
      let prev = performance.now();
      const step = now => {
        if (!canvas.isConnected) return stopSpin();
        const dt = Math.min(40, now - prev); prev = now;
        cam.yaw += vel * dt; vel *= Math.pow(.994, dt); redraw();
        spin = Math.abs(vel) > .00003 ? requestAnimationFrame(step) : 0;
      };
      spin = requestAnimationFrame(step);
    }
  };
  canvas.onpointercancel = () => { last = null; };
  canvas.onpointerleave = () => onHover && onHover(null);
  return cam;
}

// Small isometric cube for palette buttons (textured keys included), rendered once per key.
const iconCache = {};
const cubeIcon = c => {
  if (!iconCache[c]) {
    const cv = document.createElement("canvas"); cv.width = cv.height = 96;
    drawIsoCube(cv.getContext("2d"), 48, 50, 84, c);
    iconCache[c] = cv.toDataURL();
  }
  return `<img src="${iconCache[c]}" alt="" aria-hidden="true">`;
};

// Very small spark burst at a tap point (placing / removing a block), on its own overlay canvas.
function sparkLayer(canvas) {
  const ctx = canvas.getContext("2d"), parts = [];
  let raf = 0, last = 0;
  const tick = now => {
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]; p.life += dt;
      if (p.life > .32 || !canvas.isConnected) { parts.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 520 * dt;
      ctx.globalAlpha = 1 - p.life / .32; ctx.fillStyle = p.col; ctx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
    }
    ctx.globalAlpha = 1;
    raf = parts.length ? requestAnimationFrame(tick) : 0;
  };
  return (e, col) => {
    const r = canvas.getBoundingClientRect(); if (!r.width) return;
    const k = canvas.width / r.width, x = (e.clientX - r.left) * k, y = (e.clientY - r.top) * k;
    for (let i = 0; i < 9; i++) {
      const a = Math.random() * 6.283, v = (50 + Math.random() * 90) * k;
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60 * k, life: 0, s: (1.2 + Math.random() * 1.3) * k, col: i % 3 ? col : "#FFF6DD" });
    }
    if (!raf) { last = performance.now(); tick(last); }   // draw the first frame right away
  };
}

// Build directly in the 3D view: tap the floor or a block face to place a block against it,
// drag to look around. With the eraser selected, tapping a block removes it.
// limits (optional): { colorKey: max blocks } — shown as a remaining-count badge; placement stops at 0.
// scene (optional): () => ({ name, outline, neighbours }) passed through to draw() on every redraw.
export function mountBuilder(root, vox, palette, { onChange, t, cam = newCam(), limits = null, scene = null, outsideClear = false, fixed = null }) {
  let cur = palette[0] || null, locked = false;
  const undo = [];
  let hits = [];
  root.innerHTML = `
    <div class="view"><canvas class="sky" width="760" height="720" aria-hidden="true"></canvas><canvas id="bcv" width="760" height="720" aria-label="${t("dragHint")}"></canvas><canvas class="fx" width="760" height="720" aria-hidden="true"></canvas></div>
    <div class="row" id="bpal">${palette.map((c, i) =>
      `<button class="sw ${i ? "" : "on"}" data-c="${c}" aria-label="${c}">${cubeIcon(c)}${limits ? `<span class="cnt"></span>` : ""}</button>`).join("")}
      <button class="sw erase" data-c="" aria-label="${t("erase")}">DEL</button></div>
    <div class="row"><button class="btn ghost" id="bundo">${t("undo")}</button>
      ${outsideClear ? "" : `<button class="btn ghost" id="bclear">${t("clearAll")}</button>`}</div>`;
  const $ = s => root.querySelector(s), cv = $("#bcv");
  const left = c => limits[c] - vox.filter(v => v && HEX[v] === HEX[c]).length;
  const canPlace = () => !cur || !limits || left(cur) > 0;
  const target = h => !h ? null : cur ? (inBounds(h.place) && canPlace() ? h.place : null) : h.cell;
  const counts = () => limits && root.querySelectorAll(".sw[data-c]").forEach(b => {
    if (!b.dataset.c) return;
    const n = left(b.dataset.c); b.querySelector(".cnt").textContent = n; b.classList.toggle("empty", n <= 0);
  });
  const redraw = () => {
    counts();
    hits = [];
    const sc = scene ? scene() : {};   // scene may override the focused island's blocks (e.g. target during memorize)
    draw(cv, sc.vox || vox, { ...sc, cam: sc.cam || cam, hits: sc.cam ? [] : hits, transparent: true });
  };
  const set = (k, v) => { if (vox[k] === v || fixed?.has(k)) return; undo.push([k, vox[k]]); vox[k] = v; play(v ? "place" : "remove"); redraw(); onChange && onChange(); };
  fitView(root);
  startSky(root.querySelector(".sky"), cam);
  const sparks = sparkLayer(root.querySelector(".fx"));
  orbit(cv, cam, redraw, {
    onTap(e) {
      if (locked) return;
      const tg = target(pick(cv, hits, e));
      if (tg) { set(idx(...tg), cur); sparks(e, cur ? HEX[cur] : "#E3E6F5"); }
    },
  });
  $("#bpal").onclick = e => {
    const b = e.target.closest(".sw"); if (!b || locked) return; cur = b.dataset.c || null;
    root.querySelectorAll(".sw").forEach(s => s.classList.toggle("on", s === b));
  };
  $("#bundo").onclick = () => { const u = undo.pop(); if (!u || locked) return; vox[u[0]] = u[1]; play("remove"); redraw(); onChange && onChange(); };
  const clear = () => {
    if (locked) return;
    if (vox.some(Boolean)) play("remove");
    vox.forEach((v, k) => { if (v && !fixed?.has(k)) { undo.push([k, v]); vox[k] = null; } }); redraw(); onChange && onChange();
  };
  if ($("#bclear")) $("#bclear").onclick = clear;
  redraw();
  return { redraw, clear, disable() { locked = true; root.classList.add("locked"); redraw(); } };
}

// Draggable view-only canvas.
export function mountViewer(root, vox, t, cam = newCam(), size = [760, 720]) {
  root.innerHTML = `<div class="view"><canvas width="${size[0]}" height="${size[1]}" aria-label="${t("dragHint")}"></canvas></div>`;
  const cv = root.querySelector("canvas"), r = () => draw(cv, vox, { cam });
  orbit(cv, cam, r); r();
}

// Game-screen layouts other than the classic card (html[data-layout]) let the 3D view fill a big area: size the
// canvases to the view's real pixels so the world isn't a small fixed square.
function fitView(root) {
  const lay = document.documentElement.dataset.layout;
  if (!root.closest(".lab-demo") && (!lay || lay === "card" || !root.closest(".arena-stage"))) return;
  const view = root.querySelector(".view"), w = view.clientWidth, h = view.clientHeight;
  if (!w || !h) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  for (const c of view.querySelectorAll("canvas")) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
}

// Draggable view of an island scene; getScene() → { vox, name, outline, neighbours }. Returns redraw().
export function mountScene(root, t, cam, getScene) {
  root.innerHTML = `<div class="view"><canvas class="sky" width="760" height="720" aria-hidden="true"></canvas><canvas class="scene" width="760" height="720" aria-label="${t("dragHint")}"></canvas></div>`;
  const cv = root.querySelector(".scene"), r = () => { const sc = getScene(); draw(cv, sc.vox, { ...sc, cam: sc.cam || cam, transparent: true }); };
  fitView(root);
  startSky(root.querySelector(".sky"), cam);
  orbit(cv, cam, r); r();
  return r;
}
