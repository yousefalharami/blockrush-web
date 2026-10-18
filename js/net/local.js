// Same-browser transport for multi-tab testing. Echoes sends back to the sender,
// matching Supabase's broadcast `self: true`.
export function connect(room, onMessage) {
  const ch = new BroadcastChannel(`blockrush:${room}`);
  ch.onmessage = e => onMessage(e.data);
  return Promise.resolve({
    send(msg) { ch.postMessage(msg); queueMicrotask(() => onMessage(structuredClone(msg))); },
    close() { ch.close(); },
  });
}
