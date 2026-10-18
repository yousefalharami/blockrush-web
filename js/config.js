export const CONFIG = {
  SHOW_MS: 10_000,
  BUILD_MS: 75_000,
  COLLECT_MS: 2_500,   // grace period for late submissions after the build timer ends
  JUDGE_MS: 10_000,
  POINTS_JUDGE_MS: 7_800, // Best of 5: 0.8s pause, then the scoreboard for 7s (skippable)
  SCOREBOARD_MS: 4_000, // elimination: scoreboard for the last 4s of judging (the first 6s are the shooting-star sequence)
  // Per-shape-level timings used by "Auto" (memorize / build, ms).
  TIER_TIMES: {
    "very easy": { show: 5_000, build: 15_000 },
    easy:        { show: 7_000, build: 25_000 },
    medium:      { show: 9_000, build: 35_000 },
    hard:        { show: 10_000, build: 45_000 },
  },
  // Difficulty → which shape levels can be picked. "auto" ramps up by round (see AUTO_TIERS).
  DIFFICULTY_TIERS: { easy: ["very easy", "easy"], intermediate: ["medium"], hard: ["hard"] },
  AUTO_TIERS: round => round <= 1 ? ["very easy", "easy"] : round === 2 ? ["easy"] : round <= 4 ? ["medium"] : ["hard"],
  // Local rooms can override the timings (seconds); "auto" = TIER_TIMES.
  SHOW_CHOICES: [5, 10, 15, 20],          // seconds
  BUILD_CHOICES: [30, 45, 60, 75, 90, 120],
  POINTS_ROUNDS: 5,    // "Best of 5" mode: every player plays 5 rounds, highest total % wins
  MIN_PLAYERS: 1,       // 1 = solo practice allowed (no eliminations, endless rounds)
  MAX_PLAYERS: 16,
  AUTO_START_MS: 5_000, // online: a full room starts by itself after this countdown
  QUIZ_MS: 10_000, QUIZ_REVEAL_MS: 2_500, // lobby "Guess the shape": answer time, then the answer shows
  ONLINE_ROOMS: [{ max: 10, min: 7 }], // online rooms: 10 players, Start unlocks at 7 (user, 2026-10-07; was 8/5 and 12/9)
  DESIGN_LAB: false,  // menu link to #lab (design picker). OFF for release (2026-10-07); #lab still opens by URL on the dev site
  HEARTBEAT_MS: 2_000,
  // Grace before someone counts as gone (answering a call / a quick text must not kick them). iPhone freezes the app
  // in the background, so a short away looks like silence. Explicit Leave still sends "bye" (instant).
  PLAYER_TIMEOUT_MS: 30_000,
  HOST_TIMEOUT_MS: 15_000,        // during a match: no state from the host for this long → host migration
  HOST_TIMEOUT_LOBBY_MS: 30_000,  // waiting room / game over
  // Trusted clock for the daily free games when the server is unreachable (on-device fallback only): any
  // same-origin URL whose response has a Date header ("" = this app's own server). With Supabase the server
  // keeps the counts and the day itself.
  TIME_URL: "",
  // Remote store config (packs, prices, badges, banner, free games per day). "" = config/store.json here.
  STORE_URL: "",
  // Supabase project + publishable key (safe to ship). Empty = dev relay + on-device counts only.
  SUPABASE_URL: "https://ejnqoxorlnrwgqfyxacv.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_Tt6w0vMKUu3Z1RdOdr2LUw_j0SkhG1t",
  APP_VERSION: "1.0.1",        // bump with every App Store release (and Xcode MARKETING_VERSION); checked against the server's minVersion
  ROOM_HEARTBEAT_MS: 10_000,   // host refreshes its room in the server list (Open rooms) this often
};
