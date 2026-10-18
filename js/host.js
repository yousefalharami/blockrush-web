// Authoritative game state. Runs only on the host client; everyone else renders its broadcasts.
import { CONFIG } from "./config.js";
import { storeConfig, cmpVersion } from "./store.js";
import { parseLayers, toLayers, score, HEX, ISLAND_THEMES, N } from "./voxel.js";

// Island themes players can pick (online rooms only; sent in hello as `style`, null = default "night").
export const STYLES = Object.keys(ISLAND_THEMES).filter(k => k !== "night");

// resume (host migration): { snap, oldHost, remainingMs } — continue a match from the last state the old host sent.
export function createHost({ net, selfId, builds, settings: initial = {}, resume = null }) {
  const players = new Map();   // id → { id, name, alive, lastSeen }
  let phase = "lobby", round = 0, targetId = null, deadline = 0, results = null, winner = null;
  let subs = {};               // id → { layers, at }
  let skips = new Set();       // Best of 5: players who pressed Skip on this round's scoreboard
  // Lobby settings chosen by the host: mode, difficulty, memorize/build durations ("auto" = by shape level),
  // whether players see each other's blocks.
  // mode "elim": lowest score is destroyed each round. mode "points" (Best of 5): any number of players,
  // POINTS_ROUNDS rounds, nobody is eliminated, highest total % wins.
  const settings = { mode: "elim", difficulty: "auto", showMs: "auto", buildMs: "auto", showOthers: true, ...initial };
  if (!["auto", "easy", "intermediate", "hard"].includes(settings.difficulty)) settings.difficulty = "auto";
  for (const k of ["showMs", "buildMs"]) if (settings[k] !== "auto" && !Number.isFinite(settings[k])) settings[k] = "auto";
  let times = { show: CONFIG.SHOW_MS, build: CONFIG.BUILD_MS };   // this round's memorize/build durations
  // solo: 1-player practice (endless). game: bumps every start so rounds are unique. totals: points-mode scores.
  let timer = null, recent = [], solo = false, buildStart = 0, game = 0, totals = {};
  let matchId = null;   // random per match: the server's key for charging games and claiming wins
  if (!["elim", "points"].includes(settings.mode)) settings.mode = "elim";   // e.g. an old saved "duel"
  const points = () => settings.mode === "points";

  // Online rooms never start instantly: a 5s countdown (AUTO_START_MS) runs first, and players can still join
  // during it. It starts by itself when the room fills up (cancelled if someone leaves before the host pressed
  // Start), or when the host presses Start with at least the minimum (cancelled only if it drops below that).
  let autoAt = 0, autoTimer = null, autoBy = null;
  function countdown(by) {
    autoBy = by; autoAt = Date.now() + CONFIG.AUTO_START_MS;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => { autoAt = 0; autoBy = null; if (players.size >= api.minPlayers()) begin(); else broadcast(); }, CONFIG.AUTO_START_MS);
  }
  function checkAutoStart() {
    if (phase !== "lobby" || !settings.room?.online) return;
    const full = players.size >= settings.room.max, enough = players.size >= api.minPlayers();
    if (!autoAt && full) countdown("full");
    else if (autoAt && (autoBy === "full" ? !full : !enough)) { clearTimeout(autoTimer); autoAt = 0; autoBy = null; }
  }
  const streakOf = n => Math.max(0, Math.min(999, Math.floor(+n) || 0));   // winning streak shown beside the name (from my_profile)
  const styleOf = st => (settings.room?.online && STYLES.includes(st) ? st : null);   // themes are an online-room thing
  const alive = () => [...players.values()].filter(p => p.alive);
  const snapshot = () => ({
    phase, round, game, matchId, targetId, results, winner, host: selfId, settings, totals, times, skips: [...skips],
    maxRounds: points() ? CONFIG.POINTS_ROUNDS : null,
    remainingMs: Math.max(0, deadline - Date.now()),
    players: [...players.values()].map(({ id, name, alive, style, streak }) => ({ id, name, alive, style, streak, submitted: !!subs[id] })),
    quiz: phase === "lobby" && quiz ? quizView() : null,
    autoStartMs: phase === "lobby" && autoAt ? Math.max(0, autoAt - Date.now()) : null, autoBy,
  });

  // ---- Online lobby mini-game "Spot the odd one": 4 copies of a shape, one has a single block in a different
  // color. First player to tap the odd one scores a point; one tap per player per question.
  let quiz = null, quizTimer = null, quizN = 0;
  const quizScores = {};
  const online = () => !!settings.room?.online;
  // One small change to a shape, visible from above: recolor a top block to another color the shape already
  // uses, swap the colors of two touching top blocks, or move a top block somewhere else (same block count).
  function oddVersion(vox) {
    const at = (x, y, z) => x < 0 || y < 0 || x >= N || y >= N || z < 0 || z >= N ? undefined : vox[z * N * N + y * N + x];
    const xyz = i => [i % N, Math.floor(i / N) % N, Math.floor(i / (N * N))];
    const tops = vox.map((k, i) => k && !vox[i + N * N] ? i : -1).filter(i => i >= 0);
    const used = [...new Set(vox.filter(Boolean))];
    const pick = a => a[Math.floor(Math.random() * a.length)];
    const kinds = ["recolor", "swap", "move"].sort(() => Math.random() - .5);
    for (const kind of kinds) {
      const v = [...vox];
      if (kind === "recolor") {
        const i = pick(tops), c = used.filter(k => HEX[k] !== HEX[vox[i]]);
        if (!c.length) continue;
        v[i] = pick(c); return v;
      }
      if (kind === "swap") {
        const pairs = [];
        for (const i of tops) { const [x, y, z] = xyz(i);
          for (const [dx, dy] of [[1, 0], [0, 1]]) { const j = (z * N + y + dy) * N + x + dx;
            if (x + dx < N && y + dy < N && tops.includes(j) && HEX[vox[j]] !== HEX[vox[i]]) pairs.push([i, j]); } }
        if (!pairs.length) continue;
        const [i, j] = pick(pairs); [v[i], v[j]] = [v[j], v[i]]; return v;
      }
      if (kind === "move") {
        // remove a top block that nothing depends on, add the same color on an empty spot resting on the floor or a block
        const i = pick(tops); v[i] = null;
        const spots = [];
        for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
          const k = z * N * N + y * N + x; if (v[k] || k === i) continue;
          const supported = z === 0 ? [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => at(x + dx, y + dy, 0)) : !!v[k - N * N];
          if (supported) spots.push(k);
        }
        if (!spots.length) continue;
        v[pick(spots)] = vox[i]; return v;
      }
    }
    return null;
  }
  function quizView() {
    return { q: quiz.q, boards: quiz.boards, yaws: quiz.yaws, reveal: quiz.reveal, answer: quiz.reveal ? quiz.answer : null,
             winner: quiz.winner, wrong: Object.keys(quiz.guesses).filter(id => quiz.guesses[id] !== quiz.answer),
             scores: quizScores, remainingMs: Math.max(0, quiz.ends - Date.now()) };
  }
  function quizNext() {
    clearTimeout(quizTimer);
    if (phase !== "lobby" || !online()) { quiz = null; return; }
    // Subtle change, never a brand-new color; every island is shown from a different angle (yaws).
    const ids = [...builds.keys()].filter(id => { const v = builds.get(id).vox; return v.filter(Boolean).length >= 8 && new Set(v.filter(Boolean).map(k => HEX[k])).size >= 2; });
    let vox, odd = null;
    for (let tries = 0; !odd && tries < 50; tries++) {
      vox = builds.get(ids[Math.floor(Math.random() * ids.length)]).vox;
      odd = oddVersion(vox);
    }
    const answer = Math.floor(Math.random() * 4);
    const base = Math.random() * Math.PI * 2, yaws = [0, 1, 2, 3].map(i => base + i * Math.PI / 2 + (Math.random() - .5) * .5).sort(() => Math.random() - .5);
    quiz = { q: ++quizN, boards: [0, 1, 2, 3].map(i => toLayers(i === answer ? odd : vox)), yaws, answer, guesses: {}, reveal: false,
             winner: null, ends: Date.now() + CONFIG.QUIZ_MS };
    quizTimer = setTimeout(quizReveal, CONFIG.QUIZ_MS);
    broadcast();
  }
  function quizReveal() {
    clearTimeout(quizTimer);
    if (!quiz || phase !== "lobby") return;
    quiz.reveal = true; quiz.ends = Date.now() + CONFIG.QUIZ_REVEAL_MS;
    quizTimer = setTimeout(quizNext, CONFIG.QUIZ_REVEAL_MS);
    broadcast();
  }
  function quizGuess(from, q, pick) {
    if (!quiz || quiz.reveal || q !== quiz.q || from in quiz.guesses || !players.has(from)) return;
    quiz.guesses[from] = pick;
    if (pick === quiz.answer) { quiz.winner = from; quizScores[from] = (quizScores[from] || 0) + 1; return quizReveal(); }
    if ([...players.keys()].every(id => id in quiz.guesses)) return quizReveal();   // everyone missed
    broadcast();
  }
  const broadcast = () => net.send({ t: "state", from: selfId, state: snapshot() });

  function go(next, ms, then) {
    clearTimeout(timer);
    if (next !== "lobby") { clearTimeout(quizTimer); quiz = null; }
    phase = next; deadline = Date.now() + ms;
    if (then) timer = setTimeout(then, ms);
    broadcast();
  }

  function pickTarget() {
    const tiers = settings.difficulty === "auto" ? CONFIG.AUTO_TIERS(round) : CONFIG.DIFFICULTY_TIERS[settings.difficulty];
    const all = [...builds.keys()], inTier = all.filter(id => tiers.includes(builds.get(id).tier));
    const ids = inTier.length ? inTier : all;
    const fresh = ids.filter(id => !recent.includes(id));
    const pool = fresh.length ? fresh : ids;
    const id = pool[Math.floor(Math.random() * pool.length)];
    recent = [...recent, id].slice(-Math.max(1, Math.floor(ids.length / 2)));
    return id;
  }

  function newRound() {
    round++; targetId = pickTarget(); results = null; subs = {};
    const auto = CONFIG.TIER_TIMES[builds.get(targetId).tier];   // "auto" timings follow the shape's level
    times = { show: settings.showMs === "auto" ? auto.show : settings.showMs, build: settings.buildMs === "auto" ? auto.build : settings.buildMs };
    go("show", times.show, () => { buildStart = Date.now(); go("build", times.build, collect); });
  }

  function collect() { go("collect", CONFIG.COLLECT_MS, judge); }

  function judge() {
    const target = builds.get(targetId).vox;
    const rows = alive().map(p => {
      const s = subs[p.id];
      return { id: p.id, name: p.name, layers: s ? s.layers : null,
               score: s ? score(target, parseLayers(s.layers)) : 0, at: s ? s.at : Infinity };
    });
    // Lowest score is out. Tie → whoever reached their final build later (or never submitted) is out.
    rows.sort((a, b) => b.score - a.score || a.at - b.at);
    if (points()) {   // no elimination: add to running totals
      for (const r of rows) totals[r.id] = (totals[r.id] || 0) + r.score;
    } else {
      // Lowest score is out; also everyone who scored 0% (if all did, they're all out and nobody wins).
      if (rows.length > 1) {
        for (const r of rows) if (r.score === 0) r.elim = true;
        rows[rows.length - 1].elim = true;
        for (const r of rows) if (r.elim) players.get(r.id).alive = false;
      }
    }
    results = rows.map(({ at, ...r }) => r);
    skips = new Set();
    // Best of 5: no shooting star, the scoreboard shows right away for SCOREBOARD_MS (or until everyone skips).
    go("judge", points() ? CONFIG.POINTS_JUDGE_MS : CONFIG.JUDGE_MS, afterJudge);
  }

  function afterJudge() {
    if (phase !== "judge") return;
    {
      const left = alive();
      if (points() && left.length) {
        // Ends after the last round, or early once nobody can catch the leader. Tied leaders = draw.
        const ranked = left.map(p => ({ id: p.id, tot: totals[p.id] || 0 })).sort((a, b) => b.tot - a.tot);
        const remaining = CONFIG.POINTS_ROUNDS - round, [first, second] = ranked;
        if (remaining <= 0 || (second && first.tot - second.tot > remaining * 100)) {
          winner = second && second.tot === first.tot ? null : first.id; go("over", 0);
        } else newRound();
      }
      else if (solo) newRound();
      else if (left.length <= 1) { winner = left[0] ? left[0].id : null; go("over", 0); }
      else newRound();
    }
  }

  function dropMissing() {
    const now = Date.now();
    for (const p of players.values()) {
      if (p.id === selfId || now - p.lastSeen < CONFIG.PLAYER_TIMEOUT_MS) continue;
      remove(p.id);
    }
  }

  function remove(id) {
    const p = players.get(id); if (!p) return;
    if (phase === "lobby" || phase === "over") { players.delete(id); checkAutoStart(); }
    else { p.alive = false; p.gone = true; }
    if (phase !== "lobby" && phase !== "over" && alive().length <= 1 && phase !== "judge") {
      clearTimeout(timer); winner = alive()[0]?.id ?? null; go("over", 0);
    } else broadcast();
  }

  function onMessage(m) {
    const p = players.get(m.from);
    if (p) p.lastSeen = Date.now();
    switch (m.t) {
      case "hello":
        if (p) { p.name = String(m.name).slice(0, 16); p.style = styleOf(m.style); if (m.streak != null) p.streak = streakOf(m.streak); broadcast(); break; }
        // Players on an app version below the server's minimum can't join (it could break the match).
        if (m.ver && cmpVersion(m.ver, storeConfig().minVersion) < 0) {
          net.send({ t: "reject", from: selfId, to: m.from, reason: "updateRequired" }); break;
        }
        // Private codes only work from the Private screen and online codes from the Online screen.
        if (m.kind && (m.kind === "online") !== !!settings.room?.online) {
          net.send({ t: "reject", from: selfId, to: m.from, reason: settings.room?.online ? "isOnlineRoom" : "isPrivateRoom" }); break;
        }
        if (phase !== "lobby") { net.send({ t: "reject", from: selfId, to: m.from, reason: "inProgress" }); break; }
        // Best of 5 is an Unlimited-only mode: every player needs it, not just the host.
        if (settings.mode === "points" && !m.unl) { net.send({ t: "reject", from: selfId, to: m.from, reason: "needsUnlimited" }); break; }
        if (players.size >= (settings.room?.max || CONFIG.MAX_PLAYERS)) { net.send({ t: "reject", from: selfId, to: m.from, reason: "roomFull" }); break; }
        players.set(m.from, { id: m.from, name: String(m.name).slice(0, 16), style: styleOf(m.style), streak: streakOf(m.streak), alive: true, lastSeen: Date.now() });
        if (!quiz) quizNext();
        checkAutoStart();
        broadcast();
        break;
      case "submit":
        if (!p || !p.alive || m.round !== round || subs[m.from] || (phase !== "build" && phase !== "collect")) break;
        // doneAt: ms from build start to the player's last edit (client-measured, so no clock skew).
        subs[m.from] = { layers: m.layers, at: Number.isFinite(m.doneAt) ? m.doneAt : Date.now() - buildStart };
        if (alive().every(a => subs[a.id])) judge(); else broadcast();
        break;
      case "skip":
        if (!p || phase !== "judge" || !points() || m.round !== round) break;
        skips.add(m.from);
        if (alive().every(a => skips.has(a.id))) { clearTimeout(timer); afterJudge(); } else broadcast();
        break;
      case "guess": if (phase === "lobby") quizGuess(m.from, m.q, m.pick); break;
      case "bye": remove(m.from); break;
    }
  }

  // If this phone was frozen (app in the background), everyone else only looks silent: refresh them, don't drop them.
  let lastBeat = Date.now();
  const beat = setInterval(() => {
    const now = Date.now();
    if (now - lastBeat > CONFIG.HEARTBEAT_MS * 2.5) for (const p of players.values()) p.lastSeen = now;
    lastBeat = now; dropMissing(); broadcast();
  }, CONFIG.HEARTBEAT_MS);

  const api = {
    onMessage,
    setSettings(patch) {   // lobby only
      if (phase !== "lobby") return;
      Object.assign(settings, patch); broadcast();
    },
    getSettings: () => ({ ...settings }),
    // Online rooms need a minimum crowd to start (8-room: 5, 12-room: 9); local rooms need MIN_PLAYERS.
    minPlayers: () => CONFIG.ONLINE_ROOMS.find(r => r.max === settings.room?.max)?.min ?? CONFIG.MIN_PLAYERS,
    canStart() { return phase === "lobby" && players.size >= api.minPlayers(); },
    // Private rooms start at once; online rooms go through the 5s countdown (the host can't skip it).
    start() {
      if (!api.canStart()) return;
      if (settings.room?.online) { if (!autoAt) { countdown("host"); broadcast(); } return; }
      begin();
    },
    counting: () => !!autoAt,
  };
  function begin() {
    if (!api.canStart()) return;
    clearTimeout(autoTimer); autoAt = 0; autoBy = null; solo = !points() && players.size === 1; game++; matchId = Math.random().toString(36).slice(2, 10); totals = {}; newRound();
  }
  // Host migration: rebuild the room from the old host's last snapshot (minus the old host) and continue the
  // current phase with the time that was left. Submitted builds are re-sent by their players.
  function resumeFrom({ snap, oldHost, remainingMs }) {
    ({ round, game, targetId, results, winner } = snap);
    matchId = snap.matchId || null; totals = snap.totals || {}; times = snap.times || times; skips = new Set(snap.skips || []);
    for (const p of snap.players) if (p.id !== oldHost) players.set(p.id, { id: p.id, name: p.name, style: p.style, streak: p.streak, alive: p.alive, lastSeen: Date.now() });
    if (targetId) recent = [targetId];
    const rem = Math.max(1500, remainingMs || 0), ph = snap.phase;
    if (ph !== "lobby" && ph !== "over" && ph !== "judge" && !points() && alive().length <= 1) {   // the host was the last rival
      winner = alive()[0]?.id ?? null; return go("over", 0);
    }
    if (ph === "lobby") { go("lobby", 0); quizNext(); checkAutoStart(); }
    else if (ph === "show") go("show", rem, () => { buildStart = Date.now(); go("build", times.build, collect); });
    else if (ph === "build") { buildStart = Date.now() - Math.max(0, times.build - rem); go("build", rem, collect); }
    else if (ph === "collect") go("collect", Math.max(rem, CONFIG.COLLECT_MS), judge);
    else if (ph === "judge") go("judge", rem, afterJudge);
    else go("over", 0);
  }
  Object.assign(api, {
    reset() {   // back to lobby after "over"; remove players who left
      clearTimeout(timer);
      for (const [id, pl] of players) if (pl.gone) players.delete(id); else pl.alive = true;
      round = 0; results = null; winner = null; subs = {}; targetId = null; totals = {};
      go("lobby", 0); quizNext();
    },
    stop() { clearInterval(beat); clearTimeout(timer); clearTimeout(quizTimer); clearTimeout(autoTimer); },
  });
  if (resume) resumeFrom(resume);
  return api;
}
