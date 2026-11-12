// Neon Arena server: serves the game files and relays multiplayer rooms.
//
// How multiplayer works: whoever creates a room is the "host". The host's browser runs the
// match (bots, health, kills, rounds) and sends snapshots; everyone else sends their movement
// and hits to the host. This server just keeps rooms and forwards messages, so it stays tiny
// and fits on a free hosting plan.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || process.argv[2]) || 3000;
const MAX_HUMANS = 8;

// ---------------------------------------------------------------- static files
const ROOTS = {
  '/three/': path.join(__dirname, 'node_modules', 'three'),
  '/': path.join(__dirname, 'public'),
};
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/health') { res.end('ok'); return; }
  if (pathname === '/') pathname = '/index.html';
  const prefix = Object.keys(ROOTS).find((p) => pathname.startsWith(p));
  const root = ROOTS[prefix];
  const file = path.normalize(path.join(root, pathname.slice(prefix.length)));
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const isThree = prefix === '/three/';
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      // Game files change with every update; the three.js library never does.
      'Cache-Control': isThree ? 'public, max-age=86400' : 'no-cache',
    });
    res.end(data);
  });
});

// ---------------------------------------------------------------- rooms
const rooms = new Map(); // code -> { code, hostId, settings, clients: Map<id, client> }
let nextId = 1;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O to avoid confusion

function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}

const clean = (s, n) => String(s || '').replace(/[<>&"]/g, '').slice(0, n);

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

wss.on('connection', (ws) => {
  const me = { id: nextId++, ws, room: null, name: 'Player', avatar: 'kaze' };
  let alive = true;
  ws.on('pong', () => (alive = true));
  const heartbeat = setInterval(() => {
    if (!alive) { ws.terminate(); return; }
    alive = false;
    ws.ping();
  }, 20000);

  ws.on('message', (raw) => {
    const text = raw.toString();
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    const room = me.room;

    switch (msg.t) {
      case 'ping':
        send(ws, { t: 'pong', ts: msg.ts });
        return;

      case 'create': {
        if (room) return;
        me.name = clean(msg.name, 16) || 'Host';
        me.avatar = clean(msg.avatar, 16);
        me.tint = clean(msg.tint, 8);
        const code = newCode();
        const r = { code, hostId: me.id, settings: msg.settings || {}, clients: new Map([[me.id, me]]) };
        rooms.set(code, r);
        me.room = r;
        send(ws, { t: 'created', room: code, id: me.id });
        console.log(`room ${code} created`);
        return;
      }

      case 'join': {
        if (room) return;
        const r = rooms.get(String(msg.room || '').toUpperCase());
        if (!r) { send(ws, { t: 'error', reason: 'Room not found. Ask your friend for a new link.' }); return; }
        if (r.clients.size >= MAX_HUMANS) { send(ws, { t: 'error', reason: 'That room is full (8 players).' }); return; }
        me.name = clean(msg.name, 16) || 'Player';
        me.avatar = clean(msg.avatar, 16);
        me.tint = clean(msg.tint, 8);
        r.clients.set(me.id, me);
        me.room = r;
        send(ws, { t: 'joined', room: r.code, id: me.id, hostId: r.hostId, settings: r.settings });
        const host = r.clients.get(r.hostId);
        if (host) send(host.ws, { t: 'peer-join', id: me.id, name: me.name, avatar: me.avatar, tint: me.tint });
        return;
      }

      case 'settings': // host updates the room settings (mode, map...)
        if (room && room.hostId === me.id) room.settings = msg.settings || {};
        return;

      // Joiner -> host: movement, hits, actions
      case 'state':
      case 'hit':
      case 'buy':
      case 'throw':
      case 'say': {
        if (!room || room.hostId === me.id) return;
        const host = room.clients.get(room.hostId);
        if (host) { msg.from = me.id; send(host.ws, msg); }
        return;
      }

      // Anyone -> everyone else: shot visuals (tracers and sounds)
      case 'shot': {
        if (!room) return;
        if (room.hostId !== me.id) msg.id = me.id; // joiners can only send their own shots
        const out = JSON.stringify(msg);
        for (const c of room.clients.values()) if (c !== me) send(c.ws, out);
        return;
      }

      // Host -> everyone (or one player when msg.to is set): snapshots and events
      case 'snap':
      case 'ev': {
        if (!room || room.hostId !== me.id) return;
        if (msg.to) {
          const c = room.clients.get(msg.to);
          if (c) send(c.ws, text);
          return;
        }
        for (const c of room.clients.values()) if (c !== me) send(c.ws, text);
        return;
      }
    }
  });

  ws.on('close', () => {
    clearInterval(heartbeat);
    const r = me.room;
    if (!r) return;
    r.clients.delete(me.id);
    if (r.hostId === me.id) {
      for (const c of r.clients.values()) send(c.ws, { t: 'host-left' });
      rooms.delete(r.code);
      console.log(`room ${r.code} closed (host left)`);
    } else {
      const host = r.clients.get(r.hostId);
      if (host) send(host.ws, { t: 'peer-leave', id: me.id });
    }
  });
});

server.listen(PORT, () => console.log(`Neon Arena running on http://localhost:${PORT}`));
