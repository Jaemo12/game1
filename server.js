// Neon Arena server: serves the game files and relays multiplayer state.
// Movement is client-side (we trust friends); the server owns health, kills and respawns.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { SPAWNS, WEAPONS, MAX_HP, RESPAWN_MS } from './public/map.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || process.argv[2]) || 3000;
const TICK_MS = 50; // 20 snapshots per second
const MAX_PLAYERS = 8;

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
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---------- Rooms ----------
const COLORS = [0x00e5ff, 0xff2bd6, 0xff8a00, 0x7cff4f, 0x8b5cff, 0xffe600, 0xff4f6d, 0x4fa3ff];
const rooms = new Map(); // roomId -> { players: Map<id, player> }
let nextId = 1;

function getRoom(id) {
  if (!rooms.has(id)) rooms.set(id, { players: new Map() });
  return rooms.get(id);
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}
function broadcast(room, msg, exceptId) {
  const data = JSON.stringify(msg);
  for (const p of room.players.values()) {
    if (p.id !== exceptId && p.ws.readyState === 1) p.ws.send(data);
  }
}

function publicInfo(p) {
  return { id: p.id, name: p.name, color: p.color, kills: p.kills, deaths: p.deaths };
}

function pickSpawn(room, selfId) {
  // Spawn point farthest from living enemies.
  let best = SPAWNS[0], bestScore = -1;
  for (const s of SPAWNS) {
    let nearest = Infinity;
    for (const p of room.players.values()) {
      if (p.id === selfId || !p.alive) continue;
      nearest = Math.min(nearest, Math.hypot(p.p[0] - s[0], p.p[2] - s[2]));
    }
    const score = nearest + Math.random() * 6;
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return [...best];
}

function respawn(room, p) {
  p.hp = MAX_HP;
  p.alive = true;
  p.p = pickSpawn(room, p.id);
  p.yaw = Math.atan2(p.p[0], p.p[2]); // face the center
  broadcast(room, { t: 'respawn', id: p.id, p: p.p, yaw: p.yaw });
}

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  let room = null;
  let me = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.t === 'join' && !me) {
      const roomId = String(msg.room || 'lobby').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24) || 'lobby';
      room = getRoom(roomId);
      if (room.players.size >= MAX_PLAYERS) { send(ws, { t: 'full' }); ws.close(); return; }
      const used = new Set([...room.players.values()].map((p) => p.color));
      me = {
        id: nextId++, ws,
        name: String(msg.name || 'Player').replace(/[<>]/g, '').slice(0, 16) || 'Player',
        color: COLORS.find((c) => !used.has(c)) ?? COLORS[0],
        p: [0, 0, 0], yaw: 0, pitch: 0, hp: MAX_HP, alive: true,
        kills: 0, deaths: 0, lastShot: 0,
      };
      room.players.set(me.id, me);
      me.p = pickSpawn(room, me.id);
      me.yaw = Math.atan2(me.p[0], me.p[2]);
      send(ws, {
        t: 'welcome', id: me.id, room: roomId, p: me.p, yaw: me.yaw,
        players: [...room.players.values()].map(publicInfo),
      });
      broadcast(room, { t: 'join', player: publicInfo(me) }, me.id);
      return;
    }
    if (!me) return;

    switch (msg.t) {
      case 'state': {
        if (!me.alive || !Array.isArray(msg.p) || msg.p.length !== 3) return;
        if (!msg.p.every(Number.isFinite)) return;
        me.p = msg.p;
        me.yaw = +msg.yaw || 0;
        me.pitch = +msg.pitch || 0;
        break;
      }
      case 'shot': {
        // Visual-only: tracer for everyone else.
        if (!me.alive) return;
        broadcast(room, { t: 'shot', id: me.id, o: msg.o, e: msg.e }, me.id);
        break;
      }
      case 'hit': {
        // "Favor the shooter": the client tells us what it hit on its screen,
        // we just sanity-check it.
        const w = WEAPONS.rifle;
        const target = room.players.get(msg.target);
        const now = Date.now();
        if (!me.alive || !target || !target.alive || target.id === me.id) return;
        if (now - me.lastShot < w.interval * 0.7) return;
        me.lastShot = now;
        const dist = Math.hypot(target.p[0] - me.p[0], target.p[1] - me.p[1], target.p[2] - me.p[2]);
        if (dist > w.range + 10) return;
        const dmg = msg.head ? w.head : w.body;
        target.hp = Math.max(0, target.hp - dmg);
        broadcast(room, { t: 'damage', target: target.id, by: me.id, hp: target.hp, head: !!msg.head });
        if (target.hp <= 0) {
          target.alive = false;
          target.deaths++;
          me.kills++;
          broadcast(room, {
            t: 'kill', killer: me.id, victim: target.id, head: !!msg.head,
            scores: [...room.players.values()].map(publicInfo),
          });
          setTimeout(() => { if (room.players.has(target.id)) respawn(room, target); }, RESPAWN_MS);
        }
        break;
      }
      case 'ping':
        send(ws, { t: 'pong', ts: msg.ts });
        break;
    }
  });

  ws.on('close', () => {
    if (!me) return;
    room.players.delete(me.id);
    broadcast(room, { t: 'leave', id: me.id });
    for (const [id, r] of rooms) if (r.players.size === 0) rooms.delete(id);
  });
});

// Snapshot loop
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.players.size === 0) continue;
    const players = [...room.players.values()].map((p) => ({
      id: p.id, p: p.p, yaw: p.yaw, pitch: p.pitch, hp: p.hp, alive: p.alive,
    }));
    broadcast(room, { t: 'snap', players });
  }
}, TICK_MS);

server.listen(PORT, () => console.log(`Neon Arena running on http://localhost:${PORT}`));
