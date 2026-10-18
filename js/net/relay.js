// Dev-server relay transport (serve.mjs): works across browsers and devices on the same network.
export function connect(room, onMessage) {
  const es = new EventSource(`relay/${room}`);
  es.onmessage = e => { try { onMessage(JSON.parse(e.data)); } catch {} };
  return new Promise((resolve, reject) => {
    const fail = setTimeout(() => { es.close(); reject(new Error("relay unreachable")); }, 5000);
    es.onopen = () => {
      clearTimeout(fail);
      resolve({
        send(msg) {
          fetch(`relay/${room}`, { method: "POST", headers: { "content-type": "application/json" },
                                   body: JSON.stringify(msg), keepalive: true }).catch(() => {});
        },
        close() { es.close(); },
      });
    };
  });
}
