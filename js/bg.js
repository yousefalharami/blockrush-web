// Animated menu background: cubes floating in zero gravity + shooting stars on a full-screen canvas behind the UI.
// Interactive: dragging pushes blocks away, tapping a block knocks it with a small burst, tapping empty
// space launches a shooting star from that point. play()/pause() so it doesn't run during gameplay.
import { HEX, drawIsoCube } from "./voxel.js";

// Plain colors plus the textured blocks (brick, planks, grass, window, crate, screen, ice, stone).
const KEYS = ["R", "Y", "L", "G", "O", "P", "B", "V", "W", "S", "H", "F", "Q", "J", "X", "U", "I"];

let cv, ctx, W = 0, H = 0, dpr = 1, running = false, last = 0, raf = 0;
const blocks = [], stars = [], meteors = [], sparks = [];
let nextMeteor = 0, pointer = null;

function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  W = innerWidth; H = innerHeight;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
const rnd = (a, b) => a + Math.random() * (b - a);

function makeBlock() {
  const depth = rnd(.35, 1), a = rnd(0, 6.283), sp = (6 + depth * 16) * rnd(.6, 1.2);   // near blocks bigger & a bit faster
  const vx = Math.cos(a) * sp, vy = Math.sin(a) * sp;
  return { x: rnd(0, W), y: rnd(0, H), depth, size: 16 + depth * 34, vx, vy, bvx: vx, bvy: vy,   // bv* = cruising drift
           spin: rnd(-1, 1), wob: rnd(0, 6.28), key: KEYS[(Math.random() * KEYS.length) | 0] };
}
function seed() {
  blocks.length = stars.length = 0;
  const n = Math.round(Math.min(34, 14 + W * H / 26000));
  for (let i = 0; i < n; i++) blocks.push(makeBlock());
  for (let i = 0; i < Math.round(W * H / 5000); i++) stars.push({ x: Math.random(), y: Math.random(), r: Math.random() ** 3 * 1.8 + .4, a: rnd(.3, 1), tw: rnd(0, 6.28) });
  blocks.sort((a, b) => a.depth - b.depth);
}

function cube(b) {
  ctx.save(); ctx.translate(b.x, b.y + Math.sin(b.wob) * 3); ctx.rotate(Math.sin(b.wob * .5) * .12 * b.spin);
  drawIsoCube(ctx, 0, 0, b.size, b.key, .35 + b.depth * .55);
  ctx.restore();
}

function launch(x, y, dir) {   // shooting star from (x, y) heading down-left or down-right
  const d = dir ?? (Math.random() < .5 ? -1 : 1), sp = rnd(700, 1000);
  meteors.push({ x, y, vx: d * sp * .8, vy: sp * .45, life: 0, max: rnd(.9, 1.3) });
}
function burst(x, y, col) {
  for (let i = 0; i < 12; i++) { const a = rnd(0, 6.28), v = rnd(80, 260); sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, col }); }
}

