import { serverOn } from "../server.js";

// supabase: real backend (once signed in) · relay: dev server relay, any browser/device on the network
// local: BroadcastChannel, same browser only. Override with ?net=...
export function transportName() {
  const q = new URLSearchParams(location.search).get("net");
  if (q === "local" || q === "supabase" || q === "relay") return q;
  if (serverOn()) return "supabase";
  return location.protocol.startsWith("http") ? "relay" : "local";
}

export async function connect(room, onMessage) {
  const name = transportName();
  const mod = await import(name === "supabase" ? "./supabase.js" : name === "relay" ? "./relay.js" : "./local.js");
  return mod.connect(room, onMessage);
}
