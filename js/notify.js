// Notifications (iOS app only; the website does nothing here). Plan agreed with the user 2026-10-06:
//  * Phone-scheduled reminders (Capacitor LocalNotifications), re-planned on every launch for the next ~16 weeks:
//    - Weekly Challenge is live: every other Saturday at 12:05 Qatar time (just after the noon reset)
//    - "Come play" reminder: the other Saturdays, 12:00 local time
//    - Daily Challenge reminder: every Tuesday, 18:00 local time
//  * Server push (PushNotifications + Edge Function notify-friends): "X is playing Block Rush right now. Join in!" to
//    everyone who added X as a friend, at most once per 48 hours per person. Sent when X opens the app.
// iPhone always lets people refuse or turn notifications off; we ask once after their first game and, if they said no,
// show a gentle reminder on the menu at most once a week.
import { serverOn, rpc } from "./server.js";
import { getClient } from "./net/supabase.js";

const plugins = () => (window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins : null);
const DAY = 86400000;
const ANCHOR = Date.UTC(2026, 9, 10);   // Saturday 10 Oct 2026 = a Weekly Challenge Saturday (then every 14 days)
const IDS = [100, 200];                 // ids 100..199 are ours (cancelled and re-planned on each launch)
const GENERAL = [
  "Your island misses you. Come build!",
  "Think you can remember 300 shapes? Come prove it!",
  "Your friends are building. Join in!",
  "New day, new shapes. Ready to rush?",
  "Top 3 this month win a free month. Climb the board!",
];

// "granted" | "denied" | "prompt" | null (not the app)
export async function notifyStatus() {
  const LN = plugins()?.LocalNotifications; if (!LN) return null;
  try { return (await LN.checkPermissions()).display; } catch { return null; }
}

// Ask for permission (the iPhone pop-up shows only the first time), then plan reminders + register for push.
export async function askNotifications() {
  const LN = plugins()?.LocalNotifications; if (!LN) return;
  try { await LN.requestPermissions(); } catch {}
  await setupNotifications();
}

// On launch / return: if allowed, re-plan the reminders and refresh the push token.
export async function setupNotifications() {
  if ((await notifyStatus()) !== "granted") return;
  await planReminders();
  await registerPush();
}

async function planReminders() {
  const LN = plugins().LocalNotifications;
  // Android plays a channel's sound (res/raw/perfect.wav = the 100% chime); iPhone uses perfect.caf per notification.
  const android = window.Capacitor?.getPlatform?.() === "android";
  if (android) { try { await LN.createChannel({ id: "blockrush", name: "Block Rush", description: "Challenges and reminders", importance: 4, sound: "perfect.wav", vibration: true }); } catch {} }
  try {
    const { notifications } = await LN.getPending();
    const mine = notifications.filter(n => n.id >= IDS[0] && n.id < IDS[1]);
    if (mine.length) await LN.cancel({ notifications: mine.map(n => ({ id: n.id })) });
  } catch {}
  const now = Date.now(), list = [];
  const at = (id, when, body) => { if (when > now + 60000) list.push({ id, title: "Block Rush", body, sound: "perfect.caf", ...(android ? { channelId: "blockrush", isExactNotification: false } : {}), schedule: { at: new Date(when), allowWhileIdle: true } }); };   // sound = the 100% chime
  // Saturdays (by UTC date, which is Qatar's date at noon): alternate Weekly Challenge / general reminder.
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const firstSat = today.getTime() + ((6 - today.getUTCDay() + 7) % 7) * DAY;
  for (let k = 0; k < 16; k++) {
    const sat = firstSat + k * 7 * DAY, weekly = Math.round((sat - ANCHOR) / (7 * DAY)) % 2 === 0;
    if (weekly) at(100 + k, sat + 9 * 3600000 + 5 * 60000, "New Weekly Challenge! Win 5 free games");   // 12:05 Qatar = 09:05 UTC
    else { const d = new Date(sat); const local = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0);
      at(100 + k, local.getTime(), GENERAL[k % GENERAL.length]); }
  }
  // Tuesdays 18:00 local: Daily Challenge.
  const t = new Date(); t.setHours(18, 0, 0, 0);
  t.setDate(t.getDate() + ((2 - t.getDay() + 7) % 7));
  for (let k = 0; k < 16; k++) at(130 + k, t.getTime() + k * 7 * DAY, "Your Daily Challenge is waiting. Win a free game");
  try { if (list.length) await LN.schedule({ notifications: list }); } catch (e) { console.warn("reminders:", e?.message || e); }
}

let pushListening = false;
async function registerPush() {
  const PN = plugins()?.PushNotifications; if (!PN || !serverOn()) return;
  if (window.Capacitor?.getPlatform?.() === "android") return;   // Android push needs Firebase (google-services.json) — later
  try {
    if ((await PN.checkPermissions()).receive !== "granted") return;
    if (!pushListening) {
      pushListening = true;
      PN.addListener("registration", tok => rpc("save_push_token", { p_token: tok.value }).catch(() => {}));
    }
    await PN.register();
  } catch (e) { console.warn("push:", e?.message || e); }
}

// I'm playing: tell my friends (the server sends at most one per friend every 48 hours). At most once per 10 minutes.
let pingedAt = 0;
export async function pingFriends() {
  if (!serverOn() || Date.now() - pingedAt < 600000) return;   // the website counts as playing too
  pingedAt = Date.now();
  try { await (await getClient()).functions.invoke("notify-friends", { body: {} }); } catch {}
}