function frame(now) {
  if (!running) return;
  const dt = Math.min(.05, (now - last) / 1000 || 0); last = now;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#05060F"); g.addColorStop(.55, "#0B0D24"); g.addColorStop(1, "#141838");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const t = now / 1000;
  for (const [x0, y0, r, col] of [[.2, .22, .7, "rgba(120,60,170,.20)"], [.85, .7, .6, "rgba(40,120,170,.16)"]]) {
    const n = ctx.createRadialGradient(x0 * W, y0 * H, 0, x0 * W, y0 * H, r * Math.max(W, H));
    n.addColorStop(0, col); n.addColorStop(1, "rgba(0,0,0,0)"); ctx.fillStyle = n; ctx.fillRect(0, 0, W, H);
  }
  for (const s of stars) {
    ctx.globalAlpha = s.a * (.6 + .4 * Math.sin(t * 2 + s.tw)); ctx.fillStyle = "#DDE3FF";
    ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.r, 0, 6.283); ctx.fill();
  }
  ctx.globalAlpha = 1;

  if (now > nextMeteor) { launch(rnd(W * .2, W * 1.1), rnd(-20, H * .3), -1); nextMeteor = now + rnd(6000, 10000); }

  for (const b of blocks) {
    if (pointer) {   // push away from the finger / cursor
      const dx = b.x - pointer.x, dy = b.y - pointer.y, d2 = dx * dx + dy * dy, R = 130;
      if (d2 < R * R && d2 > 1) { const d = Math.sqrt(d2), f = (1 - d / R) * 900 * dt; b.vx += dx / d * f; b.vy += dy / d * f; }
    }
    b.vx += (b.bvx - b.vx) * .6 * dt;                // zero gravity: pushes fade back to the slow cruising drift
    b.vy += (b.bvy - b.vy) * .6 * dt;
    b.x += b.vx * dt; b.y += b.vy * dt; b.wob += dt * (.5 + b.depth * .5);
    const m = b.size;                                // wrap around the edges, like floating through space
    if (b.x < -m) b.x = W + m; else if (b.x > W + m) b.x = -m;
    if (b.y < -m) b.y = H + m; else if (b.y > H + m) b.y = -m;
    cube(b);
  }
  for (let i = meteors.length - 1; i >= 0; i--) {
    const m = meteors[i]; m.life += dt; const k = m.life / m.max;
    if (k >= 1) { meteors.splice(i, 1); continue; }
    m.x += m.vx * dt; m.y += m.vy * dt;
    const len = .16, tx = m.x - m.vx * len, ty = m.y - m.vy * len, gr = ctx.createLinearGradient(tx, ty, m.x, m.y);
    gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(1, `rgba(255,244,214,${Math.sin(Math.PI * k)})`);
    ctx.strokeStyle = gr; ctx.lineWidth = 2.6; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(m.x, m.y); ctx.stroke();
    ctx.fillStyle = `rgba(255,248,230,${Math.sin(Math.PI * k)})`; ctx.beginPath(); ctx.arc(m.x, m.y, 2.4, 0, 6.283); ctx.fill();
  }
  for (let i = sparks.length - 1; i >= 0; i--) {
    const p = sparks[i]; p.life += dt; if (p.life > .6) { sparks.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 400 * dt;
    ctx.globalAlpha = 1 - p.life / .6; ctx.fillStyle = p.col; ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
  }
  ctx.globalAlpha = 1;
  raf = requestAnimationFrame(frame);
}

// Taps on the background (not on buttons/inputs/the game) knock blocks or launch a shooting star.
function onTap(e) {
  if (!running || e.target.closest("button, a, input, select, textarea, canvas:not(.menu-bg), .stage, .howto-video")) return;
  const hit = [...blocks].reverse().find(b => Math.hypot(b.x - e.clientX, b.y - e.clientY) < b.size * .7);
  if (hit) {
    const a = Math.atan2(hit.y - e.clientY, hit.x - e.clientX) || -Math.PI / 2;
    hit.vx += Math.cos(a) * 420; hit.vy += Math.sin(a) * 420 - 200; hit.spin *= -3; burst(hit.x, hit.y, HEX[hit.key]);
  } else launch(e.clientX, e.clientY, e.clientX > W / 2 ? -1 : 1);
}

export function initBackground() {
  cv = document.createElement("canvas"); cv.className = "menu-bg"; cv.setAttribute("aria-hidden", "true");
  document.body.prepend(cv); ctx = cv.getContext("2d");
  resize(); seed();
  addEventListener("resize", () => { resize(); seed(); });
  addEventListener("pointermove", e => { pointer = { x: e.clientX, y: e.clientY }; }, { passive: true });
  addEventListener("pointerup", e => { if (e.pointerType !== "mouse") pointer = null; }, { passive: true });
  addEventListener("pointerleave", () => { pointer = null; });
  addEventListener("pointerdown", e => { pointer = { x: e.clientX, y: e.clientY }; onTap(e); }, { passive: true });
  nextMeteor = performance.now() + 2500;
}
export function play() {
  if (running || !cv) return;
  running = true; cv.hidden = false; last = performance.now(); raf = requestAnimationFrame(frame);
}
export function pause() {
  running = false; cancelAnimationFrame(raf); if (cv) cv.hidden = true;
}
