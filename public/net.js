// Multiplayer connection: one WebSocket to the room server.
// net.role is 'solo' (no room), 'host' (runs the match) or 'client' (joined a friend's room).
export const net = {
  role: 'solo',
  id: null,       // our player id in the room
  hostId: null,
  room: null,     // 4-letter room code
  ping: 0,        // round trip to the server in ms
  ws: null,
  handlers: {},   // message type -> function(msg)
  onClose: null,
};

export function connect() {
  return new Promise((resolve, reject) => {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    const ws = new WebSocket(url);
    net.ws = ws;
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('Could not reach the game server.'));
    ws.onclose = () => {
      const wasOnline = net.role !== 'solo';
      net.ws = null;
      if (wasOnline && net.onClose) net.onClose();
    };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.t === 'pong') { net.ping = Math.round(performance.now() - msg.ts); return; }
      const h = net.handlers[msg.t];
      if (h) h(msg);
    };
  });
}

export function send(msg) {
  if (net.ws && net.ws.readyState === 1) net.ws.send(JSON.stringify(msg));
}

// Measure ping every couple of seconds.
setInterval(() => { if (net.ws && net.ws.readyState === 1) send({ t: 'ping', ts: performance.now() }); }, 2000);

// Wait for one specific reply (e.g. 'created' or 'joined'), or an error.
export function waitFor(type) {
  return new Promise((resolve, reject) => {
    const prevOk = net.handlers[type], prevErr = net.handlers.error;
    net.handlers[type] = (m) => { net.handlers[type] = prevOk; net.handlers.error = prevErr; resolve(m); };
    net.handlers.error = (m) => { net.handlers[type] = prevOk; net.handlers.error = prevErr; reject(new Error(m.reason)); };
  });
}

export function leave() {
  net.role = 'solo';
  if (net.ws) net.ws.close();
}
