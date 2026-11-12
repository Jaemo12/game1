// Neon Arena: single-player (you vs. bots). Multiplayer comes later.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  uTime, trimMaterial, makeSky, makeRain, makeRipples, makeLamp, makeSign, makeHologram,
  makeGradePass, glowSprite, glowTexture,
} from './atmosphere.js';
import { AVATARS, avatarById, buildAvatar } from './avatars.js';
import { buildNav, findPath } from './nav.js';
import { createAudio } from './audio.js';
import { net, connect, send as netSend, waitFor, leave as netLeave } from './net.js';
import {
  setMaxAnisotropy, concrete, asphalt, dockFloor, brick, waves, container, crate, steelPlates, hazard,
  gunmetal, polymer, walnut, boxUV, scifiPanel, lockers, academyFloor,
} from './textures.js';
import { MAPS, mapById, WEAPONS, MAX_HP, RESPAWN_MS, ECONOMY } from './map.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// ---------------------------------------------------------------- settings
const settings = { name: 'Player', sens: 1, bots: 3, difficulty: 'normal', quality: 'low', volume: 0.7, avatar: 'kaze', map: 'yard' };
try { Object.assign(settings, JSON.parse(localStorage.getItem('neon-arena') || '{}')); } catch {}
// Rebindable keys (Settings > Keys). Values are KeyboardEvent.code names.
const DEFAULT_BINDS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', sprint: 'ShiftLeft',
  crouch: 'KeyC', reload: 'KeyR', use: 'KeyE', buy: 'KeyB', lastWeapon: 'KeyQ', scores: 'Tab',
  flash: 'KeyF', smoke: 'KeyG', frag: 'KeyV', ping: 'KeyX', chat: 'KeyT',
};
settings.binds = { ...DEFAULT_BINDS, ...(settings.binds || {}) };
settings.fov ??= 78;
settings.tint ??= '';       // '' = the avatar's own color, else '#rrggbb'
settings.skin ??= 'default'; // gun skin
settings.xhStyle ??= 'crossdot';
settings.xhColor ??= '#ffffff';
// Graphics now default to Low (smoother). Reset older saves that stored High by default.
if (settings.qualityV !== 2) { settings.quality = 'low'; settings.qualityV = 2; }

// The selected map (layout + look). Changing map reloads the page.
const MAP = mapById(settings.map);
function avColor() { return /^#[0-9a-f]{6}$/i.test(settings.tint) ? parseInt(settings.tint.slice(1), 16) : avatarById(settings.avatar).color; }
const tintOf = (t) => (/^#[0-9a-f]{6}$/i.test(t || '') ? parseInt(t.slice(1), 16) : null);
const ENV = MAP.env;
const ARENA = { size: MAP.size, wallHeight: MAP.wallHeight };
const BOXES = MAP.boxes;
const SPAWNS = MAP.spawns;
const saveSettings = () => { try { localStorage.setItem('neon-arena', JSON.stringify(settings)); } catch {} };

const DIFF = {
  easy:   { reaction: 0.9,  accuracy: 0.30, interval: 0.45, dmg: 8,  fov: 0.2 },
  normal: { reaction: 0.55, accuracy: 0.45, interval: 0.32, dmg: 10, fov: 0.0 },
  hard:   { reaction: 0.3,  accuracy: 0.60, interval: 0.22, dmg: 12, fov: -0.3 },
};

// ---------------------------------------------------------------- renderer
// "High" graphics: 4x anti-aliasing, puddle reflections, more rain. "Low" is for weaker laptops.
const HIGH = settings.quality !== 'low';
const DPR = Math.min(devicePixelRatio, HIGH ? 1.5 : 1);
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(DPR);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = HIGH ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = ENV.exposure;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const FOG_COLOR = new THREE.Color().setRGB(...ENV.fog.color);
scene.background = FOG_COLOR.clone();
scene.fog = new THREE.FogExp2(FOG_COLOR, ENV.fog.density);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;
const sky = makeSky(ENV.sky);
scene.add(sky);

let BASE_FOV = settings.fov; // Settings > Field of view
const camera = new THREE.PerspectiveCamera(BASE_FOV, innerWidth / innerHeight, 0.05, 400);
camera.rotation.order = 'YXZ';
scene.add(camera);

// The gun is drawn in its own scene so it never clips into walls.
const gunScene = new THREE.Scene();
const gunCam = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.01, 10);
gunScene.environment = scene.environment;
gunScene.environmentIntensity = 0.5;
// Lighting for the gun in your hands, matched to the dusk scene: warm sun, cool sky fill.
gunScene.add(new THREE.HemisphereLight(0xaab8e0, 0x3a2e28, 1.1));
const gunKey = new THREE.DirectionalLight(0xffd2a8, 1.8);
gunKey.position.set(-1, 2, 1.5);
const gunRim = new THREE.DirectionalLight(0xffb27a, 1.0); // warm sun edge
gunRim.position.set(-2, 0.6, -1);
const gunRim2 = new THREE.DirectionalLight(0x9fb4ff, 0.6); // cool fill
gunRim2.position.set(2, -0.5, -2);
gunScene.add(gunKey, gunRim, gunRim2);

// Post-processing in HDR with multisampling, so edges are smooth and glow looks clean.
const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: HIGH ? 4 : 0 });
const composer = new EffectComposer(renderer, rt);
composer.setPixelRatio(DPR);
composer.setSize(innerWidth, innerHeight);
composer.addPass(new RenderPass(scene, camera));
const gunPass = new RenderPass(gunScene, gunCam);
gunPass.clear = false;
gunPass.clearDepth = true;
composer.addPass(gunPass);
// Gentle glow: only the brightest lights bloom.
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), ENV.bloom, 0.4, 0.9);
if (!HIGH) { // Low: compute the glow at half resolution (4x cheaper, looks almost the same)
  const setBloomSize = bloom.setSize.bind(bloom);
  bloom.setSize = (w, h) => setBloomSize(Math.round(w / 2), Math.round(h / 2));
}
composer.addPass(bloom);
composer.addPass(new OutputPass());
const grade = makeGradePass();
composer.addPass(grade);

// ---------------------------------------------------------------- lights (from the map's env)
scene.add(new THREE.HemisphereLight(ENV.hemi.sky, ENV.hemi.ground, ENV.hemi.intensity));
const sun = new THREE.DirectionalLight(ENV.sun.color, ENV.sun.intensity);
sun.position.set(...ENV.sun.pos);
sun.castShadow = true;
sun.shadow.mapSize.set(HIGH ? 2048 : 1024, HIGH ? 2048 : 1024);
Object.assign(sun.shadow.camera, { left: -48, right: 48, top: 48, bottom: -48, near: 1, far: 160 });
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.03;
scene.add(sun);
let centerLight = null;
if (ENV.centerLight) {
  centerLight = new THREE.PointLight(ENV.centerLight, 14, 16, 2);
  centerLight.position.set(0, 5, 0);
  scene.add(centerLight);
}

// ---------------------------------------------------------------- world
const colliders = [];   // AABBs for movement
const worldMeshes = []; // meshes bullets can hit
const animated = [];    // decorations with an update(t, dt)

// Procedural surface textures (see textures.js). Only the ones this map uses are generated.
setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());
const TEX_MAKERS = {
  concrete: () => concrete({ seed: 1 }),
  wall: () => concrete({ seed: 2, base: [122, 120, 118], seams: true }),
  container, crate, brick,
  steel: () => steelPlates(),
  panel: () => scifiPanel(),
  locker: () => lockers(),
};
const TEX = {};
const getTex = (type) => (TEX[type] ??= TEX_MAKERS[type]());
// How many metres one texture covers, per surface (crates show one texture per face).
const TILE = { concrete: 3, barrier: 2, wall: 6, container: 2.6, steel: 2.5, brick: 3, panel: 3, locker: 2.4 };
const surfaceCache = new Map();
function surface(type, paint) {
  const key = type + ':' + (paint ?? '');
  if (!surfaceCache.has(key)) {
    const t = getTex(type === 'barrier' ? 'concrete' : type);
    surfaceCache.set(key, new THREE.MeshStandardMaterial({
      map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, roughness: 1,
      metalness: { container: 0.45, steel: 0.45, panel: 0.35, locker: 0.55 }[type] ?? 0,
      color: paint ?? ({ container: 0x9a3f2c, brick: 0xa0705e, panel: 0x8a93a8, locker: 0x3f6fae }[type] ?? 0xffffff),
    }));
  }
  return surfaceCache.get(key);
}
let hazardMat = null;
const getHazard = () => (hazardMat ??= new THREE.MeshStandardMaterial({ map: hazard().map, roughness: 0.8 }));

// Ground
const S = ARENA.size / 2, WH = ARENA.wallHeight;
const ground = ENV.floor === 'dock' ? dockFloor() : ENV.floor === 'academy' ? academyFloor() : asphalt();
for (const t of Object.values(ground)) t.repeat.set(4, 4);
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(ARENA.size, ARENA.size),
  new THREE.MeshStandardMaterial({
    ...ground, roughness: 1, metalness: 0, normalScale: new THREE.Vector2(0.6, 0.6), envMapIntensity: ground.emissiveMap ? 0.6 : 0.25,
    emissive: ground.emissiveMap ? 0xffffff : 0x000000, emissiveIntensity: 0.9, // glowing seams (Neon Academy)
  }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
worldMeshes.push(floor);

const neonMat = (c, k) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k) });
const collide = (x, y, z, w, h, d) => colliders.push({ minX: x - w / 2, maxX: x + w / 2, minY: y, maxY: y + h, minZ: z - d / 2, maxZ: z + d / 2 });

// ---------------------------------------------------------------- dressing: buildings, walls, props
// Plain colored materials, cached. glow = emissive color (lit windows, lamps, signs).
const plainCache = new Map();
function plain(color, { rough = 0.8, metal = 0, glow = 0, glowK = 0 } = {}) {
  const key = [color, rough, metal, glow, glowK].join();
  if (!plainCache.has(key)) plainCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive: glow, emissiveIntensity: glowK }));
  return plainCache.get(key);
}
const decoBox = (w, h, d, x, y, z, mat, parent = scene) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
};
let decoSeed = 7;
const drand = () => ((decoSeed = (decoSeed * 16807) % 2147483647) / 2147483647);

// A flat window on a face. (nx,nz) = which way the face points.
function addWindow(cx, cy, cz, nx, nz, lit) {
  const frame = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.4), plain(0x2a2623, { rough: 0.6 }));
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.1), lit ? plain(0x10131a, { rough: 0.2, glow: 0xffc27a, glowK: 0.9 }) : plain(0x10141c, { rough: 0.12, metal: 0.7 }));
  const rot = Math.atan2(nx, nz);
  frame.position.set(cx + nx * 0.015, cy, cz + nz * 0.015);
  glass.position.set(cx + nx * 0.03, cy, cz + nz * 0.03);
  frame.rotation.y = glass.rotation.y = rot;
  scene.add(frame, glass);
  const sill = decoBox(nz ? 1.7 : 0.2, 0.1, nz ? 0.2 : 1.7, cx + nx * 0.1, cy - 0.75, cz + nz * 0.1, plain(0x9a9186));
  sill.castShadow = false;
}

// A building block: roof parapet, rows of windows, a door with an awning, rooftop machinery.
function dressBuilding(b) {
  const { x, z, w, h, d } = b, y = b.y || 0;
  const top = y + h;
  const trim = plain(0x8d8374), dark = plain(0x34312e, { rough: 0.7 });
  for (const [px, pz, pw, pd] of [[0, d / 2, w, 0.35], [0, -d / 2, w, 0.35], [w / 2, 0, 0.35, d], [-w / 2, 0, 0.35, d]]) decoBox(pw + 0.1, 0.6, pd + 0.1, x + px, top + 0.3, z + pz, trim);
  decoBox(w + 0.2, 0.5, d + 0.2, x, y + 0.25, z, dark).castShadow = false; // base plinth
  const rows = h > 3.8 ? [1.7, 3.3] : [1.7];
  let doorDone = false;
  for (const [nx, nz, len] of [[0, 1, w], [0, -1, w], [1, 0, d], [-1, 0, d]]) {
    const count = Math.max(1, Math.floor((len - 1.5) / 3));
    for (let i = 0; i < count; i++) {
      const along = (i - (count - 1) / 2) * 3;
      const px = x + nx * (w / 2) + (nz ? along : 0), pz = z + nz * (d / 2) + (nx ? along : 0);
      const isDoor = !doorDone && h > 3.8 && nz && i === Math.floor(count / 2);
      if (isDoor) {
        doorDone = true;
        const door = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.4), plain(0x4a3a2c, { rough: 0.6 }));
        door.position.set(px, y + 1.2, pz + nz * 0.02); door.rotation.y = Math.atan2(nx, nz); scene.add(door);
        const awn = decoBox(2.8, 0.1, 1.1, px, y + 2.7, pz + nz * 0.55, plain([0xc0503a, 0x3a78b0, 0x3c9a5c, 0xd9a03a][Math.floor(drand() * 4)], { rough: 0.9 }));
        awn.rotation.x = -nz * 0.25;
        addWindow(px, y + 3.5, pz, nx, nz, drand() < 0.4);
      } else for (const r of rows) addWindow(px, y + r + 0.4, pz, nx, nz, drand() < 0.4);
    }
  }
  // rooftop: air-con units, a water tank, an antenna
  const grey = plain(0x9aa0a6, { rough: 0.5, metal: 0.4 });
  const nAc = 1 + Math.floor(drand() * 3);
  for (let i = 0; i < nAc; i++) {
    const ax = x + (drand() - 0.5) * (w - 3), az = z + (drand() - 0.5) * (d - 3);
    decoBox(1.6, 0.9, 1.2, ax, top + 0.45, az, grey);
    const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.05, 14), dark);
    fan.position.set(ax, top + 0.92, az); scene.add(fan);
  }
  if (w * d > 120) { // water tank on legs
    const tx = x + w * 0.25, tz = z - d * 0.2;
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.5, 16), plain(0x6e5a48, { rough: 0.9 }));
    tank.position.set(tx, top + 2.0, tz); tank.castShadow = true; scene.add(tank);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.95, 0.45, 16), dark);
    cap.position.set(tx, top + 3.0, tz); scene.add(cap);
    for (const [lx, lz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) decoBox(0.1, 1.3, 0.1, tx + lx, top + 0.65, tz + lz, dark);
  }
  decoBox(0.08, 2.2, 0.08, x - w * 0.3, top + 1.1, z + d * 0.25, dark);
  decoBox(0.9, 0.06, 0.06, x - w * 0.3, top + 1.9, z + d * 0.25, dark);
}

// Long walls get pilasters, a cap, a base stripe, posters and wall lamps so they read as real structures.
function dressWall(b) {
  const { x, z, w, h, d } = b, y = b.y || 0;
  const alongX = w > d, L = alongX ? w : d, T = alongX ? d : w;
  const trim = plain(0x8d8374), dark = plain(0x3a3632);
  decoBox(alongX ? L + 0.2 : T + 0.4, 0.3, alongX ? T + 0.4 : L + 0.2, x, y + h + 0.15, z, trim); // cap
  for (const s of [-1, 1]) {
    for (let a = 0.6; a < L - 0.3; a += 5) { // pilasters
      if (alongX) decoBox(0.5, h, 0.2, x - L / 2 + a, y + h / 2, z + s * (T / 2 + 0.1), trim);
      else decoBox(0.2, h, 0.5, x + s * (T / 2 + 0.1), y + h / 2, z - L / 2 + a, trim);
    }
    const stripe = alongX ? decoBox(L, 0.45, 0.1, x, y + 0.22, z + s * (T / 2 + 0.04), dark) : decoBox(0.1, 0.45, L, x + s * (T / 2 + 0.04), y + 0.22, z, dark);
    stripe.castShadow = false;
  }
  for (let a = 2.5; a < L - 1.5; a += 5) { // between pilasters: a poster, a lamp or a pipe
    const r = drand();
    const s = drand() < 0.5 ? -1 : 1;
    const px = alongX ? x - L / 2 + a : x + s * (T / 2 + 0.03), pz = alongX ? z + s * (T / 2 + 0.03) : z - L / 2 + a;
    const rot = alongX ? (s > 0 ? 0 : Math.PI) : (s > 0 ? Math.PI / 2 : -Math.PI / 2);
    if (r < 0.35) {
      const col = [0xff2bd6, 0x00e5ff, 0xffb070, 0x7cff4f, 0xf0f0e8][Math.floor(drand() * 5)];
      const poster = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.4), plain(col, { rough: 0.7, glow: col, glowK: 0.25 }));
      poster.position.set(px, y + 2.1, pz); poster.rotation.y = rot; scene.add(poster);
    } else if (r < 0.6) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 0.18), neonMat(0xffc27a, 1.6));
      lamp.position.set(px, y + 3.3, pz); lamp.rotation.y = rot; scene.add(lamp);
    } else if (r < 0.75) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, h, 8), plain(0x6a6f76, { metal: 0.5 }));
      pipe.position.set(px, y + h / 2, pz); scene.add(pipe);
    }
  }
}

// Props: small things that make a space look lived-in. Most block movement (as a box).
const PROP_COLORS = [0xc0503a, 0x3a78b0, 0x3c9a5c, 0xd9a03a, 0xe8e8e0, 0x8a4aa8];
function addProp([kind, px, pz, rot = 0, color]) {
  const col = color ?? PROP_COLORS[Math.floor(drand() * PROP_COLORS.length)];
  const g = new THREE.Group();
  g.position.set(px, 0, pz); g.rotation.y = rot;
  let cw = 1, cd = 1, ch = 1; // collider size (before rotation)
  if (kind === 'barrel') {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.0, 14), plain(col, { rough: 0.5, metal: 0.5 }));
    m.position.y = 0.5; m.castShadow = true; g.add(m);
    for (const yy of [0.25, 0.75]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.435, 0.435, 0.05, 14), plain(0x222222, { metal: 0.6 })); r.position.y = yy; g.add(r); }
    cw = cd = 0.9; ch = 1;
  } else if (kind === 'car') {
    decoBox(4.2, 0.7, 1.9, 0, 0.62, 0, plain(col, { rough: 0.35, metal: 0.5 }), g);
    decoBox(2.3, 0.7, 1.7, -0.2, 1.3, 0, plain(0x10141c, { rough: 0.1, metal: 0.7 }), g);
    decoBox(2.0, 0.06, 1.5, -0.2, 1.67, 0, plain(col, { rough: 0.35, metal: 0.5 }), g);
    decoBox(0.12, 0.2, 1.6, 2.1, 0.55, 0, neonMat(0xfff2c8, 1.2), g);
    decoBox(0.12, 0.2, 1.6, -2.1, 0.55, 0, neonMat(0xff3a2a, 1.0), g);
    for (const wx of [-1.4, 1.4]) for (const wz of [-0.95, 0.95]) {
      const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.25, 14), plain(0x18181a, { rough: 0.9 }));
      wh.rotation.x = Math.PI / 2; wh.position.set(wx, 0.36, wz); g.add(wh);
    }
    cw = 4.2; cd = 1.9; ch = 1.35;
  } else if (kind === 'planter') {
    decoBox(1.6, 0.55, 1.6, 0, 0.275, 0, plain(0x8d8374), g);
    decoBox(1.4, 0.06, 1.4, 0, 0.56, 0, plain(0x3a2a1c), g);
    decoBox(0.18, 1.4, 0.18, 0, 1.2, 0, plain(0x5a3f2a), g);
    for (const [ox, oy, oz, r] of [[0, 2.4, 0, 1.0], [0.5, 2.0, 0.2, 0.7], [-0.45, 2.1, -0.2, 0.75]]) {
      const f = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), plain(0x3f8a4c, { rough: 0.95 }));
      f.position.set(ox, oy, oz); f.castShadow = true; g.add(f);
    }
    cw = cd = 1.6; ch = 0.55;
  } else if (kind === 'vending') {
    decoBox(1.0, 2.0, 0.8, 0, 1.0, 0, plain(col, { rough: 0.4, metal: 0.3 }), g);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 1.3), plain(0x101820, { glow: 0x7fd8ff, glowK: 0.8 }));
    face.position.set(0, 1.15, 0.405); g.add(face);
    cw = 1; cd = 0.8; ch = 2;
  } else if (kind === 'bench') {
    decoBox(1.8, 0.08, 0.5, 0, 0.5, 0, plain(0x7a5a3a), g);
    decoBox(1.8, 0.4, 0.06, 0, 0.8, -0.22, plain(0x7a5a3a), g);
    for (const lx of [-0.8, 0.8]) decoBox(0.08, 0.5, 0.45, lx, 0.25, 0, plain(0x2a2a2e, { metal: 0.5 }), g);
    cw = 1.8; cd = 0.5; ch = 0.9;
  } else if (kind === 'post') { // street lamp: pole + glowing head, no collision
    decoBox(0.14, 4.6, 0.14, 0, 2.3, 0, plain(0x2a2a2e, { metal: 0.5 }), g);
    decoBox(0.9, 0.1, 0.3, 0.3, 4.65, 0, plain(0x2a2a2e), g);
    decoBox(0.5, 0.08, 0.24, 0.45, 4.58, 0, neonMat(0xffc27a, 1.8), g);
    cw = 0;
  }
  g.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
  scene.add(g);
  const sideways = Math.abs(Math.sin(rot)) > 0.7;
  if (cw) collide(px, 0, pz, sideways ? cd : cw, ch, sideways ? cw : cd);
}

function addBox(b, type = b.t || 'concrete', paint = b.p) {
  const { x, z, w, h, d } = b;
  const y = b.y || 0;
  const geo = new THREE.BoxGeometry(w, h, d);
  if (type !== 'crate') boxUV(geo, w, h, d, TILE[type]);
  const m = new THREE.Mesh(geo, surface(type, paint));
  m.position.set(x, y + h / 2, z);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
  worldMeshes.push(m);
  collide(x, y, z, w, h, d);

  if (type === 'barrier') { // yellow/black hazard band on both long sides
    const long = w > d;
    const sw = long ? w * 0.98 : w + 0.012, sd = long ? d + 0.012 : d * 0.98;
    const sg = boxUV(new THREE.BoxGeometry(sw, 0.2, sd), sw, 0.2, sd, 0.6);
    const stripe = new THREE.Mesh(sg, getHazard());
    stripe.position.set(x, y + h - 0.25, z);
    scene.add(stripe);
  }
  if ((type === 'concrete' || type === 'panel') && h > 0.9 && b.c) { // a thin neon accent line near the top
    const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.035, d + 0.02), neonMat(b.c, 1.2));
    band.position.set(x, y + h - 0.3, z);
    scene.add(band);
  }
  if (type === 'container') { // corner posts
    const frame = surface('steel', 0x2b2d31);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, h + 0.01, 0.16), frame);
      post.position.set(x + sx * (w / 2 - 0.07), y + h / 2, z + sz * (d / 2 - 0.07));
      scene.add(post);
    }
  }
  if (type === 'brick' && h > 4 && !b.outer) { // roof ledge + a row of windows on tall buildings
    const ledge = new THREE.Mesh(boxUV(new THREE.BoxGeometry(w + 0.3, 0.25, d + 0.3), w + 0.3, 0.25, d + 0.3, 3), surface('concrete'));
    ledge.position.set(x, y + h, z);
    scene.add(ledge);
    const winMat = new THREE.MeshStandardMaterial({ color: 0x0c0e14, roughness: 0.15, metalness: 0.6, emissive: 0xffc070, emissiveIntensity: 0.0 });
    const litMat = new THREE.MeshStandardMaterial({ color: 0x0c0e14, roughness: 0.15, metalness: 0.6, emissive: 0xffc890, emissiveIntensity: 0.6 });
    for (const [nx, nz, len] of [[0, 1, w], [0, -1, w], [1, 0, d], [-1, 0, d]]) {
      const count = Math.floor(len / 2.2);
      for (let i = 0; i < count; i++) {
        const along = -len / 2 + 1.1 + i * (len - 2.2) / Math.max(1, count - 1);
        const win = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.3), Math.random() < 0.35 ? litMat : winMat);
        win.position.set(x + nx * (w / 2 + 0.02) + (nz ? along : 0), y + h - 1.6, z + nz * (d / 2 + 0.02) + (nx ? along : 0));
        win.rotation.y = Math.atan2(nx, nz);
        scene.add(win);
      }
    }
  }
  if (b.bld) dressBuilding(b);
  if (b.wd) dressWall(b);
  return m;
}
BOXES.forEach((b) => addBox(b));
(MAP.props || []).forEach(addProp);

// Outer walls (or a waterfront railing on an open side)
const WALLS = { N: [0, -S - 0.5, ARENA.size + 2, 1], S: [0, S + 0.5, ARENA.size + 2, 1], W: [-S - 0.5, 0, 1, ARENA.size], E: [S + 0.5, 0, 1, ARENA.size] };
let water = null;
for (const [side, [x, z, w, d]] of Object.entries(WALLS)) {
  if (side === ENV.openSide) {
    collide(x, 0, z, w, WH + 20, d); // invisible: keeps everyone on the dock
    const rail = surface('steel', 0xd8b21c);
    for (let px = -S; px <= S; px += 2) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.1, 0.08), rail);
      post.position.set(px, 0.55, S - 0.2);
      scene.add(post);
    }
    for (const ry of [0.55, 1.05]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(ARENA.size, 0.06, 0.06), rail);
      bar.position.set(0, ry, S - 0.2);
      scene.add(bar);
    }
    const edge = new THREE.Mesh(boxUV(new THREE.BoxGeometry(ARENA.size + 2, 2, 1), ARENA.size + 2, 2, 1, 3), surface('concrete'));
    edge.position.set(0, -1, S + 0.5); // dock edge dropping into the water
    scene.add(edge);
    const wn = waves().normalMap;
    wn.repeat.set(40, 20);
    water = new THREE.Mesh(new THREE.PlaneGeometry(600, 300), new THREE.MeshStandardMaterial({
      color: 0x1f4f6a, roughness: 0.12, metalness: 0.2, normalMap: wn, normalScale: new THREE.Vector2(0.5, 0.5),
    }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, -0.9, S + 150);
    scene.add(water);
    continue;
  }
  addBox({ x, y: 0, z, w, h: WH, d, outer: true }, ENV.wall);
  if (ENV.wallLight) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.05, d + 0.02), neonMat(ENV.wallLight, 1.3));
    strip.position.set(x, WH - 0.5, z);
    scene.add(strip);
  }
}

// Street lamps
for (const [x, z, c] of ENV.lamps) {
  const lamp = makeLamp(x, z, c);
  scene.add(lamp.group, lamp.light);
  colliders.push(lamp.collider);
  worldMeshes.push(lamp.pole);
}

// Neon signs: on the outer walls, and on building faces
for (const [text, color, wall, along, width] of ENV.wallSigns) {
  const sign = makeSign(text, color, width);
  const inset = S - 0.04;
  if (wall === 'N') { sign.position.set(along, 4.6, -inset); }
  if (wall === 'S') { sign.position.set(along, 4.6, inset); sign.rotation.y = Math.PI; }
  if (wall === 'E') { sign.position.set(inset, 4.6, along); sign.rotation.y = -Math.PI / 2; }
  if (wall === 'W') { sign.position.set(-inset, 4.6, along); sign.rotation.y = Math.PI / 2; }
  scene.add(sign);
  animated.push(sign);
}
for (const [text, color, x, y, z, rotY, width] of ENV.signs || []) {
  const sign = makeSign(text, color, width);
  sign.position.set(x, y, z);
  sign.rotation.y = rotY;
  scene.add(sign);
  animated.push(sign);
}

// Hologram above the center
if (ENV.hologram) {
  const hologram = makeHologram();
  scene.add(hologram);
  animated.push(hologram);
}

// Weather
let rain = null, ripples = null;
if (ENV.rain) {
  rain = makeRain(HIGH ? 2500 : 1000, ENV.rainColor);
  ripples = makeRipples(HIGH ? 200 : 90);
  scene.add(rain, ripples);
}

// Harbor cranes out over the water
if (ENV.cranes) {
  const paint = surface('steel', 0xd08a1c);
  const beam = (w, h, d, x, y, z) => {
    const m = new THREE.Mesh(boxUV(new THREE.BoxGeometry(w, h, d), w, h, d, 2.5), paint);
    m.position.set(x, y, z); m.castShadow = true; scene.add(m);
  };
  for (const cx of [-20, 18]) {
    const cz = S + 22;
    for (const sx of [-5, 5]) for (const sz of [-4, 4]) beam(1, 26, 1, cx + sx, 12, cz + sz); // legs
    beam(12, 1.2, 1.2, cx, 24, cz - 4); beam(12, 1.2, 1.2, cx, 24, cz + 4);                    // cross beams
    beam(2.4, 1.6, 60, cx, 26, cz - 6);                                                      // boom over the dock
    beam(4, 3, 4, cx, 28, cz);                                                               // cab
  }
}

// Backdrop: a city skyline with windows (and blinking aviation lights at night)
(function backdrop() {
  const sk = ENV.skyline;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 64, 128);
  const palette = sk.neon ? ['#ff7bd8', '#6bd8ff', '#ffcf8a'] : ['#ffcf8a', '#ffe2b0', '#9fd0ff'];
  for (let y = 4; y < 128; y += 8) for (let x = 4; x < 64; x += 8) {
    if (Math.random() < 0.35) { g.fillStyle = palette[Math.floor(Math.random() * 3)]; g.fillRect(x, y, 4, 4); }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 5);
  const beacons = [];
  for (let i = 0; i < 70; i++) {
    const a = Math.random() * Math.PI * 2, r = rand(50, 120);
    if (ENV.openSide === 'S' && Math.sin(a) > 0.35) continue; // keep the sea view open
    const w = rand(6, 14), h = rand(12, 75), d = rand(6, 14);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), trimMaterial({
      half: new THREE.Vector3(w / 2, h / 2, d / 2), trim: sk.neon ? [0x00e5ff, 0xff2bd6, 0x8b5cff][i % 3] : 0x9fb4ff,
      intensity: sk.neon ? 0.6 : 0.12, width: 0.2, band: false,
      color: sk.color, roughness: 0.8, emissiveMap: tex, emissiveIntensity: sk.windows,
    }));
    m.position.set(Math.cos(a) * r, h / 2 - 2, Math.sin(a) * r);
    scene.add(m);
    if (sk.beacons && h > 45) {
      const b = glowSprite(0xff2040, 2.2, 1.5);
      b.position.set(m.position.x, h - 1.5, m.position.z);
      b.userData.phase = Math.random() * 6;
      scene.add(b);
      beacons.push(b);
    }
  }
  if (beacons.length) animated.push({ userData: { update: (t) => {
    for (const b of beacons) b.material.opacity = Math.sin(t * 2 + b.userData.phase) > 0.6 ? 1 : 0.05;
  } } });
})();

// Bot navigation grid for this map (see nav.js)
const nav = buildNav(colliders, ARENA.size);

function updateAtmosphere(dt) {
  uTime.value += dt;
  const t = uTime.value;
  sky.position.copy(camera.position);
  if (rain) { rain.userData.update(camera); ripples.userData.update(camera); }
  for (const a of animated) a.userData.update(t, dt);
  if (centerLight) centerLight.intensity = 14 + Math.sin(t * 1.7) * 3;
  if (water) water.material.normalMap.offset.set(t * 0.01, t * 0.006);
}

function onResize() {
  for (const c of [camera, gunCam]) { c.aspect = innerWidth / innerHeight; c.updateProjectionMatrix(); }
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  grade.uniforms.uRes.value.set(innerWidth * DPR, innerHeight * DPR);
}
addEventListener('resize', onResize);
onResize();

// ---------------------------------------------------------------- physics
const R = 0.35, H = 1.75, EYE = 1.6, GRAV = 24, JUMP = 8.2;

// h = body height (shorter while crouching or sliding)
function hitBox(p, h = H) {
  for (const b of colliders) {
    if (p.x + R > b.minX && p.x - R < b.maxX && p.z + R > b.minZ && p.z - R < b.maxZ && p.y + h > b.minY && p.y < b.maxY) return b;
  }
  return null;
}

function moveBody(e, dt) {
  const p = e.pos, v = e.vel, h = e.height || H;
  let blocked = false, b;
  p.x += v.x * dt;
  if ((b = hitBox(p, h))) { p.x = v.x > 0 ? b.minX - R - 1e-3 : b.maxX + R + 1e-3; v.x = 0; blocked = true; }
  p.z += v.z * dt;
  if ((b = hitBox(p, h))) { p.z = v.z > 0 ? b.minZ - R - 1e-3 : b.maxZ + R + 1e-3; v.z = 0; blocked = true; }
  v.y -= GRAV * dt;
  p.y += v.y * dt;
  e.grounded = false;
  if ((b = hitBox(p, h))) {
    if (v.y < 0) { p.y = b.maxY; e.grounded = true; } else p.y = b.minY - h - 1e-3;
    v.y = 0;
  }
  if (p.y < 0) { p.y = 0; v.y = 0; e.grounded = true; }
  return blocked;
}

function randomPoint() {
  const p = new THREE.Vector3();
  for (let i = 0; i < 40; i++) {
    p.set(rand(-S + 2, S - 2), 0, rand(-S + 2, S - 2));
    if (!hitBox(p)) return p;
  }
  return p.set(0, 0, -20);
}

// ---------------------------------------------------------------- characters
function nameSprite(name, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 30px Segoe UI, system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = '#' + new THREE.Color(color).getHexString(); g.shadowBlur = 10;
  g.fillStyle = '#ffffff';
  g.fillText(name, 128, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, opacity: 0.85 }));
  s.scale.set(1.6, 0.4, 1);
  s.position.y = 2.35;
  return s;
}

function makeCharacter(color, name, avatarId) {
  const av = buildAvatar(avatarId, color);
  av.group.add(nameSprite(name, color));
  scene.add(av.group);
  return { group: av.group, body: av.hitBody, head: av.hitHead, model: av, gunMesh: av.gunMesh, gunStrip: av.gunStrip };
}

// ---------------------------------------------------------------- entities & game modes
const MODES = {
  ffa: { name: 'Free-for-all', teams: false, killLimit: 20, desc: 'Everyone for themselves. First to 20 kills wins.' },
  tdm: { name: 'Team Deathmatch', teams: true, killLimit: 30, timeLimit: 360, desc: 'Blue vs Red. First team to 30 kills (6 min max).' },
  demo: {
    name: 'Demolition', teams: true, rounds: true, winRounds: 4, halftime: 3,
    freeze: 4, roundTime: 100, fuse: 40, plantTime: 3.5, defuseTime: 6, roundEndTime: 4.5,
    desc: 'Attackers plant the charge at A or B, defenders stop or defuse it. No respawns. First to 4 rounds.',
  },
};
const TEAMS = { blue: { name: 'BLUE', color: 0x4fa3ff }, red: { name: 'RED', color: 0xff5a4f } };
const otherTeam = (t) => (t === 'blue' ? 'red' : 'blue');
let mode = 'ffa', M = MODES.ffa;
// Match state. In Demolition, `score` counts rounds won; otherwise team kills.
const match = { over: false, score: { blue: 0, red: 0 }, endsAt: Infinity, round: 0, attack: 'blue', phase: 'live', phaseEnds: 0, plan: 'A' };

const player = {
  id: 'me', name: settings.name, color: avColor(), isPlayer: true, team: null, busy: false,
  pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0,
  hp: MAX_HP, alive: true, grounded: false, kills: 0, deaths: 0, streak: 0, respawnAt: 0, killedBy: null,
};
const BOT_NAMES = ['Viper', 'Nova', 'Rook', 'Echo', 'Blitz', 'Ghost', 'Jinx', 'Raven'];
const BOT_COLORS = [0xff2bd6, 0xff8a00, 0x7cff4f, 0x8b5cff, 0xffe600, 0xff4f6d, 0x4fa3ff];
let bots = [];
let ents = [player];

// Bots use the avatars you did not pick first, then repeat with other names and colors.
// In team modes everyone is tinted in their team color.
function makeBot(i, team) {
  const order = [...AVATARS.filter((a) => a.id !== settings.avatar), avatarById(settings.avatar)];
  const av = order[i % order.length];
  const unique = i < order.length && av.id !== settings.avatar;
  const color = team ? TEAMS[team].color : unique ? av.color : BOT_COLORS[i % BOT_COLORS.length];
  const name = unique ? av.name : BOT_NAMES[i % BOT_NAMES.length];
  const model = makeCharacter(color, name, av.id);
  const b = {
    id: 'b' + i, persona: PERSONA_ORDER[i % PERSONA_ORDER.length], avatar: av.id, name, color, team, isPlayer: false, ...model,
    pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0,
    hp: MAX_HP, alive: true, grounded: false, kills: 0, deaths: 0, respawnAt: 0, flash: 0, busy: false,
    ai: { target: null, aggro: null, aggroT: 0, react: 0, nextShot: 0, scan: 0, goal: null,
      strafe: 1, strafeT: 0, stuckT: 0, lastPos: new THREE.Vector3(),
      path: [], pathIdx: 0, pathGoal: null, repathAt: 0, hold: null, holdAt: 0 },
  };
  b.body.userData.ent = b;
  b.head.userData.ent = b;
  return b;
}

// Spawn points: free-for-all uses the map spawns; team modes use each team's side
// (in Demolition: attackers on side a, defenders on side b).
function spawnList(e) {
  if (!M.teams) return SPAWNS;
  const sideA = mode === 'demo' ? e.team === match.attack : e.team === 'blue';
  return MAP.teamSpawns[sideA ? 'a' : 'b'];
}

function pickSpawn(self) {
  const list = spawnList(self);
  let best = list[0], bestScore = -1;
  for (const s of list) {
    let nearest = 99;
    for (const e of ents) {
      if (e === self || !e.alive) continue;
      nearest = Math.min(nearest, Math.hypot(e.pos.x - s[0], e.pos.z - s[2]));
    }
    const score = nearest + Math.random() * 6;
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return best;
}

function respawn(e) {
  if (!economyOn()) e.nades = { flash: 1, smoke: 1, frag: 1 }; // every life starts with one of each
  const s = pickSpawn(e);
  e.pos.set(s[0], s[1], s[2]);
  e.vel.set(0, 0, 0);
  e.yaw = Math.atan2(s[0], s[2]); // face the middle
  e.hp = MAX_HP;
  e.alive = true;
  e.busy = false;
  if (e.isPlayer) {
    e.pitch = 0;
    resetLocalPlayer();
  } else if (e.human) {
    // Another person (multiplayer): tell their game where they spawned.
    e.group.visible = true;
    snapPose(e, e.pos.x, e.pos.y, e.pos.z, e.yaw);
    hostEv({ to: e.id, k: 'respawn', p: [e.pos.x, e.pos.y, e.pos.z], yaw: e.yaw });
  } else {
    // Bots pick a weapon each life (weights in BOT_LOADOUT).
    let r = Math.random(), pick = 'rifle';
    for (const [id, w] of (PERSONAS[e.persona] || PERSONAS.balanced).loadout) { if (r < w) { pick = id; break; } r -= w; }
    setEntWeapon(e, economyOn() ? bestOwned(e) : pick);
    e.group.visible = true;
    Object.assign(e.ai, { target: null, aggro: null, goal: null, react: 0, path: [], pathGoal: null, hold: null });
    e.ai.lastPos.copy(e.pos);
  }
}

function resetLocalPlayer() {
  refillAmmo();
  Object.assign(stance, { crouch: 0, sliding: false, slideT: 0, sprinting: false, sprint: 0 });
  player.height = H;
  player.crouching = false;
  player.busy = false;
  gun.zoom = 0;
  equip(owns(player, W.id) ? W.id : bestOwned(player), true);
  $('death').style.display = 'none';
  updateHud();
}

function setupMatch() {
  mode = MODES[settings.mode] ? settings.mode : 'ffa';
  M = MODES[mode];
  for (const b of bots) scene.remove(b.group);
  player.team = M.teams ? 'blue' : null;
  player.color = M.teams ? TEAMS.blue.color : avColor();
  // People in the room (multiplayer) alternate red/blue; bots then fill whichever team is smaller.
  bots = [];
  let alt = 'red';
  for (const h of humans.values()) {
    const team = M.teams ? alt : null;
    alt = otherTeam(alt);
    const av = avatarById(h.avatar);
    bots.push(makeRemote({ id: h.id, name: h.name, avatar: av.id, color: team ? TEAMS[team].color : h.tint ?? av.color, team, human: true }));
  }
  for (let i = 0; i < settings.bots; i++) bots.push(makeBot(i, M.teams ? smallerTeam([player, ...bots]) : null));
  ents = [player, ...bots];
  hostEv({ k: 'reset' });
  if (isHost()) netSend({ t: 'settings', settings: { map: MAP.id, mode } });
  for (const e of ents) { e.kills = 0; e.deaths = 0; e.heads = 0; e.dmg = 0; e.alive = false; }
  player.streak = 0; player.shots = 0; player.hits = 0;
  Object.assign(match, {
    over: false, score: { blue: 0, red: 0 }, endsAt: M.timeLimit ? time + M.timeLimit : Infinity,
    round: 0, attack: 'blue', phase: 'live', phaseEnds: 0, buyEnds: 0,
  });
  for (const e of ents) resetEconomy(e);
  for (const p of pickups) p.readyAt = 0;
  $('endscreen').style.display = 'none';
  $('feed').innerHTML = '';
  setupModeVisuals();
  if (M.rounds) startRound();
  else for (const e of ents) respawn(e);
  renderScores();
}

// ---------------------------------------------------------------- combat
const raycaster = new THREE.Raycaster();
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
const areEnemies = (a, b) => a !== b && (!M.teams || a.team !== b.team);

function canSee(from, to) {
  const a = tmpV.set(from.pos.x, from.pos.y + EYE, from.pos.z);
  const b = tmpV2.set(to.pos.x, to.pos.y + 1.2, to.pos.z);
  if (smokes.length && smokeBlocks(a, b)) return false;
  const dist = a.distanceTo(b);
  raycaster.set(a, b.sub(a).normalize());
  raycaster.far = dist;
  return raycaster.intersectObjects(worldMeshes, false).length === 0;
}

// attacker can be null (e.g. the Demolition explosion).
function damage(target, attacker, amount, head, weapon) {
  if (!target.alive || match.over) return;
  if (attacker && attacker !== target && M.teams && attacker.team === target.team) return; // no friendly fire
  if (target.armor > 0 && amount > 0) { // armor soaks up part of each hit
    const absorb = Math.min(target.armor, amount * 0.45);
    target.armor -= absorb;
    amount -= absorb;
  }
  const hpBefore = target.hp;
  target.hp = Math.max(0, target.hp - amount);
  if (attacker && attacker !== target) attacker.dmg = (attacker.dmg || 0) + (hpBefore - target.hp);
  if (attacker && attacker !== target) {
    if (target.isPlayer) showHurt(attacker.pos.x, attacker.pos.z);
    else if (target.human) hostEv({ to: target.id, k: 'hurt', x: attacker.pos.x, z: attacker.pos.z });
  }
  if (target.isPlayer) {
    flash($('vignette'), 0.9);
    updateHud();
  } else if (attacker) {
    target.flash = 0.1;
    target.ai.aggro = attacker;
    target.ai.aggroT = 4;
    if (target.ai.target !== attacker) {
      target.ai.target = attacker;
      target.ai.react = DIFF[settings.difficulty].reaction * 0.6;
    }
  }
  if (target.hp <= 0) kill(target, attacker, head, weapon);
}

function kill(victim, killer, head, weapon) {
  victim.alive = false;
  victim.busy = false;
  victim.deaths++;
  if (killer && killer !== victim) { killer.kills++; if (head) killer.heads = (killer.heads || 0) + 1; }
  if (M.teams && !M.rounds && killer && killer !== victim && killer.team !== victim.team) match.score[killer.team]++;
  victim.respawnAt = M.rounds ? Infinity : time + RESPAWN_MS / 1000; // no respawns within a Demolition round
  if (economyOn()) {
    victim.diedInRound = true; // loses bought weapons next round
    if (killer && areEnemies(killer, victim)) pay(killer, ECONOMY.kill);
  }
  if (charge.state === 'carried' && charge.carrier === victim) dropCharge();
  killFx(victim, killer, head, weapon);
  hostEv({ k: 'kill', v: victim.id, by: idOf(killer), h: head ? 1 : 0, w: weapon?.id || null });
  checkWin();
}

// What everyone sees when someone dies (also used by joiners, from the host's kill event).
function killFx(victim, killer, head, weapon) {
  burst(victim.pos.clone().setY(victim.pos.y + 1), victim.color, 40, 0.12);
  addFeed(killer, victim, head, weapon);
  if (victim.isPlayer) {
    victim.killedBy = killer;
    gun.ads = false;
    $('death').style.display = 'flex';
    $('death').classList.toggle('spectating', !!M.rounds);
    $('deathBy').innerHTML = killer
      ? `by <b style="color:${hex(killer.color)}">${killer.name}</b>${weapon ? ` · ${weapon.name}` : ''}` : '';
    sfx.blip(180, 0.4, 0.25, 'sawtooth');
  } else {
    victim.group.visible = false;
  }
  if (victim === player) player.streak = 0;
  if (killer === player) {
    player.streak++;
    const STREAKS = { 3: 'ON FIRE', 5: 'UNSTOPPABLE', 8: 'GODLIKE', 12: 'LEGENDARY' };
    const s = STREAKS[player.streak];
    centerMsg(s ? `${player.streak} KILL STREAK · ${s}` : `${head ? 'HEADSHOT · ' : ''}ELIMINATED ${victim.name.toUpperCase()}`);
    sfx.blip(880, 0.08, 0.2); setTimeout(() => sfx.blip(1320, 0.12, 0.2), 70);
  }
  renderScores();
}

function checkWin() {
  if (match.over) return;
  if (mode === 'ffa') {
    const top = ents.find((e) => e.kills >= M.killLimit);
    if (top) endMatch({ winner: top });
  } else if (mode === 'tdm') {
    for (const t of ['blue', 'red']) if (match.score[t] >= M.killLimit) return endMatch({ team: t });
  }
}

// ---------------------------------------------------------------- effects
const fx = [];
const tracerGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 6, 1, true);
tracerGeo.translate(0, 0.5, 0);
const UP = new THREE.Vector3(0, 1, 0);

function tracer(a, b, color, width = 1, life = 0.07) {
  const dir = tmpV.copy(b).sub(a);
  const len = dir.length();
  const m = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({
    color: new THREE.Color(color).multiplyScalar(3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  m.position.copy(a);
  m.quaternion.setFromUnitVectors(UP, dir.normalize());
  m.scale.set(width, len, width);
  scene.add(m);
  fx.push({ obj: m, life, max: life, kind: 'fade' });
}

const partGeo = new THREE.BoxGeometry(1, 1, 1);
const partMats = new Map();
function burst(at, color, n = 8, size = 0.05) {
  if (!partMats.has(color)) partMats.set(color, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(3) }));
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(partGeo, partMats.get(color));
    m.position.copy(at);
    m.scale.setScalar(size * rand(0.6, 1.4));
    scene.add(m);
    const sp = size > 0.08 ? 6 : 4;
    fx.push({ obj: m, kind: 'part', life: rand(0.3, 0.7), max: 0.7, s: m.scale.x,
      v: new THREE.Vector3(rand(-1, 1), rand(0.2, 1.5), rand(-1, 1)).multiplyScalar(sp) });
  }
}

// Glowing scorch mark where a bullet hits a surface; fades out over a few seconds.
const decalGeo = new THREE.PlaneGeometry(0.3, 0.3);
let decalCount = 0;
function decal(hit, color) {
  if (!hit.face || decalCount > 80) return;
  const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
  const m = new THREE.Mesh(decalGeo, new THREE.MeshBasicMaterial({
    map: glowTexture(), color: new THREE.Color(color).multiplyScalar(2.2), transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4,
  }));
  m.position.copy(hit.point).addScaledVector(n, 0.01);
  m.lookAt(m.position.clone().add(n));
  m.rotation.z = Math.random() * Math.PI;
  m.scale.setScalar(rand(0.7, 1.2));
  scene.add(m);
  decalCount++;
  fx.push({ obj: m, kind: 'fade', life: 4, max: 4, decal: true });
}

function updateFx(dt) {
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i];
    f.life -= dt;
    if (f.kind === 'fade') f.obj.material.opacity = f.decal ? Math.min(1, f.life / 1.5) : Math.max(0, f.life / f.max);
    else if (f.kind === 'light') f.obj.intensity = f.peak * Math.max(0, f.life / f.max) ** 2;
    else {
      f.v.y -= 12 * dt;
      f.obj.position.addScaledVector(f.v, dt);
      if (f.obj.position.y < 0.02) { f.obj.position.y = 0.02; f.v.multiplyScalar(0.5); f.v.y = Math.abs(f.v.y) * 0.3; }
      f.obj.scale.setScalar(f.s * Math.max(0, f.life / f.max));
    }
    if (f.life <= 0) {
      scene.remove(f.obj);
      if (f.kind === 'fade') f.obj.material.dispose();
      if (f.decal) decalCount--;
      fx.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------- sound
const sfx = createAudio(() => settings.volume); // see audio.js

// Where a sound is relative to you: louder when close, panned left/right, muffled when far.
function hear(pos, range = 60) {
  const dx = pos.x - player.pos.x, dz = pos.z - player.pos.z;
  const d = Math.hypot(dx, dz);
  const right = (Math.cos(player.yaw) * dx - Math.sin(player.yaw) * dz) / (d || 1);
  return { vol: clamp(1 - d / range, 0, 1), pan: right * Math.min(1, d / 4) * 0.85, far: clamp(d / range, 0, 1) };
}

// Footsteps for everyone: one step every ~2.2 m of walking. Crouch-walking is silent.
function footsteps(dt) {
  for (const e of ents) {
    if (!e.alive) { e.stepAcc = 0; continue; }
    const speed = Math.hypot(e.vel.x, e.vel.z);
    const sliding = e === player && stance.sliding;
    if (!e.grounded || sliding || e.crouching || speed < 1.5) continue;
    e.stepAcc = (e.stepAcc || 0) + speed * dt;
    const sprint = speed > 7.8;
    if (e.stepAcc < (sprint ? 2.6 : 2.2)) continue;
    e.stepAcc = 0;
    if (e === player) sfx.step({ vol: sprint ? 0.45 : 0.32, kind: sprint ? 'sprint' : 'walk' });
    else {
      const h = hear(e.pos, 32);
      if (h.vol > 0) sfx.step({ vol: h.vol * (sprint ? 1.1 : 0.85), pan: h.pan, far: h.far, kind: sprint ? 'sprint' : 'walk' });
    }
  }
}

// ---------------------------------------------------------------- weapons & viewmodel
const WEAPON_LIST = Object.values(WEAPONS).sort((a, b) => a.slot - b.slot);
let W = WEAPONS.rifle;
let prevWeapon = 'shotgun';

const vm = new THREE.Group();
gunScene.add(vm);
const VM_BASE = new THREE.Vector3(0.17, -0.16, -0.36);
const VM_ADS = new THREE.Vector3(0, -0.105, -0.3);
vm.scale.setScalar(0.62);

// Gun materials: textured gunmetal, polished steel, stippled polymer and walnut wood.
const GT = {
  metal: gunmetal(),
  steel: gunmetal({ seed: 22, base: [178, 181, 188] }),
  poly: polymer(),
  wood: walnut(),
};
const gmat = (t, opts) => new THREE.MeshStandardMaterial({
  map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, roughness: 1, ...opts,
});
const vmMetal = gmat(GT.metal, { metalness: 0.85 });
const vmDark = gmat(GT.metal, { metalness: 0.8, color: 0x707070 });
const vmSteel = gmat(GT.steel, { metalness: 1 });
const vmPoly = gmat(GT.poly, { metalness: 0.05 });
const vmWood = gmat(GT.wood, { metalness: 0 });
const vmShell = new THREE.MeshStandardMaterial({ color: 0xa8231f, roughness: 0.5 });
const vmBrass = new THREE.MeshStandardMaterial({ color: 0xc9a14a, roughness: 0.3, metalness: 1 });
const vmGlass = new THREE.MeshStandardMaterial({ color: 0x1a1030, roughness: 0.05, metalness: 1 });
// Small accent lights (sights, a thin stripe) so each gun keeps its color identity.
const glowMat = (c, k = 1) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k) });

// Box part with texture scaled to its real size (so it doesn't stretch).
function part(g, w, h, d, x, y, z, mat = vmMetal, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(boxUV(new THREE.BoxGeometry(w, h, d), w, h, d, 0.12), mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz); g.add(m); return m;
}
// Tube along the gun's length (z). rFront lets it taper towards the muzzle.
function tube(g, r, len, x, y, z, mat = vmMetal, rFront = r, seg = 16) {
  // After rotating -90° about X, the cylinder's top end points forward (-z), so the top radius is the front.
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rFront, r, len, seg), mat);
  m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); g.add(m); return m;
}
function dot(g, r, x, y, z, mat) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat);
  m.position.set(x, y, z); g.add(m); return m;
}
// Picatinny rail: a base strip with teeth.
function rail(g, len, x, y, z, mat = vmDark) {
  part(g, 0.036, 0.008, len, x, y, z, mat);
  const n = Math.floor(len / 0.02);
  for (let i = 0; i < n; i++) part(g, 0.042, 0.007, 0.01, x, y + 0.007, z - len / 2 + 0.01 + i * (len / n), mat);
}

const models = {};
const accentMats = [];
function accentMat(c, k = 1) { const m = glowMat(c, k); accentMats.push({ m, c, k }); return m; }
const SKINS = [
  { id: 'default', name: 'Default' },
  { id: 'crimson', name: 'Crimson', c: 0xff3355, poly: 0x7a2a36 },
  { id: 'ice', name: 'Ice', c: 0x9fe8ff, poly: 0x486a82 },
  { id: 'gold', name: 'Gold', c: 0xffd23c, poly: 0x7a6226, wood: 0xc9a060 },
  { id: 'toxic', name: 'Toxic', c: 0x8bff3c, poly: 0x35662a },
  { id: 'void', name: 'Void', c: 0xa66bff, poly: 0x3f2e66 },
];
const skinNow = () => SKINS.find((s) => s.id === settings.skin) || SKINS[0];
function applySkin() {
  const s = skinNow();
  for (const a of accentMats) a.m.color.set(s.c ?? a.c).multiplyScalar(a.k);
  vmPoly.color.set(s.poly ?? 0xffffff);
  vmWood.color.set(s.wood ?? 0xffffff);
}
{ // Pulse Rifle: modern carbine (cyan accent)
  const g = new THREE.Group(), accent = accentMat(0x00e5ff, 0.9);
  part(g, 0.07, 0.068, 0.34, 0, 0.03, -0.1);                         // upper receiver
  part(g, 0.004, 0.03, 0.07, 0.036, 0.03, -0.06, vmDark);            // ejection port cover
  part(g, 0.05, 0.014, 0.03, 0, 0.056, 0.075, vmDark);               // charging handle
  part(g, 0.064, 0.055, 0.22, 0, -0.03, -0.06);                      // lower receiver
  part(g, 0.058, 0.05, 0.08, 0, -0.07, -0.1);                        // magwell
  part(g, 0.048, 0.11, 0.074, 0, -0.14, -0.105, vmPoly, 0.12);        // curved magazine
  part(g, 0.048, 0.08, 0.07, 0, -0.226, -0.125, vmPoly, 0.3);
  part(g, 0.05, 0.012, 0.074, 0, -0.268, -0.142, vmDark, 0.3);       // mag base plate
  part(g, 0.042, 0.12, 0.055, 0, -0.1, 0.04, vmPoly, -0.35);          // pistol grip
  part(g, 0.01, 0.006, 0.075, 0, -0.085, -0.015, vmDark);            // trigger guard
  part(g, 0.006, 0.03, 0.006, 0, -0.065, -0.01, vmDark, 0.3);        // trigger
  part(g, 0.068, 0.07, 0.3, 0, 0.022, -0.42, vmPoly);                 // handguard
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) part(g, 0.004, 0.014, 0.035, s * 0.035, 0.022, -0.32 - i * 0.065, vmDark);
  rail(g, 0.6, 0, 0.065, -0.27);                                     // top rail
  tube(g, 0.012, 0.16, 0, 0.022, -0.64, vmDark);                     // barrel
  tube(g, 0.02, 0.07, 0, 0.022, -0.74, vmDark, 0.02, 8);             // muzzle brake
  tube(g, 0.016, 0.14, 0, 0.0, 0.14);                                // buffer tube
  part(g, 0.05, 0.09, 0.15, 0, -0.025, 0.24, vmPoly);                 // stock
  part(g, 0.04, 0.03, 0.12, 0, 0.03, 0.23, vmPoly);                   // cheek riser
  part(g, 0.055, 0.11, 0.02, 0, -0.03, 0.325, vmDark);               // butt pad
  part(g, 0.04, 0.022, 0.05, 0, 0.09, -0.1, vmDark);                 // red-dot mount
  tube(g, 0.024, 0.06, 0, 0.122, -0.1, vmDark);                      // red-dot housing
  dot(g, 0.004, 0, 0.122, -0.128, glowMat(0xff2040, 4));             // the red dot
  part(g, 0.003, 0.006, 0.18, 0.036, 0.0, -0.42, accent);            // accent stripe
  g.userData.muzzle = -0.79;
  models.rifle = g;
}
{ // Scatter Gun: pump shotgun with walnut furniture (orange accent)
  const g = new THREE.Group(), accent = accentMat(0xff8a00, 0.9);
  part(g, 0.07, 0.09, 0.3, 0, 0, -0.03);                             // receiver
  part(g, 0.004, 0.035, 0.08, 0.036, 0.01, -0.04, vmDark);           // ejection port
  tube(g, 0.02, 0.56, 0, 0.032, -0.44);                              // barrel
  tube(g, 0.017, 0.46, 0, -0.012, -0.39, vmDark);                    // magazine tube
  tube(g, 0.019, 0.02, 0, -0.012, -0.63, vmMetal);                   // magazine cap
  part(g, 0.074, 0.058, 0.2, 0, -0.012, -0.36, vmWood);               // wooden pump
  for (let i = 0; i < 5; i++) part(g, 0.076, 0.06, 0.006, 0, -0.012, -0.29 - i * 0.035, vmDark); // grip grooves
  dot(g, 0.006, 0, 0.057, -0.71, glowMat(0xff8a00, 3));              // bead sight
  part(g, 0.05, 0.1, 0.08, 0, -0.065, 0.16, vmWood, -0.35);           // grip
  part(g, 0.058, 0.1, 0.28, 0, -0.05, 0.32, vmWood, 0.05);            // stock
  part(g, 0.062, 0.115, 0.022, 0, -0.06, 0.465, vmPoly, 0.05);        // recoil pad
  part(g, 0.01, 0.006, 0.07, 0, -0.06, 0.05, vmDark);                // trigger guard
  part(g, 0.006, 0.026, 0.006, 0, -0.04, 0.05, vmDark, 0.3);         // trigger
  part(g, 0.006, 0.05, 0.15, -0.038, 0.0, -0.02, vmPoly);            // side shell carrier
  for (let i = 0; i < 4; i++) {                                     // 4 spare shells
    const z = -0.075 + i * 0.035;
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.04, 10), vmShell);
    shell.position.set(-0.048, 0.006, z); g.add(shell);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.0115, 0.0115, 0.012, 10), vmBrass);
    base.position.set(-0.048, -0.02, z); g.add(base);
  }
  part(g, 0.003, 0.006, 0.2, 0.036, -0.03, -0.03, accent);           // accent stripe
  g.userData.muzzle = -0.74;
  models.shotgun = g;
}
{ // Rail Sniper: bolt-action with a big scope and folded bipod (pink accent)
  const g = new THREE.Group(), accent = accentMat(0xff2bd6, 0.9);
  part(g, 0.068, 0.07, 0.42, 0, -0.035, -0.12, vmPoly);              // chassis / forend
  part(g, 0.058, 0.1, 0.07, 0, -0.08, 0.1, vmPoly, -0.35);            // grip
  part(g, 0.058, 0.07, 0.3, 0, -0.05, 0.3, vmPoly);                   // stock
  part(g, 0.045, 0.035, 0.16, 0, 0.0, 0.32, vmPoly);                  // cheek rest
  part(g, 0.06, 0.12, 0.025, 0, -0.06, 0.46, vmDark);                // butt pad
  tube(g, 0.026, 0.26, 0, 0.018, -0.02);                             // receiver
  const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.07, 8), vmMetal);
  bolt.rotation.z = Math.PI / 2 - 0.4; bolt.position.set(0.04, 0.008, 0.06); g.add(bolt);
  dot(g, 0.014, 0.072, -0.006, 0.06, vmMetal);                       // bolt knob
  tube(g, 0.016, 0.6, 0, 0.018, -0.45, vmMetal, 0.012);               // tapered barrel
  part(g, 0.045, 0.04, 0.08, 0, 0.018, -0.78, vmDark);               // muzzle brake
  for (const z of [-0.76, -0.79]) part(g, 0.047, 0.012, 0.01, 0, 0.018, z, vmPoly);
  part(g, 0.05, 0.07, 0.09, 0, -0.1, -0.05, vmDark);                 // magazine
  part(g, 0.01, 0.006, 0.07, 0, -0.075, 0.03, vmDark);               // trigger guard
  tube(g, 0.022, 0.26, 0, 0.088, -0.03, vmDark);                     // scope body
  tube(g, 0.024, 0.08, 0, 0.088, -0.2, vmDark, 0.038);               // objective bell
  tube(g, 0.03, 0.06, 0, 0.088, 0.12, vmDark, 0.024);                // eyepiece
  for (const z of [-0.1, 0.04]) {                                    // scope rings
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.006, 8, 20), vmMetal);
    ring.position.set(0, 0.088, z); g.add(ring);
    part(g, 0.02, 0.03, 0.02, 0, 0.058, z);
  }
  const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.026, 12), vmMetal);
  turret.position.set(0, 0.118, -0.02); g.add(turret);               // elevation turret
  const wind = turret.clone(); wind.rotation.z = Math.PI / 2; wind.position.set(0.032, 0.088, -0.02); g.add(wind);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.034, 24), vmGlass);
  lens.position.set(0, 0.088, -0.241); lens.rotation.y = Math.PI; g.add(lens);
  for (const s of [-1, 1]) tube(g, 0.006, 0.22, s * 0.02, -0.075, -0.4, vmDark); // folded bipod legs
  part(g, 0.003, 0.006, 0.25, 0.035, -0.03, -0.12, accent);          // accent stripe
  g.userData.muzzle = -0.83;
  models.sniper = g;
}
{ // Volt Pistol: polymer striker pistol (green accent)
  const g = new THREE.Group(), accent = accentMat(0x7cff4f, 1);
  part(g, 0.042, 0.042, 0.2, 0, 0.032, -0.1);                        // slide
  for (let i = 0; i < 6; i++) part(g, 0.044, 0.03, 0.004, 0, 0.032, -0.008 - i * 0.01, vmDark); // rear serrations
  part(g, 0.004, 0.016, 0.045, 0.021, 0.036, -0.08, vmDark);         // ejection port
  part(g, 0.04, 0.032, 0.18, 0, -0.004, -0.095, vmPoly);              // frame
  part(g, 0.03, 0.01, 0.05, 0, -0.024, -0.15, vmPoly);                // accessory rail
  part(g, 0.04, 0.12, 0.055, 0, -0.07, 0.0, vmPoly, -0.28);           // grip
  part(g, 0.042, 0.012, 0.06, 0, -0.13, 0.017, vmDark, -0.28);       // mag base plate
  part(g, 0.008, 0.006, 0.055, 0, -0.04, -0.06, vmPoly);              // trigger guard
  part(g, 0.008, 0.03, 0.006, 0, -0.026, -0.088, vmPoly);
  part(g, 0.005, 0.022, 0.005, 0, -0.03, -0.055, vmDark, 0.2);       // trigger
  tube(g, 0.008, 0.01, 0, 0.032, -0.202, vmDark);                    // muzzle crown
  for (const s of [-1, 1]) part(g, 0.01, 0.012, 0.01, s * 0.012, 0.059, -0.012, vmDark); // rear sight
  part(g, 0.006, 0.012, 0.01, 0, 0.059, -0.19, vmDark);              // front sight
  dot(g, 0.0035, 0, 0.064, -0.186, glowMat(0x7cff4f, 4));            // tritium dot
  part(g, 0.002, 0.004, 0.08, 0.021, -0.004, -0.12, accent);         // accent stripe
  g.scale.setScalar(1.2);
  g.position.set(0, 0.03, -0.12);
  g.userData.muzzle = -0.37;
  models.pistol = g;
}
{ // Hand Cannon: heavy polished-steel pistol (yellow accent)
  const g = new THREE.Group(), accent = accentMat(0xffe600, 1);
  part(g, 0.052, 0.05, 0.3, 0, 0.03, -0.13, vmSteel);                // slide
  part(g, 0.03, 0.03, 0.29, 0, 0.058, -0.13, vmSteel, 0, 0, Math.PI / 4); // angled top
  for (let i = 0; i < 7; i++) part(g, 0.054, 0.034, 0.004, 0, 0.03, -0.006 - i * 0.01, vmDark); // serrations
  for (let i = 0; i < 3; i++) part(g, 0.054, 0.008, 0.012, 0, 0.042, -0.24 - i * 0.016, vmDark); // muzzle ports
  part(g, 0.05, 0.035, 0.24, 0, -0.012, -0.11, vmMetal);              // frame
  part(g, 0.05, 0.14, 0.065, 0, -0.085, 0.015, vmPoly, -0.18);        // rubber grip
  for (let i = 0; i < 3; i++) part(g, 0.052, 0.01, 0.01, 0, -0.04 - i * 0.035, -0.02 + i * 0.007, vmDark, -0.18); // finger grooves
  part(g, 0.014, 0.026, 0.02, 0, 0.056, 0.02, vmDark, 0.4);          // hammer
  part(g, 0.01, 0.007, 0.07, 0, -0.04, -0.075);                      // trigger guard
  part(g, 0.01, 0.03, 0.008, 0, -0.025, -0.11);
  part(g, 0.006, 0.026, 0.006, 0, -0.025, -0.065, vmDark, 0.2);      // trigger
  tube(g, 0.014, 0.012, 0, 0.04, -0.283, vmDark);                    // muzzle crown
  for (const s of [-1, 1]) part(g, 0.01, 0.014, 0.012, s * 0.014, 0.083, -0.01, vmDark); // rear sight
  part(g, 0.006, 0.014, 0.012, 0, 0.083, -0.27, vmDark);             // front sight
  dot(g, 0.004, 0, 0.088, -0.266, glowMat(0xffe600, 4));
  part(g, 0.002, 0.004, 0.2, 0.026, -0.012, -0.11, accent);          // accent stripe
  g.scale.setScalar(1.15);
  g.position.set(0, 0.03, -0.1);
  g.userData.muzzle = -0.43;
  models.cannon = g;
}
{ // Arc Blade: tactical knife with a clip-point steel blade and a faint violet edge
  const g = new THREE.Group();
  part(g, 0.032, 0.04, 0.13, 0, -0.02, 0.06, vmPoly);                 // handle
  for (let i = 0; i < 5; i++) part(g, 0.034, 0.042, 0.008, 0, -0.02, 0.012 + i * 0.024, vmDark); // grip wraps
  part(g, 0.036, 0.046, 0.02, 0, -0.02, 0.135, vmMetal);             // pommel
  part(g, 0.022, 0.075, 0.016, 0, -0.01, -0.012, vmMetal);           // crossguard
  const prof = new THREE.Shape();                                    // blade profile (x = along blade)
  prof.moveTo(0, 0.02);
  prof.lineTo(0.17, 0.02);
  prof.lineTo(0.28, -0.004);
  prof.quadraticCurveTo(0.22, -0.032, 0.12, -0.033);
  prof.lineTo(0, -0.028);
  prof.lineTo(0, 0.02);
  const bladeGeo = new THREE.ExtrudeGeometry(prof, {
    depth: 0.004, bevelEnabled: true, bevelThickness: 0.0025, bevelSize: 0.002, bevelSegments: 1, curveSegments: 12,
  });
  bladeGeo.translate(0, 0, -0.002);
  const blade = new THREE.Mesh(bladeGeo, vmSteel);
  blade.rotation.y = Math.PI / 2;                                    // shape x -> -z (forward)
  blade.position.set(0, -0.005, -0.02);
  g.add(blade);
  part(g, 0.0095, 0.006, 0.12, 0, 0.007, -0.1, vmDark);               // fuller groove
  const edgePts = [[0.0, -0.028], [0.12, -0.033], [0.22, -0.027], [0.28, -0.004]]
    .map(([x, y]) => new THREE.Vector3(0, y - 0.005, -0.02 - x));
  g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(edgePts), 24, 0.0014, 5), glowMat(0x8b5cff, 1.2)));
  g.position.set(0.02, 0.0, -0.02);
  g.rotation.set(0.35, 0.2, -0.5);
  g.userData.muzzle = -0.3;
  models.knife = g;
}
{ // Hornet SMG: compact, suppressed, with a vertical foregrip (mint accent)
  const g = new THREE.Group(), accent = accentMat(0x4dffb8, 0.9);
  part(g, 0.066, 0.07, 0.3, 0, 0.02, -0.06);                         // receiver
  part(g, 0.004, 0.026, 0.06, 0.034, 0.025, -0.05, vmDark);          // ejection port
  part(g, 0.05, 0.012, 0.03, 0, 0.06, 0.07, vmDark);                 // charging handle
  rail(g, 0.28, 0, 0.058, -0.06);                                    // top rail
  part(g, 0.07, 0.07, 0.2, 0, 0.02, -0.3, vmPoly);                   // shroud
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) part(g, 0.004, 0.02, 0.025, s * 0.036, 0.022, -0.24 - i * 0.04, vmDark);
  tube(g, 0.02, 0.2, 0, 0.02, -0.5, vmDark);                         // suppressor
  for (const z of [-0.45, -0.5, -0.55]) tube(g, 0.0215, 0.012, 0, 0.02, z, vmMetal);
  part(g, 0.04, 0.2, 0.052, 0, -0.14, -0.06, vmPoly);                // straight magazine
  part(g, 0.044, 0.012, 0.058, 0, -0.245, -0.06, vmDark);            // mag base
  part(g, 0.04, 0.11, 0.05, 0, -0.1, 0.075, vmPoly, -0.3);           // pistol grip
  part(g, 0.01, 0.006, 0.07, 0, -0.07, 0.0, vmDark);                 // trigger guard
  part(g, 0.036, 0.1, 0.04, 0, -0.075, -0.28, vmPoly);               // vertical foregrip
  part(g, 0.028, 0.028, 0.16, 0, 0.02, 0.2, vmDark);                 // wire stock
  part(g, 0.05, 0.09, 0.02, 0, 0.0, 0.295, vmDark);                  // butt pad
  part(g, 0.044, 0.03, 0.06, 0, 0.084, -0.02, vmDark);               // sight mount
  part(g, 0.036, 0.034, 0.05, 0, 0.115, -0.02, vmGlass);             // holo sight
  dot(g, 0.003, 0, 0.115, -0.045, glowMat(0x4dffb8, 4));
  part(g, 0.003, 0.006, 0.16, 0.034, -0.01, -0.28, accent);          // accent stripe
  g.userData.muzzle = -0.64;
  models.smg = g;
}
{ // Trident Burst: three-round-burst carbine with a triple-barrel muzzle (amber accent)
  const g = new THREE.Group(), accent = accentMat(0xffc04d, 0.9);
  part(g, 0.07, 0.078, 0.36, 0, 0.02, -0.08);                        // receiver
  part(g, 0.004, 0.03, 0.07, 0.036, 0.03, -0.06, vmDark);            // ejection port
  part(g, 0.05, 0.014, 0.03, 0, 0.062, 0.09, vmDark);                // charging handle
  part(g, 0.064, 0.05, 0.2, 0, -0.03, -0.06);                        // lower receiver
  part(g, 0.048, 0.1, 0.07, 0, -0.12, -0.1, vmPoly, 0.18);           // magazine
  part(g, 0.05, 0.012, 0.074, 0, -0.178, -0.115, vmDark, 0.18);
  part(g, 0.042, 0.12, 0.055, 0, -0.1, 0.05, vmPoly, -0.35);         // grip
  part(g, 0.01, 0.006, 0.075, 0, -0.085, -0.01, vmDark);             // trigger guard
  part(g, 0.072, 0.07, 0.26, 0, 0.02, -0.4, vmPoly);                 // handguard
  for (let i = 0; i < 3; i++) for (const s of [-1, 1]) part(g, 0.004, 0.014, 0.035, s * 0.037, 0.02, -0.32 - i * 0.07, vmDark);
  for (const [x, y] of [[0, 0.036], [-0.02, 0.006], [0.02, 0.006]]) tube(g, 0.0085, 0.2, x, y, -0.62, vmDark); // three barrels
  part(g, 0.06, 0.05, 0.024, 0, 0.02, -0.7, vmDark);                 // muzzle clamp
  part(g, 0.06, 0.05, 0.024, 0, 0.02, -0.56, vmDark);
  part(g, 0.008, 0.035, 0.008, 0, 0.075, -0.68, vmDark);             // front post
  part(g, 0.04, 0.022, 0.03, 0, 0.082, 0.04, vmDark);                // rear sight
  part(g, 0.05, 0.09, 0.16, 0, -0.02, 0.24, vmPoly);                 // stock
  part(g, 0.055, 0.1, 0.02, 0, -0.025, 0.325, vmDark);               // butt pad
  part(g, 0.003, 0.006, 0.2, 0.037, 0.0, -0.4, accent);              // accent stripe
  g.userData.muzzle = -0.76;
  models.burst = g;
}
for (const g of Object.values(models)) { g.visible = false; vm.add(g); }
applySkin();

const flashTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, '#fff'); gr.addColorStop(0.3, 'rgba(255,255,255,.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const muzzleFlash = new THREE.Group();
for (let i = 0; i < 2; i++) {
  const p = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), new THREE.MeshBasicMaterial({
    map: flashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  }));
  p.rotation.y = i * Math.PI / 2;
  muzzleFlash.add(p);
}
muzzleFlash.position.set(0, 0.02, -0.68);
muzzleFlash.visible = false;
vm.add(muzzleFlash);
const muzzleLight = new THREE.PointLight(0x66eaff, 0, 10, 2);
muzzleLight.position.set(0.2, -0.1, -0.7);
camera.add(muzzleLight);

const gun = {
  ammo: {}, reserve: {}, reloading: false, reloadEnd: 0, nextFire: 0, bloom: 0, kick: 0, flashT: 0,
  switchEnd: 0, ads: false, zoom: 0, shotHeld: false,
  swingT: 0, swingMax: 1, swingSide: 1, swingHeavy: false, heavyHeld: false, // knife
};
function refillAmmo() {
  for (const w of WEAPON_LIST) { gun.ammo[w.id] = w.mag; gun.reserve[w.id] = w.reserve || 0; }
  gun.reloading = false;
}
function refillReserve() { for (const w of WEAPON_LIST) gun.reserve[w.id] = w.reserve || 0; updateHud(); }
const ammoMissing = () => WEAPON_LIST.some((w) => !w.melee && (gun.reserve[w.id] < (w.reserve || 0)));
refillAmmo();

function equip(id, instant = false) {
  if (!WEAPONS[id] || (W.id === id && !instant)) return;
  if (!owns(player, id)) { if (!instant) sfx.blip(180, 0.05, 0.08); return; } // not bought this round
  if (W.id !== id) prevWeapon = W.id;
  W = WEAPONS[id];
  gun.reloading = false;
  gun.burstLeft = 0;
  gun.switchEnd = instant ? 0 : time + 0.35;
  gun.nextFire = gun.switchEnd; // each weapon only waits for the switch animation
  for (const [k, g] of Object.entries(models)) g.visible = k === id;
  muzzleFlash.position.z = models[id].userData.muzzle;
  muzzleFlash.position.y = models[id].position.y + 0.02;
  const flashColor = skinNow().c ?? W.color;
  for (const m of muzzleFlash.children) m.material.color.set(flashColor).multiplyScalar(2.5);
  muzzleLight.color.set(flashColor);
  $('crosshair').dataset.w = id;
  updateHud();
  if (!instant) sfx.equip();
}

function cycleWeapon(step) {
  let i = WEAPON_LIST.findIndex((w) => w.id === W.id);
  for (let n = 0; n < WEAPON_LIST.length; n++) { // skip weapons you don't have
    i = (i + step + WEAPON_LIST.length) % WEAPON_LIST.length;
    if (owns(player, WEAPON_LIST[i].id)) return equip(WEAPON_LIST[i].id);
  }
}

function startReload() {
  if (W.melee || gun.reloading || gun.ammo[W.id] === W.mag || !player.alive || !(gun.reserve[W.id] > 0)) return;
  gun.reloading = true;
  gun.reloadEnd = time + W.reload / 1000;
  sfx.reload(W.id, W.reload);
  updateHud();
}

// ---------------------------------------------------------------- input
const keys = {};
let locked = false, started = false, firing = false, swayX = 0, swayY = 0;

let rebinding = null; // Settings: the action waiting for its new key
const isDown = (action) => {
  const c = settings.binds[action];
  return !!keys[c] || (c === 'ShiftLeft' && !!keys.ShiftRight);
};
addEventListener('keydown', (e) => {
  if (rebinding) { // Settings > Keys: this press becomes the new key (Esc cancels)
    e.preventDefault();
    if (e.code !== 'Escape') setBind(rebinding, e.code);
    rebinding = null;
    buildBindList();
    return;
  }
  const B = settings.binds;
  if (e.code === 'Tab') e.preventDefault();
  if (e.code === B.scores && started) $('scoreboard').style.display = 'block';
  if (!locked) return;
  // While playing, swallow Ctrl shortcuts we can block (Ctrl+D bookmark, Ctrl+S save...).
  if (e.ctrlKey || e.code === 'Space') e.preventDefault();
  keys[e.code] = true;
  if (e.repeat) return;
  if (chatOpen && e.code.startsWith('Digit')) { // quick chat: numbers send
    const i = +e.code.slice(5) - 1;
    if (CHAT_LINES[i]) sayLine(i);
    toggleChat(false);
    return;
  }
  if (e.code === B.chat) { toggleChat(); return; }
  if (e.code === B.ping) { pingLook(); return; }
  if (buyMenuOpen && BUY_KEYS.includes(e.code)) { // buy menu: number keys buy
    const it = BUY_ITEMS[BUY_KEYS.indexOf(e.code)];
    if (it) buyLocal(it.id);
    return;
  }
  if (e.code === B.buy) { toggleBuyMenu(); return; }
  if (e.code === B.reload) startReload();
  if (e.code === B.flash) throwLocal('flash');
  if (e.code === B.smoke) throwLocal('smoke');
  if (e.code === B.frag) throwLocal('frag');
  if (e.code === B.lastWeapon) equip(prevWeapon);
  const slot = WEAPON_LIST.find((w) => e.code === 'Digit' + w.slot);
  if (slot) equip(slot.id);
});
addEventListener('wheel', (e) => { if (locked && player.alive) cycleWeapon(e.deltaY > 0 ? 1 : -1); }, { passive: true });
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === settings.binds.scores && player.alive) $('scoreboard').style.display = 'none';
});
addEventListener('mousemove', (e) => {
  if (!locked) return;
  const s = 0.0022 * settings.sens * (camera.fov / BASE_FOV); // slower turning while zoomed
  player.yaw -= e.movementX * s;
  player.pitch = clamp(player.pitch - e.movementY * s, -1.5, 1.5);
  swayX += e.movementX * 0.0004; swayY += e.movementY * 0.0004;
});
addEventListener('mousedown', (e) => {
  if (!locked) return;
  if (e.button === 0) firing = true;
  if (e.button === 2) gun.ads = true;
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) firing = false;
  if (e.button === 2) gun.ads = false;
});
addEventListener('blur', () => { for (const k in keys) keys[k] = false; firing = false; gun.ads = false; });

document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === document.body;
  if (!locked) { firing = false; gun.ads = false; for (const k in keys) keys[k] = false; openMenu(); }
  else $('menu').style.display = 'none';
});

// ---------------------------------------------------------------- menu
const nameEl = $('name'), sensEl = $('sens'), botsEl = $('bots'), diffEl = $('difficulty');
const volEl = $('volume'), qualEl = $('quality');
nameEl.value = settings.name;
sensEl.value = settings.sens;
botsEl.value = settings.bots;
diffEl.value = settings.difficulty;
volEl.value = settings.volume;
qualEl.value = settings.quality;
const syncLabels = () => {
  $('sensVal').textContent = (+sensEl.value).toFixed(2) + '×';
  $('botsVal').textContent = botsEl.value;
  $('volVal').textContent = Math.round(volEl.value * 100) + '%';
};
syncLabels();
sensEl.oninput = botsEl.oninput = syncLabels;
volEl.oninput = () => { syncLabels(); sfx.setVolume(+volEl.value); };
// Graphics quality changes the renderer setup, so it applies with a quick reload.
qualEl.onchange = () => {
  readMenu();
  settings.quality = qualEl.value;
  saveSettings();
  location.reload();
};

function openMenu() {
  $('menu').style.display = 'flex';
  document.body.classList.toggle('prestart', !started);
  $('play').textContent = started ? 'RESUME' : net.role === 'solo' && roomFromUrl ? 'JOIN ROOM' : 'PLAY';
  $('restart').style.display = started ? 'block' : 'none';
}

function readMenu() {
  const before = { bots: settings.bots, mode: settings.mode };
  settings.name = nameEl.value.trim().slice(0, 16) || 'Player';
  settings.sens = +sensEl.value;
  settings.bots = +botsEl.value;
  settings.difficulty = diffEl.value;
  settings.volume = +volEl.value;
  settings.mode = selectedMode;
  player.name = settings.name;
  saveSettings();
  const changed = before.bots !== settings.bots || before.mode !== settings.mode || avatarDirty;
  avatarDirty = false;
  return changed;
}

// Mode picker
let selectedMode = MODES[settings.mode] ? settings.mode : 'ffa';
function buildModePicker() {
  $('modes').innerHTML = Object.entries(MODES).map(([id, m]) =>
    `<button type="button" class="md ${id === selectedMode ? 'on' : ''}" data-id="${id}" aria-pressed="${id === selectedMode}">${m.name}</button>`).join('');
  const m = MODES[selectedMode];
  $('modeDesc').textContent = m.desc + (m.teams ? ' Tip: 3 bots = 2v2, 5 bots = 3v3, 7 bots = 4v4.' : '');
}
$('modes').addEventListener('click', (e) => {
  const btn = e.target.closest('.md');
  if (!btn) return;
  selectedMode = btn.dataset.id;
  buildModePicker();
});

// End screen buttons
$('endAgain').onclick = () => { $('endscreen').style.display = 'none'; readMenu(); setupMatch(); started = true; lock(); };
$('endMenu').onclick = () => { $('endscreen').style.display = 'none'; };

// Avatar picker: portraits are rendered once with a small separate renderer.
let avatarDirty = false;
function renderPortraits() {
  const W = 160, H = 192;
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1);
  r.setSize(W, H);
  r.toneMapping = THREE.ACESFilmicToneMapping;
  const sc = new THREE.Scene();
  sc.add(new THREE.HemisphereLight(0x99aaff, 0x332244, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(-1.5, 2.5, -3);
  sc.add(key);
  const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 20);
  cam.position.set(0.9, 1.4, -3.7);
  cam.lookAt(0, 1.05, 0);
  const urls = {};
  for (const a of AVATARS) {
    const av = buildAvatar(a.id, a.color);
    av.animate(0.016, 0);
    sc.add(av.group);
    r.render(sc, cam);
    urls[a.id] = r.domElement.toDataURL();
    sc.remove(av.group);
  }
  r.dispose();
  r.forceContextLoss();
  return urls;
}
// Map picker: each card shows a tiny sky/ground preview. Picking another map reloads with it.
const MAP_LOOK = {
  yard: ['linear-gradient(#1a2348, #4a3058 55%, #e07a4a)', '#2a2a2e'],
  harbor: ['linear-gradient(#3a78c8, #8fb8e8 60%, #dfe8f0)', '#a8a49a'],
  alley: ['linear-gradient(#05040d, #1a0b2e 55%, #6a1450)', '#14141c'],
  split: ['linear-gradient(#1a2348, #6a3a58 55%, #ffa060)', '#3a3430'],
  academy: ['linear-gradient(#020414, #0e1440 55%, #3a1a6a)', 'linear-gradient(90deg, #14182a 45%, #00b8ff 45% 50%, #14182a 50%)'],
};
function buildMapPicker() {
  $('maps').innerHTML = MAPS.map((m) => {
    const [skyCss, groundCss] = MAP_LOOK[m.id] || ['#223', '#333'];
    return `<button type="button" class="mp ${m.id === MAP.id ? 'on' : ''}" data-id="${m.id}" title="${m.tag}" aria-pressed="${m.id === MAP.id}">` +
      `<div class="sky" style="background:${skyCss};--ground:${groundCss}"></div><span>${m.name}</span></button>`;
  }).join('');
  $('menuSub').textContent = `Practice vs bots · ${MAP.tag}`;
}
$('maps').addEventListener('click', (e) => {
  const btn = e.target.closest('.mp');
  if (!btn || btn.dataset.id === MAP.id) return;
  readMenu();
  settings.map = btn.dataset.id;
  saveSettings();
  started = false; // no "leave site?" prompt for this reload
  $('loading').style.display = 'flex';
  setTimeout(() => location.reload(), 30);
});

let portraits = {};
function buildPicker() {
  $('avatars').innerHTML = AVATARS.map((a) =>
    `<button type="button" class="av ${a.id === settings.avatar ? 'on' : ''}" data-id="${a.id}" style="--ac:${hex(a.color)}" aria-pressed="${a.id === settings.avatar}">` +
    `<img src="${portraits[a.id] || ''}" alt="" /><span>${a.name}</span></button>`).join('');
  $('avatarTag').textContent = avatarById(settings.avatar).tag;
}
const TINTS = ['', '#ff4d6d', '#4dd2ff', '#ffd23c', '#9d7cff', '#7cff9f', '#ffffff'];
function buildLooks() {
  $('tints').innerHTML = TINTS.map((t) => `<button type="button" class="sw ${t === settings.tint ? 'on' : ''}" data-t="${t}" title="${t ? 'Color ' + t : 'Original color'}" aria-pressed="${t === settings.tint}" style="--c:${t || hex(avatarById(settings.avatar).color)}">${t ? '' : '↺'}</button>`).join('');
  $('skins').innerHTML = SKINS.map((s) => `<button type="button" class="sw ${s.id === settings.skin ? 'on' : ''}" data-s="${s.id}" title="${s.name}" aria-pressed="${s.id === settings.skin}" style="--c:${s.c ? hex(s.c) : '#8a93a8'}">${s.c ? '' : '↺'}</button>`).join('');
}
$('tints').addEventListener('click', (e) => {
  const b = e.target.closest('.sw'); if (!b) return;
  settings.tint = b.dataset.t; player.color = avColor(); saveSettings(); if (started) avatarDirty = true; buildLooks();
});
$('skins').addEventListener('click', (e) => {
  const b = e.target.closest('.sw'); if (!b) return;
  settings.skin = b.dataset.s; applySkin(); equip(W.id, true); saveSettings(); buildLooks();
});
$('avatars').addEventListener('click', (e) => {
  const btn = e.target.closest('.av');
  if (!btn || btn.dataset.id === settings.avatar) return;
  settings.avatar = btn.dataset.id;
  player.color = avColor();
  saveSettings();
  if (started) avatarDirty = true; // bots get re-picked on resume
  buildPicker();
  buildLooks();
});

// ?test in the URL skips pointer lock (for automated checks) and exposes game state.
const TEST = new URLSearchParams(location.search).has('test');
if (TEST) {
  window.__arena = { player, get nav() { return nav; }, addFeed: (...a) => addFeed(...a), get FEED_EXTRA() { return FEED_EXTRA; },  get pings() { return pings; }, sendSay: (...a) => sendSay(...a), pingLook: () => pingLook(), sayLine: (i) => sayLine(i), endMatch: (o) => endMatch(o), get nades() { return nades; }, get smokes() { return smokes; }, get blindT() { return blindT; }, throwLocal: (t) => throwLocal(t), buyLocal: (i) => buyLocal(i), get bots() { return bots; }, keys, gun, setFiring: (v) => (firing = v), equip,
    renderer, scene, camera, composer, THREE, pause: (v) => (testPause = v), get stance() { return stance; }, vm, gunCam, get match() { return match; }, get charge() { return charge; }, get mode() { return mode; }, get ents() { return ents; }, get sfx() { return sfx; }, net, get proxies() { return proxies; }, get humans() { return humans; },
    get weapon() { return W.id; } };
}

function lockFailed() {
  if (locked) return;
  if (TEST) { locked = true; $('menu').style.display = 'none'; return; } // automated checks only
  $('status').textContent = "Couldn't capture the mouse. Click PLAY again (open the game in Chrome or Edge if this keeps happening).";
}
document.addEventListener('pointerlockerror', lockFailed);

function lock() {
  sfx.init();
  // Raw mouse input first (no OS acceleration); fall back to a plain lock if it isn't supported.
  let p;
  try { p = document.body.requestPointerLock({ unadjustedMovement: true }); } catch { p = null; }
  const plain = () => {
    try {
      const p2 = document.body.requestPointerLock();
      if (p2 && p2.catch) p2.catch(lockFailed);
    } catch { lockFailed(); }
  };
  if (p && p.catch) p.catch(plain);
  else if (!p) plain();
}

// Safety net: if the tab is about to close mid-match (e.g. an accidental Ctrl+W), ask first.
addEventListener('beforeunload', (e) => {
  if (!started || TEST) return;
  e.preventDefault();
  e.returnValue = '';
});

// If the graphics driver resets, restart on Low instead of freezing on a black screen.
renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  settings.quality = 'low';
  saveSettings();
  window.showGameError?.('Graphics crashed (GPU reset). Restarting on Low graphics...');
  started = false; // skip the leave-site prompt
  setTimeout(() => location.reload(), 2000);
});

// Clicking the game view while the mouse isn't captured grabs it again.
renderer.domElement.addEventListener('click', () => { if (started && !locked) lock(); });

$('play').onclick = () => {
  if (net.role === 'solo' && roomFromUrl) { joinRoom(roomFromUrl); return; } // invited by a friend
  const botsChanged = readMenu();
  $('status').textContent = '';
  if (isClient()) { lock(); return; } // the host controls the match
  if (!started || botsChanged || match.over) { setupMatch(); started = true; }
  document.body.classList.remove('prestart');
  lock();
};
$('restart').onclick = () => { readMenu(); setupMatch(); started = true; document.body.classList.remove('prestart'); lock(); };

// ---------------------------------------------------------------- HUD
const hex = (c) => '#' + new THREE.Color(c).getHexString();
function updateHud() {
  $('hpnum').textContent = Math.ceil(player.hp);
  $('hpfill').style.width = (player.hp / MAX_HP) * 100 + '%';
  $('hpfill').style.background = player.hp < 35 ? 'linear-gradient(90deg,#ff2b4f,#ff8a00)' : '';
  $('ammoN').textContent = W.melee ? '∞' : gun.reloading ? '··' : gun.ammo[W.id];
  $('ammoM').textContent = W.melee ? '' : ` / ${gun.reserve[W.id] ?? 0}`;
  $('ammoW').textContent = W.name;
  $('ammo').style.setProperty('--wc', hex(W.color));
  $('slots').innerHTML = WEAPON_LIST.map((w) =>
    `<span class="${w.id === W.id ? 'on' : ''}${owns(player, w.id) ? '' : ' none'}" style="--wc:${hex(w.color)}"><b>${w.slot}</b>${w.short}</span>`).join('');
}
function flash(el, op) {
  el.style.transition = 'none'; el.style.opacity = op;
  requestAnimationFrame(() => { el.style.transition = ''; el.style.opacity = 0; });
}
let centerTimer;
function centerMsg(text, ms = 1400) {
  const el = $('center');
  el.textContent = text; el.style.opacity = 1;
  clearTimeout(centerTimer);
  centerTimer = setTimeout(() => (el.style.opacity = 0), ms);
}
const FEED_EXTRA = { frag: { id: 'frag', short: 'FRAG', color: 0x9fcf4c }, blast: { id: 'blast', short: 'BLAST', color: 0xff7a3c } };
const WICON = {
  rifle: '<rect x="2" y="5" width="8" height="4"/><rect x="10" y="4" width="18" height="4"/><rect x="28" y="5" width="11" height="2"/><rect x="15" y="8" width="3" height="5"/>',
  shotgun: '<rect x="2" y="5" width="8" height="4"/><rect x="10" y="4" width="14" height="4"/><rect x="24" y="4" width="15" height="2"/><rect x="24" y="7" width="15" height="2"/><rect x="17" y="8" width="7" height="3"/>',
  sniper: '<rect x="2" y="5" width="7" height="4"/><rect x="9" y="5" width="16" height="3"/><rect x="25" y="6" width="14" height="1.5"/><rect x="12" y="1.5" width="10" height="2.5"/><rect x="14" y="4" width="1.6" height="1.5"/><rect x="19" y="4" width="1.6" height="1.5"/>',
  pistol: '<rect x="10" y="4" width="19" height="4"/><rect x="12" y="8" width="5" height="5"/><rect x="29" y="5" width="4" height="2"/>',
  cannon: '<rect x="6" y="3" width="26" height="5"/><rect x="32" y="4" width="6" height="3"/><rect x="10" y="8" width="7" height="6"/>',
  knife: '<polygon points="12,9 26,2 38,4 28,9"/><rect x="2" y="8" width="10" height="3"/>',
  frag: '<circle cx="20" cy="9" r="5"/><rect x="18" y="1" width="4" height="4"/><rect x="21" y="1" width="6" height="1.5"/>',
  blast: '<circle cx="20" cy="7" r="5"/><rect x="19" y="0" width="2" height="14"/><rect x="13" y="6" width="14" height="2"/>',
};
const wicon = (w) => (WICON[w.id] ? `<svg class="wi" viewBox="0 0 40 14" style="color:${hex(w.color)}" aria-label="${w.short}">${WICON[w.id]}</svg>` : `<span class="wtag" style="color:${hex(w.color)}">${w.short}</span>`);
function addFeed(killer, victim, head, weapon) {
  const d = document.createElement('div');
  const k = killer && killer !== victim ? `<b style="color:${hex(killer.color)}">${killer.name}</b> ` : '';
  const w = weapon ? wicon(weapon) : '';
  d.innerHTML = `${k}${w}<span style="${head ? 'color:#ffd23c' : 'opacity:.6'}">${head ? '⌖ ' : '› '}</span><b style="color:${hex(victim.color)}">${victim.name}</b>`;
  $('feed').prepend(d);
  setTimeout(() => d.remove(), 5000);
}
function renderScores() {
  const row = (e) => `<tr class="${e.isPlayer ? 'me' : ''}${e.alive ? '' : ' dead'}"><td><span class="dot" style="color:${hex(e.color)}"></span>${e.name}</td>` +
    `<td class="num">${e.kills}</td><td class="num">${e.deaths}</td></tr>`;
  const byScore = (a, b) => b.kills - a.kills || a.deaths - b.deaths;
  let body = '';
  if (M.teams) {
    for (const t of ['blue', 'red']) {
      const label = mode === 'demo' ? (t === match.attack ? 'ATTACK' : 'DEFEND') : '';
      body += `<tr class="teamrow"><td colspan="3" style="color:${hex(TEAMS[t].color)}">${TEAMS[t].name} · ${match.score[t]}${label ? ` · ${label}` : ''}</td></tr>`;
      body += ents.filter((e) => e.team === t).sort(byScore).map(row).join('');
    }
  } else body = [...ents].sort(byScore).map(row).join('');
  $('sbTable').innerHTML = `<tr><th>PLAYER</th><th class="num">KILLS</th><th class="num">DEATHS</th></tr>${body}`;
  $('sbRoom').textContent = `${M.name.toUpperCase()} · ${MAP.name.toUpperCase()} · ${settings.difficulty.toUpperCase()}`;
  updateKD();
}

const lastKD = {};
function updateKD() {
  const vals = {
    kdK: player.kills,
    kdD: player.deaths,
    kdR: (player.kills / Math.max(1, player.deaths)).toFixed(2),
    kdS: player.streak,
  };
  for (const [id, v] of Object.entries(vals)) {
    const el = $(id);
    el.textContent = v;
    if (lastKD[id] !== undefined && lastKD[id] !== v && id !== 'kdR' && v !== 0) {
      el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
    }
    lastKD[id] = v;
  }
}
function showHitmarker(head) {
  const el = $('hitmarker');
  el.classList.toggle('head', !!head);
  flash(el, 1);
}

// ---------------------------------------------------------------- player update
let time = 0;

// Movement tuning
const MOVE = {
  walk: 7.2,          // base run speed (m/s)
  sprint: 1.38,       // Shift: speed multiplier
  crouch: 0.5,        // C: speed multiplier
  crouchHeight: 1.15, // body height while crouched/sliding (standing is 1.75)
  crouchEye: 1.02,    // camera height while crouched (standing is 1.6)
  slideMinSpeed: 6.2, // need to be moving at least this fast to slide
  slideBoost: 11.5,   // speed at the start of a slide
  slideTime: 0.85,    // seconds
  slideFriction: 1.5, // how quickly a slide slows down
  slideCooldown: 0.55,
};
// Stance state for the player
const stance = { crouch: 0, sprinting: false, sliding: false, slideT: 0, slideCd: 0, crouchKeyWas: false, sprint: 0 };

function eyeHeight() { return EYE + (MOVE.crouchEye - EYE) * stance.crouch; }

function syncCamera() {
  camera.position.set(player.pos.x, player.pos.y + eyeHeight(), player.pos.z);
  camera.rotation.set(player.pitch, player.yaw, 0);
  camera.updateMatrixWorld();
}

function endSlide() {
  stance.sliding = false;
  stance.slideT = 0;
  stance.slideCd = time + MOVE.slideCooldown;
}

function updatePlayer(dt) {
  if (!player.alive) return;
  // No moving while frozen before a Demolition round, or while planting/defusing.
  const held = player.busy || match.over || (mode === 'demo' && match.phase === 'freeze');
  const f = held ? 0 : (isDown('forward') ? 1 : 0) - (isDown('back') ? 1 : 0);
  const s = held ? 0 : (isDown('right') ? 1 : 0) - (isDown('left') ? 1 : 0);
  const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
  let wx = -sin * f + cos * s, wz = -cos * f - sin * s;
  const len = Math.hypot(wx, wz);
  if (len > 0) { wx /= len; wz /= len; }

  const v = player.vel;
  const horiz = Math.hypot(v.x, v.z);
  // C does both: slide when running fast, crouch otherwise. (Ctrl is not used: Ctrl+W closes browser tabs.)
  const crouchKey = isDown('crouch');
  const crouchPressed = crouchKey && !stance.crouchKeyWas;
  stance.crouchKeyWas = crouchKey;
  const sprintKey = isDown('sprint');

  // Start a slide: press C while running fast on the ground.
  if (crouchPressed && player.grounded && !stance.sliding && horiz > MOVE.slideMinSpeed && time >= stance.slideCd) {
    stance.sliding = true;
    stance.slideT = MOVE.slideTime;
    const boost = Math.min(Math.max(horiz * 1.3, MOVE.slideBoost), 13.5);
    v.x = (v.x / horiz) * boost;
    v.z = (v.z / horiz) * boost;
    gun.ads = false;
    sfx.whoosh(true);
  }

  if (stance.sliding) {
    // Glide: friction slows us down, steering is weak.
    stance.slideT -= dt;
    const fr = Math.exp(-MOVE.slideFriction * dt);
    v.x = v.x * fr + wx * 3 * dt;
    v.z = v.z * fr + wz * 3 * dt;
    if (isDown('jump') && player.grounded) { // slide-jump keeps the momentum
      v.y = JUMP;
      player.grounded = false;
      endSlide();
    } else if (stance.slideT <= 0 || Math.hypot(v.x, v.z) < 3 || !crouchKey && stance.slideT < MOVE.slideTime - 0.25) {
      endSlide();
    }
  } else {
    // Can't stand up if something is right above our head.
    const blockedAbove = stance.crouch > 0.5 && !!hitBox(player.pos, H);
    const crouching = crouchKey || blockedAbove;
    stance.sprinting = sprintKey && f > 0 && !crouching && gun.zoom < 0.3 && !(firing && !W.melee);
    let speed = MOVE.walk * (W.speed || 1) * (1 - gun.zoom * 0.35); // knife is fast, aiming is slow
    if (crouching) speed *= MOVE.crouch;
    else if (stance.sprinting) speed *= MOVE.sprint;
    const k = 1 - Math.exp(-(player.grounded ? 14 : 4) * dt);
    v.x += (wx * speed - v.x) * k;
    v.z += (wz * speed - v.z) * k;
    if (isDown('jump') && player.grounded) { v.y = JUMP; player.grounded = false; }
  }
  if (stance.sliding) stance.sprinting = false;

  // Smoothly lower/raise the body. Collision height follows.
  const low = stance.sliding || crouchKey || (stance.crouch > 0.5 && !!hitBox(player.pos, H));
  stance.crouch += ((low ? 1 : 0) - stance.crouch) * (1 - Math.exp(-14 * dt));
  stance.sprint += ((stance.sprinting && horiz > 2 ? 1 : 0) - stance.sprint) * (1 - Math.exp(-10 * dt));
  player.height = H + (MOVE.crouchHeight - H) * stance.crouch;
  player.crouching = stance.crouch > 0.5;
  moveBody(player, dt);
}

// Knife: left click = quick slash (hold to keep slashing), right click = heavy stab.
function melee() {
  if (!gun.ads) gun.heavyHeld = false;
  if (!player.alive || time < gun.nextFire || cantShoot()) return;
  const heavy = gun.ads && !gun.heavyHeld;
  if (!heavy && !firing) return;
  if (heavy) gun.heavyHeld = true;
  gun.nextFire = time + (heavy ? W.heavyInterval : W.interval) / 1000;
  gun.swingT = gun.swingMax = heavy ? 0.42 : 0.28;
  gun.swingHeavy = heavy;
  gun.swingSide *= -1;
  sfx.whoosh(heavy);

  // Find the closest bot in front of us within reach.
  syncCamera();
  const fwd = camera.getWorldDirection(new THREE.Vector3());
  let best = null, bestD = Infinity;
  for (const b of bots) {
    if (!b.alive || !areEnemies(player, b)) continue;
    const to = new THREE.Vector3(b.pos.x, b.pos.y + 1.1, b.pos.z).sub(camera.position);
    const d = to.length();
    if (d > W.range + 0.4 || d >= bestD) continue;
    if (to.normalize().dot(fwd) < 0.78) continue; // roughly a 40° cone
    if (!canSee(player, b)) continue;
    best = b; bestD = d;
  }
  if (!best) return;

  // Backstab: the target is facing away from us.
  const facing = new THREE.Vector3(-Math.sin(best.yaw), 0, -Math.cos(best.yaw));
  const toMe = new THREE.Vector3(player.pos.x - best.pos.x, 0, player.pos.z - best.pos.z).normalize();
  const back = facing.dot(toMe) < -0.3;
  const dmg = (heavy ? W.heavy : W.body) * (back ? W.backstab : 1);
  const at = new THREE.Vector3(best.pos.x, best.pos.y + 1.1, best.pos.z);
  if (back && best.hp - dmg > 0) centerMsg('BACKSTAB');
  applyPlayerHit(best, dmg, false, W);
  burst(at, best.color, 10);
  burst(at, W.color, 6);
  showHitmarker(back);
  sfx.blip(130, 0.09, 0.3, 'triangle');
  sfx.shot(0.25, 2, 0.05);
}

const cantShoot = () => player.busy || match.over || (mode === 'demo' && match.phase === 'freeze');

function handleFire() {
  if (gun.reloading && time >= gun.reloadEnd) {
    const take = Math.min(W.mag - gun.ammo[W.id], gun.reserve[W.id]);
    gun.ammo[W.id] += take;
    gun.reserve[W.id] -= take;
    gun.reloading = false;
    updateHud();
  }
  if (W.melee) { melee(); return; }
  if (!firing) gun.shotHeld = false;
  const bursting = gun.burstLeft > 0 && !gun.reloading; // the rest of a burst keeps firing after you let go
  if (!(firing || bursting) || !player.alive || gun.reloading || time < gun.nextFire || cantShoot()) return;
  if (!W.auto && gun.shotHeld && !bursting) return; // shotgun & sniper: one shot per click
  if (gun.ammo[W.id] <= 0) {
    gun.burstLeft = 0;
    if (gun.reserve[W.id] > 0) startReload();
    else if (!gun.shotHeld) { gun.shotHeld = true; sfx.blip(160, 0.04, 0.08); centerMsg('OUT OF AMMO · find an ammo box or switch weapon', 1200); }
    return;
  }
  gun.shotHeld = true;
  if (W.burst) gun.burstLeft = bursting ? gun.burstLeft - 1 : W.burst - 1;
  gun.nextFire = time + ((W.burst && gun.burstLeft > 0 ? W.burstGap : W.interval) / 1000);
  gun.ammo[W.id]--;
  player.shots = (player.shots || 0) + 1;

  syncCamera();
  const moving = Math.hypot(player.vel.x, player.vel.z) > 1.5;
  const aiming = gun.zoom > 0.7;
  // Crouching steadies your aim; sprinting and sliding make it worse.
  const stanceMul = stance.sliding ? 1.6 : stance.sprinting ? 1.5 : player.crouching && player.grounded ? 0.65 : 1;
  const spread = ((aiming ? W.spread * W.adsSpread : W.spread) + (moving ? W.moveSpread : 0)) * stanceMul
    + (player.grounded ? 0 : 0.03) + (stance.sliding ? 0.015 : 0) + gun.bloom * (player.crouching ? 0.6 : 1);
  if (W.auto) gun.bloom = Math.min(gun.bloom + 0.003, 0.02);

  const targets = worldMeshes.slice();
  for (const b of bots) if (b.alive && areEnemies(player, b)) targets.push(b.body, b.head); // shots pass through teammates
  const muzzle = new THREE.Vector3(0.16 * (1 - gun.zoom), -0.13 + 0.05 * gun.zoom, -0.75).applyMatrix4(camera.matrixWorld);
  const hits = new Map(); // bot -> total damage from this shot
  const ends = [];
  const sniper = W.id === 'sniper';

  for (let i = 0; i < W.pellets; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
    const dir = new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, -1).normalize().applyQuaternion(camera.quaternion);
    raycaster.set(camera.position, dir);
    raycaster.far = W.range;
    const hit = raycaster.intersectObjects(targets, false)[0];
    const end = hit ? hit.point.clone() : camera.position.clone().addScaledVector(dir, W.range);
    const ent = hit?.object.userData.ent;
    if (ent) {
      const head = hit.object.userData.part === 'head';
      let dmg = head ? W.head : W.body;
      if (W.falloff) dmg *= 1 - 0.7 * clamp((hit.distance - W.falloff[0]) / (W.falloff[1] - W.falloff[0]), 0, 1);
      const h = hits.get(ent) || { dmg: 0, head: false, point: end };
      h.dmg += dmg; h.head ||= head;
      hits.set(ent, h);
    } else if (hit) {
      burst(end, W.color, W.pellets > 1 ? 2 : 5);
      decal(hit, W.color);
    }
    tracer(muzzle, end, W.color, sniper ? 2.5 : W.pellets > 1 ? 0.7 : 1, sniper ? 0.3 : 0.07);
    ends.push(end);
  }

  let headAny = false;
  sendShot(player.id, muzzle, ends, W, W.color);
  for (const [ent, h] of hits) {
    applyPlayerHit(ent, Math.round(h.dmg), h.head, W);
    burst(h.point, ent.color, 6);
    headAny ||= h.head;
  }
  if (hits.size) {
    player.hits = (player.hits || 0) + 1;
    showHitmarker(headAny);
    sfx.blip(headAny ? 1600 : 1100, 0.04, 0.12);
  }

  gun.kick = W.auto ? 1 : 2;
  gun.flashT = W.auto ? 0.04 : 0.07;
  player.pitch = clamp(player.pitch + W.kick * rand(0.8, 1.2), -1.5, 1.5);
  player.yaw += rand(-1, 1) * W.kick * 0.3;
  sfx.weapon(W);
  if (gun.ammo[W.id] === 0) startReload();
  updateHud();
}

// ---------------------------------------------------------------- bot AI
// How each weapon behaves in a bot's hands.
//   range: distance band the bot tries to keep; maxDist: won't shoot beyond this
//   interval: multiplier on the difficulty's fire interval
const BOT_GUNS = {
  rifle: { range: [8, 22], maxDist: 55, interval: 1,
    dmg: (d) => d.dmg, acc: (d, dist) => d.accuracy - dist * 0.006 },
  shotgun: { range: [3, 8], maxDist: 22, interval: 2.8,
    dmg: (d, dist) => Math.round(d.dmg * 4.5 * (1 - 0.7 * clamp((dist - 6) / 16, 0, 1))), acc: (d, dist) => d.accuracy + 0.2 - dist * 0.012 },
  sniper: { range: [18, 40], maxDist: 70, interval: 4.5,
    dmg: (d) => d.dmg * 6, acc: (d) => d.accuracy + 0.05 },
  pistol: { range: [6, 18], maxDist: 45, interval: 1.4,
    dmg: (d) => Math.round(d.dmg * 1.2), acc: (d, dist) => d.accuracy - dist * 0.007 },
  cannon: { range: [8, 25], maxDist: 55, interval: 2.6,
    dmg: (d) => Math.round(d.dmg * 3.5), acc: (d, dist) => d.accuracy - dist * 0.008 },
  smg: { range: [4, 16], maxDist: 38, interval: 0.5,
    dmg: (d) => Math.round(d.dmg * 0.7), acc: (d, dist) => d.accuracy + 0.04 - dist * 0.01 },
  burst: { range: [10, 28], maxDist: 62, interval: 1.5,
    dmg: (d) => Math.round(d.dmg * 2), acc: (d, dist) => d.accuracy - dist * 0.005 },
};
// Chance a bot spawns with each weapon.
// Bot personalities: how they fight and what they carry. Each bot gets one (see makeBot).
const PERSONAS = {
  balanced: { label: 'Balanced', speed: 1, range: 1, react: 1, acc: 1, fire: 1,
    loadout: [['rifle', 0.3], ['burst', 0.15], ['smg', 0.15], ['shotgun', 0.15], ['sniper', 0.1], ['pistol', 0.07], ['cannon', 0.08]] },
  rusher: { label: 'Rusher', speed: 1.12, range: 0.55, react: 0.85, acc: 0.95, fire: 0.9, rush: true,
    loadout: [['smg', 0.4], ['shotgun', 0.3], ['burst', 0.1], ['cannon', 0.1], ['rifle', 0.1]] },
  sniper: { label: 'Sniper', speed: 0.9, range: 1.7, react: 1.1, acc: 1.1, fire: 1.15, hold: true,
    loadout: [['sniper', 0.75], ['burst', 0.15], ['rifle', 0.1]] },
  anchor: { label: 'Anchor', speed: 0.92, range: 1, react: 0.95, acc: 1.05, fire: 1, hold: true,
    loadout: [['rifle', 0.4], ['burst', 0.3], ['shotgun', 0.15], ['pistol', 0.15]] },
  flanker: { label: 'Flanker', speed: 1.06, range: 0.8, react: 1, acc: 1, fire: 1,
    loadout: [['smg', 0.25], ['rifle', 0.25], ['burst', 0.2], ['cannon', 0.15], ['shotgun', 0.15]] },
};
const PERSONA_ORDER = ['balanced', 'rusher', 'sniper', 'anchor', 'flanker', 'rusher', 'sniper'];
function personaDiff(b) { // the difficulty, adjusted for this bot's personality (cached)
  const key = settings.difficulty + b.persona;
  if (b._pdKey !== key) {
    const P = PERSONAS[b.persona] || PERSONAS.balanced, d = DIFF[settings.difficulty];
    b._pd = { ...d, reaction: d.reaction * P.react, accuracy: d.accuracy * P.acc, interval: d.interval * P.fire };
    b._pdKey = key;
  }
  return b._pd;
}
let calloutCool = 0;
// Bots on your team tell you where they saw an enemy.
function botCallout(b, enemy) {
  if (!M.teams || time < calloutCool) return;
  calloutCool = time + 3.5;
  deliverSay(b, { kind: 'msg', text: `Enemy spotted · ${calloutAt(enemy.pos.x, enemy.pos.z)}`, p: null });
}
// Attacking bots lob a smoke at the target bombsite before it is planted.
function botSmoke(b) {
  const ai = b.ai;
  if (mode !== 'demo' || match.phase !== 'live' || b.team !== match.attack || !(b.nades?.smoke > 0) || time < (ai.nextSmoke || 0)) return;
  const site = MAP.sites.find((s) => s.name === match.plan);
  if (!site) return;
  const d = Math.hypot(site.x - b.pos.x, site.z - b.pos.z);
  if (d < 9 || d > 24) return;
  ai.nextSmoke = time + 25;
  const dir = new THREE.Vector3(site.x - b.pos.x, 0, site.z - b.pos.z).normalize().multiplyScalar(Math.cos(0.61));
  dir.y = Math.sin(0.61); // 35 degree lob
  hostThrow(b, 'smoke', dir, null, clamp(Math.sqrt(d * 21), 8, 26));
  deliverSay(b, { kind: 'msg', text: `Smoking ${site.name}`, p: null });
}

// Walk towards a goal along a path around obstacles. Returns the direction to move in.
function steerTo(b, goal) {
  const ai = b.ai;
  const moved = !ai.pathGoal || Math.hypot(ai.pathGoal.x - goal.x, ai.pathGoal.z - goal.z) > 1.5;
  if (moved || time >= ai.repathAt || ai.pathIdx >= ai.path.length) {
    ai.path = findPath(nav, b.pos.x, b.pos.z, goal.x, goal.z);
    ai.pathIdx = 0;
    ai.pathGoal = { x: goal.x, z: goal.z };
    ai.repathAt = time + 2 + Math.random();
  }
  let wp = ai.path[ai.pathIdx];
  while (wp && Math.hypot(wp.x - b.pos.x, wp.z - b.pos.z) < 0.7 && ai.pathIdx < ai.path.length - 1) wp = ai.path[++ai.pathIdx];
  wp = wp || goal;
  return [wp.x - b.pos.x, wp.z - b.pos.z];
}

// Where should this bot be going when it has no enemy in sight? (null = roam)
function botGoal(b) {
  if (mode !== 'demo' || match.phase !== 'live') return null;
  const c = charge, ai = b.ai;
  const site = (name) => MAP.sites.find((s) => s.name === name);
  const near = (p, r) => {                            // a spot around p, refreshed every few seconds
    if (!ai.hold || time >= ai.holdAt || Math.hypot(ai.hold.cx - p.x, ai.hold.cz - p.z) > 0.5) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * r;
      ai.hold = { x: p.x + Math.cos(a) * d, z: p.z + Math.sin(a) * d, cx: p.x, cz: p.z };
      ai.holdAt = time + rand(5, 9);
    }
    return ai.hold;
  };
  if (b.team === match.attack) {
    if (c.state === 'carried' && c.carrier === b) return site(match.plan);              // carry it to the site
    if (c.state === 'dropped') return c.pos;                                            // go pick it up
    if (c.state === 'planted') return near(c.pos, 6);                                   // guard the charge
    const carrier = c.state === 'carried' ? c.carrier : null;
    return carrier && carrier !== b && Math.random() < 0.5 ? carrier.pos : near(site(match.plan), 5); // escort / take site
  }
  if (c.state === 'planted') return c.pos;                                              // retake and defuse
  const mySite = MAP.sites[bots.indexOf(b) % MAP.sites.length];                         // split between sites
  return near(mySite, mySite.r + 1);
}

function updateBot(b, dt) {
  if (b.remote) { if (b.alive) interpRemote(b, dt); return; }
  if (!b.alive) return;
  const ai = b.ai, d = personaDiff(b), P = PERSONAS[b.persona] || PERSONAS.balanced, bg = BOT_GUNS[b.weapon.id];
  if (match.over || (mode === 'demo' && match.phase === 'freeze')) { // frozen before the round starts
    b.vel.x = b.vel.z = 0;
    moveBody(b, dt);
    return;
  }
  ai.aggroT -= dt;
  if (ai.aggroT <= 0) ai.aggro = null;
  if (b.blind > 0) { b.blind -= dt; ai.target = null; ai.aggro = null; } // flashed: can't see

  // Look for the nearest enemy we can see (within our field of view, unless they shot us).
  ai.scan -= dt;
  if (ai.scan <= 0 && !(b.blind > 0)) {
    ai.scan = 0.2;
    let best = null, bestD = Infinity;
    const fx_ = -Math.sin(b.yaw), fz = -Math.cos(b.yaw);
    for (const e of ents) {
      if (!e.alive || !areEnemies(b, e)) continue;
      const dx = e.pos.x - b.pos.x, dz = e.pos.z - b.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 70 || dist >= bestD) continue;
      const facing = (dx * fx_ + dz * fz) / (dist || 1);
      if (e !== ai.aggro && facing < d.fov) continue;
      if (canSee(b, e)) { best = e; bestD = dist; }
    }
    if (best !== ai.target) {
      if (best && !ai.target) botCallout(b, best);
      ai.target = best;
      ai.react = d.reaction * rand(0.7, 1.3);
    }
  }

  let wx = 0, wz = 0, speed = 5.4;
  let tgt = ai.target;
  if (tgt && !tgt.alive) tgt = ai.target = null;
  b.busy = false;
  const goal = botGoal(b);
  botSmoke(b);
  const c = charge;
  // Objective jobs that matter more than chasing a fight (Demolition).
  const urgent = !!goal && (c.carrier === b || (c.state === 'dropped' && b.team === match.attack) || (c.state === 'planted' && b.team !== match.attack));
  const threat = tgt ? Math.hypot(tgt.pos.x - b.pos.x, tgt.pos.z - b.pos.z) : Infinity;

  if (threat > 12 && demoAct(b, dt)) {
    b.busy = true; // planting / defusing: stand still and keep at it
  } else if (tgt) {
    const dx = tgt.pos.x - b.pos.x, dz = tgt.pos.z - b.pos.z;
    const dist = threat || 1;
    b.yaw = lerpAngle(b.yaw, Math.atan2(-dx, -dz), 1 - Math.exp(-10 * dt));
    ai.strafeT -= dt;
    if (ai.strafeT <= 0) { ai.strafe = Math.random() < 0.5 ? -1 : 1; ai.strafeT = rand(0.5, 1.6); }
    const rx = dx / dist, rz = dz / dist;
    if (urgent || (goal && dist > 25)) {
      // Shoot while moving towards the objective, with a little strafe.
      const [gx, gz] = steerTo(b, goal);
      const gl = Math.hypot(gx, gz) || 1;
      wx = gx / gl - rz * ai.strafe * 0.35;
      wz = gz / gl + rx * ai.strafe * 0.35;
      speed = 5;
    } else {
      const approach = dist > bg.range[1] * P.range ? 0.9 : dist < bg.range[0] * P.range ? -0.6 : 0;
      wx = -rz * ai.strafe + rx * approach;
      wz = rx * ai.strafe + rz * approach;
      speed = b.weapon.id === 'shotgun' && approach > 0 ? 5.6 : 4.6;
    }
    ai.react -= dt;
    botNades(b, tgt, dist);
    if (ai.react <= 0 && time >= ai.nextShot && dist <= bg.maxDist) {
      botShoot(b, tgt, dist, d, bg);
      ai.nextShot = time + d.interval * bg.interval * rand(0.8, 1.4);
    }
  } else {
    // No enemy in sight: walk to the objective, or roam.
    let dest = goal;
    if (!dest) {
      if (P.rush && time >= (ai.rushAt || 0)) { // rushers head straight for the nearest enemy
        ai.rushAt = time + 3;
        let foe = null, fd = Infinity;
        for (const e of ents) if (e.alive && areEnemies(b, e)) { const q = Math.hypot(e.pos.x - b.pos.x, e.pos.z - b.pos.z); if (q < fd) { fd = q; foe = e; } }
        if (foe) ai.goal = { x: foe.pos.x, z: foe.pos.z };
      }
      const reached = ai.goal && Math.hypot(ai.goal.x - b.pos.x, ai.goal.z - b.pos.z) < 1.5;
      if (!ai.goal || reached) {
        if (P.hold && reached && !ai.holdUntil) ai.holdUntil = time + rand(6, 12); // snipers and anchors stand and watch
        if (!P.hold || !reached || time >= ai.holdUntil) { ai.goal = randomPoint(); ai.holdUntil = 0; }
      }
      dest = ai.goal;
    }
    if (Math.hypot(dest.x - b.pos.x, dest.z - b.pos.z) > 0.6) [wx, wz] = steerTo(b, dest);
    if (wx || wz) b.yaw = lerpAngle(b.yaw, Math.atan2(-wx, -wz), 1 - Math.exp(-6 * dt));
  }
  speed *= P.speed;
  const len = Math.hypot(wx, wz);
  if (len > 0) { wx /= len; wz /= len; }
  const k = 1 - Math.exp(-(b.grounded ? 10 : 3) * dt);
  b.vel.x += (wx * speed - b.vel.x) * k;
  b.vel.z += (wz * speed - b.vel.z) * k;
  const blocked = moveBody(b, dt);
  if (blocked && b.grounded && Math.random() < 0.06) b.vel.y = JUMP;

  ai.stuckT += dt;
  if (ai.stuckT > 1) {
    if (!b.busy && len > 0 && b.pos.distanceTo(ai.lastPos) < 0.6) { ai.goal = randomPoint(); ai.strafe *= -1; ai.repathAt = 0; }
    ai.lastPos.copy(b.pos);
    ai.stuckT = 0;
  }
}

function botShoot(b, tgt, dist, d, bg) {
  const w = b.weapon;
  const origin = new THREE.Vector3(0.3, 1.1, w.id === 'sniper' ? -0.8 : -0.65).applyAxisAngle(UP, b.yaw).add(b.pos);
  const aim = new THREE.Vector3(tgt.pos.x, tgt.pos.y + (tgt.crouching ? 0.85 : 1.25), tgt.pos.z);
  const tgtMoving = (Math.hypot(tgt.vel.x, tgt.vel.z) > 2 ? 0.12 : 0) + (tgt.crouching ? 0.08 : 0); // crouched = smaller target
  const airborne = tgt.grounded ? 0 : 0.1;
  const chance = clamp(bg.acc(d, dist) - tgtMoving - airborne, 0.05, 0.85);
  const width = w.id === 'sniper' ? 2.5 : 1, life = w.id === 'sniper' ? 0.3 : 0.07;
  let end;
  if (Math.random() < chance) {
    const head = Math.random() < 0.12;
    end = head ? aim.setY(tgt.pos.y + (tgt.crouching ? 1.0 : 1.6)) : aim;
    const dmg = bg.dmg(d, dist);
    damage(tgt, b, head ? dmg * 2 : dmg, head, w);
  } else {
    const miss = aim.add(new THREE.Vector3(rand(-1.4, 1.4), rand(-0.8, 1.2), rand(-1.4, 1.4)));
    const dir = miss.sub(origin).normalize();
    raycaster.set(origin, dir);
    raycaster.far = 80;
    const hit = raycaster.intersectObjects(worldMeshes, false)[0];
    end = hit ? hit.point : origin.clone().addScaledVector(dir, 80);
    if (hit) { burst(end, b.color, 3); decal(hit, w.id === 'rifle' ? b.color : w.color); }
  }
  tracer(origin, end, w.id === 'rifle' ? b.color : w.color, width, life);
  sendShot(b.id, origin, [end], w, w.id === 'rifle' ? b.color : w.color);
  b.model.kick();
  const h = hear(b.pos, 90);
  sfx.gun(w.id, { vol: h.vol * 0.8, pan: h.pan, far: h.far });
}

// ---------------------------------------------------------------- game modes: Demolition, match end
// The charge (Demolition). state: none | carried | dropped | planted
const charge = { state: 'none', carrier: null, pos: new THREE.Vector3(), site: null, timer: 0,
  progress: 0, actor: null, action: null, actedAt: 0, beepAt: 0 };

const chargeMesh = (() => {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.18, 0.26),
    new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.4, metalness: 0.7 }));
  body.position.y = 0.09;
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.012, 0.14), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x3a0a0a) }));
  panel.position.set(-0.04, 0.186, 0);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2020).multiplyScalar(3) }));
  lamp.position.set(0.12, 0.2, 0.06);
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.04, 0.05), new THREE.MeshStandardMaterial({ color: 0xc9a14a, metalness: 0.6, roughness: 0.4 }));
  strap.position.y = 0.09;
  const light = new THREE.PointLight(0xff2a2a, 0, 6, 2);
  light.position.y = 0.4;
  g.add(body, panel, lamp, strap, light);
  g.userData = { lamp, light };
  g.visible = false;
  scene.add(g);
  return g;
})();

// Bombsite markers: a ring on the ground and a floating letter.
const siteVisuals = MAP.sites.map((s) => {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.RingGeometry(s.r - 0.12, s.r, 48), new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xffa040).multiplyScalar(1.4), transparent: true, opacity: 0.7, depthWrite: false,
  }));
  const disc = new THREE.Mesh(new THREE.CircleGeometry(s.r, 48), new THREE.MeshBasicMaterial({
    color: 0xffa040, transparent: true, opacity: 0.07, depthWrite: false,
  }));
  for (const m of [ring, disc]) { m.rotation.x = -Math.PI / 2; m.position.y = 0.03; g.add(m); }
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.font = '900 96px "Segoe UI", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = '#ff9a30'; ctx.shadowBlur = 16; ctx.fillStyle = '#fff3e0';
  ctx.fillText(s.name, 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const letter = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, opacity: 0.85 }));
  letter.scale.set(1.6, 1.6, 1);
  letter.position.y = 3.4;
  g.add(letter);
  g.position.set(s.x, 0, s.z);
  g.visible = false;
  scene.add(g);
  return g;
});

function setupModeVisuals() {
  for (const v of siteVisuals) v.visible = mode === 'demo';
  charge.state = 'none';
  chargeMesh.visible = false;
}

const siteAt = (p) => MAP.sites.find((s) => Math.hypot(p.x - s.x, p.z - s.z) < s.r);

function startRound() {
  match.round++;
  const halftime = match.round === M.halftime + 1;
  if (halftime) { match.attack = otherTeam(match.attack); for (const e of ents) resetEconomy(e); } // fresh money after switching sides
  for (const e of ents) {
    if (e.diedInRound) { e.owned = new Set(['pistol', 'knife']); e.armor = 0; e.nades = emptyNades(); } // died last round: lose your gear
    e.diedInRound = false;
  }
  match.phase = 'freeze';
  match.phaseEnds = time + M.freeze;
  match.plan = Math.random() < 0.5 ? 'A' : 'B';
  for (const e of ents) e.alive = false;
  for (const e of ents) respawn(e);
  for (const b of bots) if (!b.remote) botBuy(b);
  const attackers = ents.filter((e) => e.team === match.attack);
  Object.assign(charge, { state: 'carried', carrier: attackers[Math.floor(Math.random() * attackers.length)],
    site: null, timer: 0, progress: 0, actor: null });
  const role = player.team === match.attack ? 'ATTACK' : 'DEFEND';
  centerMsg(`${halftime ? 'HALFTIME · SWITCHING SIDES · ' : ''}ROUND ${match.round} · ${role}`, 3200);
  hostEv({ k: 'round', n: match.round, attack: match.attack, half: halftime ? 1 : 0 });
  const carrier = charge.carrier;
  if (carrier === player) setTimeout(() => centerMsg('YOU HAVE THE CHARGE · PLANT IT AT A OR B', 3000), 3300);
  else if (carrier?.human) setTimeout(() => hostEv({ to: carrier.id, k: 'msg', text: 'YOU HAVE THE CHARGE · PLANT IT AT A OR B', ms: 3000 }), 3300);
}

function roundEnd(winner, reason) {
  if (match.phase === 'end') return;
  match.phase = 'end';
  match.phaseEnds = time + M.roundEndTime;
  match.score[winner]++;
  for (const e of ents) pay(e, e.team === winner ? ECONOMY.roundWin : ECONOMY.roundLoss);
  charge.actor = null;
  charge.progress = 0;
  roundEndFx(winner, reason);
  hostEv({ k: 'roundEnd', win: winner, why: reason });
  renderScores();
}

function roundEndFx(winner, reason) {
  const won = winner === player.team;
  centerMsg(`${won ? 'ROUND WON' : 'ROUND LOST'} · ${reason}`, 4000);
  if (won) { sfx.blip(660, 0.12, 0.2); setTimeout(() => sfx.blip(990, 0.2, 0.2), 120); }
  else { sfx.blip(330, 0.2, 0.2, 'sawtooth'); setTimeout(() => sfx.blip(220, 0.3, 0.2, 'sawtooth'), 150); }
}

function dropCharge() {
  charge.state = 'dropped';
  charge.pos.y = 0;
  charge.carrier = null;
  if (charge.actor) { charge.actor = null; charge.progress = 0; }
}

// Plant (attacker carrying the charge, inside a site) or defuse (defender next to the planted charge).
// Called every frame the entity is trying; returns true while busy.
function demoAct(e, dt) {
  const c = charge;
  if (mode !== 'demo' || match.phase !== 'live' || !e.alive || !e.grounded) return false;
  let kind = null;
  if (c.state === 'carried' && c.carrier === e && siteAt(e.pos)) kind = 'plant';
  else if (c.state === 'planted' && e.team !== match.attack && e.pos.distanceTo(c.pos) < 1.8) kind = 'defuse';
  if (!kind || (c.actor && c.actor !== e)) return false;
  if (!c.actor) {
    c.actor = e; c.progress = 0; c.action = kind;
    if (e === player || e.pos.distanceTo(player.pos) < 25) sfx.blip(kind === 'plant' ? 520 : 400, 0.06, 0.12);
  }
  c.actedAt = time;
  c.progress += dt;
  if (c.progress >= (kind === 'plant' ? M.plantTime : M.defuseTime)) {
    c.actor = null;
    c.progress = 0;
    if (kind === 'plant') {
      c.state = 'planted';
      c.site = siteAt(e.pos);
      c.pos.set(e.pos.x, 0, e.pos.z);
      c.timer = M.fuse;
      if (economyOn()) pay(e, ECONOMY.plant);
      c.carrier = null;
      c.beepAt = time;
      centerMsg(`CHARGE PLANTED AT ${c.site.name}`, 2500);
      hostEv({ k: 'msg', text: `CHARGE PLANTED AT ${c.site.name}`, ms: 2500, snd: 1 });
      sfx.blip(880, 0.12, 0.25); setTimeout(() => sfx.blip(880, 0.12, 0.25), 180);
    } else {
      roundEnd(e.team, 'CHARGE DEFUSED');
    }
  }
  return true;
}

function explode() {
  explodeFx();
  hostEv({ k: 'boom', x: charge.pos.x, z: charge.pos.z });
  for (const e of ents) {
    if (!e.alive) continue;
    const d = e.pos.distanceTo(charge.pos);
    if (d < 14) damage(e, null, 220 * (1 - d / 14), false, FEED_EXTRA.blast);
  }
  charge.state = 'none';
}

function explodeFx() {
  const at = charge.pos.clone().setY(1);
  burst(at, 0xff8a00, 90, 0.28);
  burst(at, 0xffe0a0, 50, 0.16);
  burst(at, 0x553322, 40, 0.3);
  const boom = new THREE.PointLight(0xffa040, 900, 45, 2);
  boom.position.copy(at).setY(3);
  scene.add(boom);
  fx.push({ obj: boom, kind: 'light', life: 0.9, max: 0.9, peak: 900 });
  sfx.shot(2.2, 0.32, 1.4);
  sfx.blip(45, 1.0, 0.5, 'sine');
  const shake = Math.max(0, 1 - player.pos.distanceTo(at) / 40);
  feel.shake = Math.max(feel.shake, shake * 0.9);
}

// Planted charge: beeps faster as it counts down, with a blinking light.
function chargeBeep() {
  const c = charge;
  const interval = c.timer > 10 ? 1 : c.timer > 4 ? 0.5 : 0.22;
  if (time >= c.beepAt) {
    c.beepAt = time + interval;
    sfx.blip(1700, 0.05, Math.max(0.05, 0.3 - player.pos.distanceTo(c.pos) / 120));
    chargeMesh.userData.lamp.visible = true;
    chargeMesh.userData.light.intensity = 6;
  } else if (time > c.beepAt - interval + 0.08) {
    chargeMesh.userData.lamp.visible = false;
    chargeMesh.userData.light.intensity = 0;
  }
}

// Runs every frame while playing: Demolition rounds, the charge, time limits.
function updateMode(dt) {
  if (match.over) return;
  if (mode === 'tdm' && time >= match.endsAt) {
    const { blue, red } = match.score;
    return endMatch(blue === red ? { draw: true } : { team: blue > red ? 'blue' : 'red' });
  }
  if (mode !== 'demo') return;
  const c = charge;
  if (match.phase === 'freeze') {
    if (time >= match.phaseEnds) {
      match.phase = 'live';
      match.phaseEnds = time + M.roundTime;
      match.buyEnds = time + ECONOMY.buyTime;
      centerMsg('GO!', 1000);
      hostEv({ k: 'msg', text: 'GO!', ms: 1000 });
      sfx.blip(660, 0.15, 0.2);
    }
  } else if (match.phase === 'end') {
    if (time >= match.phaseEnds) {
      const done = ['blue', 'red'].find((t) => match.score[t] >= M.winRounds);
      if (done) endMatch({ team: done });
      else startRound();
    }
  } else {
    if (c.state === 'carried') {
      if (!c.carrier.alive) dropCharge();
      else c.pos.copy(c.carrier.pos);
    }
    if (c.state === 'dropped') {
      const picker = ents.find((e) => e.alive && e.team === match.attack && e.pos.distanceTo(c.pos) < 1.3);
      if (picker) {
        c.state = 'carried';
        c.carrier = picker;
        if (picker === player) centerMsg('YOU PICKED UP THE CHARGE', 1800);
        else if (picker.human) hostEv({ to: picker.id, k: 'msg', text: 'YOU PICKED UP THE CHARGE', ms: 1800 });
      }
    }
    player.busy = isDown('use') && player.alive && demoAct(player, dt);
    for (const e of bots) if (e.human) e.busy = e.actHeld && demoAct(e, dt); // friends holding E
    if (c.actor && time - c.actedAt > 0.15) { c.actor = null; c.progress = 0; } // they stopped
    if (c.state === 'planted') {
      c.timer -= dt;
      chargeBeep();
      if (c.timer <= 0) {
        explode();
        return roundEnd(match.attack, 'CHARGE DETONATED');
      }
    } else if (time >= match.phaseEnds) {
      return roundEnd(otherTeam(match.attack), 'TIME RAN OUT');
    }
    const aliveAtk = ents.filter((e) => e.alive && e.team === match.attack).length;
    const aliveDef = ents.filter((e) => e.alive && e.team !== match.attack).length;
    if (aliveDef === 0) roundEnd(match.attack, 'DEFENDERS ELIMINATED');
    else if (aliveAtk === 0 && c.state !== 'planted') roundEnd(otherTeam(match.attack), 'ATTACKERS ELIMINATED');
  }
}

// Place the charge model: on the carrier's back, on the ground when dropped or planted.
function updateChargeMesh() {
  const c = charge;
  chargeMesh.visible = mode === 'demo' && c.state !== 'none' && !(c.state === 'carried' && c.carrier === player);
  if (!chargeMesh.visible) return;
  if (c.state === 'carried') {
    const back = new THREE.Vector3(0, 1.15, 0.28).applyAxisAngle(UP, c.carrier.yaw);
    chargeMesh.position.copy(c.carrier.pos).add(back);
    chargeMesh.rotation.set(Math.PI / 2, c.carrier.yaw, 0);
  } else {
    chargeMesh.position.copy(c.pos).setY(0.01);
    chargeMesh.rotation.set(0, 0, 0);
    if (c.state === 'dropped') { chargeMesh.userData.lamp.visible = true; chargeMesh.userData.light.intensity = 0; }
  }
}

// Per-player stats for the end screen. The host builds them and sends them to joiners.
const buildStats = () => ents.map((e) => ({ id: e.id, n: e.name, c: e.color, t: e.team || '', k: e.kills, d: e.deaths, h: e.heads || 0, g: Math.round(e.dmg || 0) }));
const statScore = (x) => x.k * 100 + x.h * 50 + x.g - x.d * 30; // MVP = highest
function endTableHtml(st) {
  const rows = [...st].sort((a, b) => statScore(b) - statScore(a));
  const body = rows.map((x, i) => `<tr class="${x.id === player.id ? 'me' : ''}"><td>${i === 0 ? '★ ' : ''}<span style="color:${hex(x.c)}">${escapeHtml(x.n)}</span></td>` +
    `<td>${x.k}</td><td>${x.d}</td><td>${x.h}</td><td>${x.g}</td></tr>`).join('');
  return `<table><tr><th>PLAYER</th><th>K</th><th>D</th><th>HS</th><th>DMG</th></tr>${body}</table>`;
}
function endMatch({ team, winner, draw, st }) {
  if (match.over) return;
  match.over = true;
  st = st || buildStats();
  hostEv({ k: 'end', team: team || null, win: idOf(winner), draw: draw ? 1 : 0, st });
  $('endAgain').style.display = isClient() ? 'none' : '';
  $('endMenu').textContent = isClient() ? 'Close (host restarts)' : 'Menu';
  let title, sub;
  if (draw) { title = 'DRAW'; sub = `${match.score.blue} : ${match.score.red}`; }
  else if (team) {
    title = team === player.team ? 'VICTORY' : 'DEFEAT';
    sub = `${TEAMS[team].name} TEAM WINS · ${match.score.blue} : ${match.score.red}`;
  } else {
    title = winner === player ? 'VICTORY' : `${winner.name.toUpperCase()} WINS`;
    sub = `First to ${M.killLimit} kills`;
  }
  const mvp = [...st].sort((a, b) => statScore(b) - statScore(a))[0];
  $('endTitle').textContent = title;
  $('endTitle').className = title === 'VICTORY' ? 'win' : title === 'DEFEAT' ? 'lose' : '';
  $('endSub').textContent = sub;
  $('endMvp').innerHTML = `MVP <b style="color:${hex(mvp.c)}">${escapeHtml(mvp.n)}</b> · ${mvp.k} kills · ${mvp.h} headshots · ${mvp.g} damage`;
  $('endTable').innerHTML = endTableHtml(st);
  const acc = player.shots ? Math.round(100 * (player.hits || 0) / player.shots) : 0;
  $('endMe').textContent = `You: K/D ${(player.kills / Math.max(1, player.deaths)).toFixed(2)} · accuracy ${acc}% (${player.hits || 0}/${player.shots || 0} shots) · ${player.heads || 0} headshots`;
  $('endscreen').style.display = 'flex';
  $('death').style.display = 'none';
  if (title === 'VICTORY') [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => sfx.blip(f, 0.18, 0.2), i * 140));
  else sfx.blip(196, 0.6, 0.2, 'sawtooth');
  if (document.pointerLockElement) document.exitPointerLock();
}

// Who to watch after dying in Demolition: a living teammate, otherwise anyone alive.
function spectateTarget() {
  return ents.find((e) => e.alive && e !== player && e.team === player.team) || ents.find((e) => e.alive && e !== player) || null;
}

// Top-of-screen mode info, the on-screen prompt and the plant/defuse progress bar.
const fmtTime = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
let lastModebar = '', lastPrompt = '';
function updateModeHud() {
  let bar = '';
  const team = (t, n) => `<b style="color:${hex(TEAMS[t].color)}">${TEAMS[t].name} ${n}</b>`;
  if (mode === 'ffa') {
    const lead = [...ents].sort((a, b) => b.kills - a.kills)[0];
    bar = `FREE-FOR-ALL · FIRST TO ${M.killLimit} · LEADER <b style="color:${hex(lead.color)}">${lead.name} ${lead.kills}</b>`;
  } else if (mode === 'tdm') {
    bar = `${team('blue', match.score.blue)} <span class="vs">:</span> ${team('red', match.score.red)} · ${fmtTime(match.endsAt - time)}`;
  } else {
    const clock = charge.state === 'planted' ? `<b class="hot">CHARGE ${charge.site.name} · ${Math.ceil(charge.timer)}s</b>`
      : match.phase === 'freeze' ? `STARTS IN ${Math.ceil(match.phaseEnds - time)}`
      : match.phase === 'end' ? 'ROUND OVER' : fmtTime(match.phaseEnds - time);
    const role = player.team === match.attack ? 'ATTACK' : 'DEFEND';
    bar = `${team('blue', match.score.blue)} <span class="vs">:</span> ${team('red', match.score.red)} · ROUND ${match.round} · ${role} · ${clock}`;
  }
  if (bar !== lastModebar) { $('modebar').innerHTML = bar; lastModebar = bar; }

  let prompt = '';
  const c = charge;
  if (mode === 'demo' && match.phase === 'live' && player.alive) {
    const attacking = player.team === match.attack;
    if (c.state === 'carried' && c.carrier === player) prompt = siteAt(player.pos) ? 'Hold <kbd>E</kbd> to plant the charge' : 'You have the charge · plant it at <b>A</b> or <b>B</b>';
    else if (c.state === 'dropped' && attacking) prompt = 'The charge was dropped · pick it up';
    else if (c.state === 'planted' && !attacking) prompt = player.pos.distanceTo(c.pos) < 1.8 ? 'Hold <kbd>E</kbd> to defuse' : `Defuse the charge at <b>${c.site.name}</b>`;
    else if (c.state === 'planted' && attacking) prompt = 'Protect the charge';
  }
  if (prompt !== lastPrompt) { $('prompt').innerHTML = prompt; $('prompt').style.display = prompt ? 'block' : 'none'; lastPrompt = prompt; }

  const acting = c.actor === player;
  $('actbar').style.display = acting ? 'block' : 'none';
  if (acting) {
    $('actLabel').textContent = c.action === 'plant' ? 'PLANTING' : 'DEFUSING';
    $('actFill').style.width = `${Math.min(100, (c.progress / (c.action === 'plant' ? M.plantTime : M.defuseTime)) * 100)}%`;
  }
}

// ---------------------------------------------------------------- pickups (Free-for-all / Team Deathmatch)
// Medkits (+50 HP) and ammo boxes (refill spare ammo). They respawn 20 s after being taken.
const PICKUP_RESPAWN = 20;
function makePickupMesh(type) {
  const g = new THREE.Group();
  const col = type === 'hp' ? 0x4dff88 : 0xffc23d;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.52, 32), new THREE.MeshBasicMaterial({
    color: new THREE.Color(col).multiplyScalar(1.4), transparent: true, opacity: 0.8, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  const item = new THREE.Group();
  if (type === 'hp') {
    item.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.32, 0.36), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 })));
    const red = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2a2a).multiplyScalar(1.6) });
    for (const [w, d] of [[0.26, 0.08], [0.08, 0.26]]) {
      for (const s of [-1, 1]) {
        const c = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, d), red);
        c.rotation.x = s > 0 ? 0 : Math.PI / 2;
        c.position.set(0, s > 0 ? 0.17 : 0, s > 0 ? 0 : 0.185);
        item.add(c);
      }
    }
  } else {
    item.add(new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.28, 0.34), new THREE.MeshStandardMaterial({ color: 0x4a5a32, roughness: 0.6 })));
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.05, 0.345), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc23d).multiplyScalar(1.3) }));
    item.add(stripe);
    const brass = new THREE.MeshStandardMaterial({ color: 0xc9a14a, metalness: 1, roughness: 0.3 });
    for (const x of [-0.12, 0, 0.12]) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.14, 8), brass);
      b.position.set(x, 0.21, 0);
      item.add(b);
    }
  }
  item.position.y = 0.45;
  g.add(ring, item);
  g.userData.item = item;
  scene.add(g);
  return g;
}
const pickups = (MAP.pickups || []).map((p, i) => {
  const mesh = makePickupMesh(p.t);
  mesh.position.set(p.x, 0, p.z);
  return { ...p, readyAt: 0, mesh, phase: i };
});
const pickupsOn = () => !M.rounds;

function pickupFx(text, color) {
  centerMsg(text, 900);
  sfx.blip(990, 0.06, 0.15);
  setTimeout(() => sfx.blip(1320, 0.08, 0.12), 60);
  flash($('vignette'), 0); // clear any red flash
  $('center').style.color = color;
  setTimeout(() => ($('center').style.color = ''), 900);
}

// Host / solo: who walks over what.
function updatePickups() {
  if (!pickupsOn()) return;
  for (const p of pickups) {
    if (time < p.readyAt) continue;
    for (const e of ents) {
      if (!e.alive || e.pos.y > 1.5 || Math.hypot(e.pos.x - p.x, e.pos.z - p.z) > 1.1) continue;
      if (p.t === 'hp') {
        if (e.hp >= MAX_HP) continue;
        e.hp = Math.min(MAX_HP, e.hp + 50);
        if (e === player) { updateHud(); pickupFx('+50 HEALTH', '#7cff9f'); }
        else if (e.human) hostEv({ to: e.id, k: 'pick', t: 'hp' });
      } else {
        if (e === player) { if (!ammoMissing()) continue; refillReserve(); pickupFx('AMMO REFILLED', '#ffd36b'); }
        else if (e.human) hostEv({ to: e.id, k: 'pick', t: 'ammo' });
        else continue; // bots have unlimited ammo
      }
      p.readyAt = time + PICKUP_RESPAWN;
      break;
    }
  }
}
function renderPickups(dt) {
  const t = uTime.value;
  for (const p of pickups) {
    p.mesh.visible = pickupsOn() && time >= p.readyAt;
    if (!p.mesh.visible) continue;
    p.mesh.userData.item.rotation.y = t * 1.5 + p.phase;
    p.mesh.userData.item.position.y = 0.45 + Math.sin(t * 2 + p.phase) * 0.06;
  }
}

// ---------------------------------------------------------------- damage direction indicator
const hurtMarks = []; // { x, z, t }
function showHurt(x, z) {
  hurtMarks.push({ x, z, t: performance.now() });
  if (hurtMarks.length > 4) hurtMarks.shift();
}
function updateHurt() {
  const box = $('dmgdir');
  while (box.children.length < 4) box.appendChild(document.createElement('div'));
  const now = performance.now();
  for (let i = 0; i < 4; i++) {
    const el = box.children[i], m = hurtMarks[i];
    const age = m ? now - m.t : Infinity;
    if (age > 1300 || !player.alive) { el.style.opacity = 0; continue; }
    const dx = m.x - player.pos.x, dz = m.z - player.pos.z;
    const fwd = -Math.sin(player.yaw) * dx - Math.cos(player.yaw) * dz;
    const right = Math.cos(player.yaw) * dx - Math.sin(player.yaw) * dz;
    el.style.transform = `rotate(${Math.atan2(right, fwd)}rad)`;
    el.style.opacity = (1 - age / 1300).toFixed(2);
  }
}

// ---------------------------------------------------------------- Demolition economy & buy menu
const NADES = {
  flash: { name: 'Flashbang', price: 200, max: 2, fuse: 1.3, color: 0xfff2a0, tag: 'FLASH' },
  smoke: { name: 'Smoke', price: 300, max: 1, fuse: 1.2, color: 0x9aa4b4, tag: 'SMOKE' },
  frag: { name: 'Frag Grenade', price: 400, max: 1, fuse: 1.7, color: 0x6f8a3c, tag: 'FRAG' },
};
const NADE_IDS = ['flash', 'smoke', 'frag'];
const emptyNades = () => ({ flash: 0, smoke: 0, frag: 0 });
const BUY_ITEMS = [
  { id: 'pistol' }, { id: 'cannon' }, { id: 'smg' }, { id: 'shotgun' }, { id: 'burst' }, { id: 'rifle' }, { id: 'sniper' },
  { id: 'armor', name: 'Armor', price: ECONOMY.armorPrice },
  ...NADE_IDS.map((id) => ({ id, nade: true, name: NADES[id].name, price: NADES[id].price })),
].map((it) => ({ ...it, name: it.name || WEAPONS[it.id].name, price: it.price ?? WEAPONS[it.id].price }));
const economyOn = () => mode === 'demo';
const BEST_FIRST = ['rifle', 'sniper', 'burst', 'smg', 'shotgun', 'cannon', 'pistol'];
const BUY_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus'];
const BUY_KEY_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-'];

function resetEconomy(e) {
  e.money = ECONOMY.start;
  e.owned = new Set(['pistol', 'knife']);
  e.armor = 0;
  e.nades = emptyNades();
  e.diedInRound = false;
}
function owns(e, id) {
  return !economyOn() || id === 'pistol' || id === 'knife' || !!e.owned?.has(id);
}
const bestOwned = (e) => BEST_FIRST.find((id) => owns(e, id)) || 'pistol';
const pay = (e, amount) => { e.money = Math.min(ECONOMY.max, (e.money || 0) + amount); };
function buyWindowOpen() {
  return economyOn() && !match.over && (match.phase === 'freeze' || (match.phase === 'live' && time < match.buyEnds));
}

// Host / solo: apply a purchase. Returns true if it went through.
function tryBuy(e, id) {
  const item = BUY_ITEMS.find((it) => it.id === id);
  if (!item || !e.alive || !buyWindowOpen()) return false;
  if (item.nade) {
    if ((e.nades?.[id] || 0) >= NADES[id].max || (e.money || 0) < item.price) return false;
    e.nades[id]++; e.money -= item.price;
    return true;
  }
  if (id === 'armor' ? e.armor >= 100 : owns(e, id)) return false;
  if ((e.money || 0) < item.price) return false;
  e.money -= item.price;
  if (id === 'armor') e.armor = 100;
  else {
    e.owned.add(id);
    if (e === player) equip(id);
    else if (e.human) hostEv({ to: e.id, k: 'bought', w: id });
    else setEntWeapon(e, id);
  }
  return true;
}

// Bots spend their money at the start of a round.
function botBuy(b) {
  if (!owns(b, 'rifle') && !owns(b, 'sniper')) {
    const m = b.money;
    const want = m >= 5700 && Math.random() < 0.25 ? 'sniper' : m >= 2900 ? 'rifle' : m >= 2400 && Math.random() < 0.5 ? 'burst'
      : m >= 1700 && Math.random() < 0.5 ? 'smg' : m >= 1200 && Math.random() < 0.6 ? 'shotgun' : m >= 700 && Math.random() < 0.6 ? 'cannon' : null;
    if (want) tryBuy(b, want);
  }
  if (b.money >= ECONOMY.armorPrice + 300) tryBuy(b, 'armor');
  if (b.money >= 700) tryBuy(b, 'frag');
  if (b.money >= 500) tryBuy(b, 'flash');
  if (b.team === match.attack && b.money >= 400 && Math.random() < 0.6) tryBuy(b, 'smoke'); // attackers smoke the site
  setEntWeapon(b, bestOwned(b));
}

let buyMenuOpen = false;
function toggleBuyMenu(force) {
  buyMenuOpen = (force ?? !buyMenuOpen) && buyWindowOpen() && player.alive;
  $('buymenu').style.display = buyMenuOpen ? 'block' : 'none';
  if (buyMenuOpen) updateBuyMenu();
}
function buyLocal(id) {
  if (isClient()) { netSend({ t: 'buy', item: id }); sfx.blip(700, 0.05, 0.1); return; }
  if (tryBuy(player, id)) { sfx.blip(990, 0.08, 0.15); updateHud(); }
  else sfx.blip(200, 0.08, 0.1);
  updateBuyMenu();
}
let lastBuyHtml = '';
function updateBuyMenu() {
  const html = BUY_ITEMS.map((it, i) => {
    const have = it.nade ? (player.nades?.[it.id] || 0) >= NADES[it.id].max : it.id === 'armor' ? player.armor >= 100 : owns(player, it.id);
    const afford = (player.money || 0) >= it.price;
    return `<button type="button" data-id="${it.id}" ${have || !afford ? 'disabled' : ''}><span class="k">${BUY_KEY_LABELS[i]}</span>` +
      `<span class="nm">${it.name}</span>${have ? '<span class="own">OWNED</span>' : `<span class="pr">${it.price ? '$' + it.price : 'FREE'}</span>`}</button>`;
  }).join('');
  if (html !== lastBuyHtml) { $('buyList').innerHTML = html; lastBuyHtml = html; }
  $('buyMoney').textContent = `$${player.money || 0}`;
  $('buyTimer').textContent = match.phase === 'freeze' ? 'round starting' : `${Math.max(0, Math.ceil(match.buyEnds - time))}s left`;
}
$('buyList').addEventListener('click', (e) => { const b = e.target.closest('button[data-id]'); if (b) buyLocal(b.dataset.id); });

// Money, armor and the "press B" hint.
let lastEcoHud = '';
function updateEconomyHud() {
  const eco = economyOn() && started;
  const canBuy = eco && buyWindowOpen() && player.alive;
  if (buyMenuOpen && !canBuy) toggleBuyMenu(false);
  if (buyMenuOpen) updateBuyMenu();
  const key = `${eco}|${player.money}|${canBuy}|${Math.ceil(match.buyEnds - time)}|${Math.ceil(player.armor || 0)}|${match.phase}`;
  if (key === lastEcoHud) return;
  lastEcoHud = key;
  $('money').style.display = eco ? 'block' : 'none';
  $('money').textContent = `$${player.money || 0}`;
  $('buyhint').style.display = canBuy && !buyMenuOpen ? 'block' : 'none';
  $('buyhint').innerHTML = `Press <span class="bkey">${keyName(settings.binds.buy)}</span> to buy · ${match.phase === 'freeze' ? 'before the round' : `${Math.max(0, Math.ceil(match.buyEnds - time))}s`}`;
  $('armor').style.display = player.armor > 0 ? 'block' : 'none';
  $('armorNum').textContent = Math.ceil(player.armor || 0);
}

// ---------------------------------------------------------------- settings panel: FOV, crosshair, keys
const BIND_LABELS = {
  forward: 'Forward', back: 'Back', left: 'Left', right: 'Right', jump: 'Jump', sprint: 'Sprint',
  crouch: 'Crouch / slide', reload: 'Reload', use: 'Plant / defuse', buy: 'Buy menu', lastWeapon: 'Last weapon', scores: 'Scoreboard',
  flash: 'Throw flashbang', smoke: 'Throw smoke', frag: 'Throw frag', ping: 'Ping where you look', chat: 'Quick chat',
};
const XH_COLORS = ['#ffffff', '#00e5ff', '#7cff4f', '#ffe600', '#ff2bd6', '#ff3b3b'];
function keyName(code) {
  if (!code) return '?';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return ({ ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', AltLeft: 'L-Alt', Space: 'Space', Tab: 'Tab',
    CapsLock: 'Caps', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backquote: '`' })[code] || code;
}
function applyCrosshair() {
  for (const el of [$('crosshair'), document.getElementById('xhPrevEl')]) {
    if (!el) continue;
    el.dataset.style = settings.xhStyle;
    el.style.setProperty('--xh', settings.xhColor);
  }
}
function buildBindList() {
  $('bindList').innerHTML = Object.keys(DEFAULT_BINDS).map((a) =>
    `<button type="button" data-a="${a}" class="${rebinding === a ? 'wait' : ''}"><span>${BIND_LABELS[a]}</span>` +
    `<b>${rebinding === a ? 'press a key…' : keyName(settings.binds[a])}</b></button>`).join('');
}
function setBind(action, code) {
  const other = Object.keys(settings.binds).find((k) => k !== action && settings.binds[k] === code);
  if (other) settings.binds[other] = settings.binds[action]; // swap instead of leaving a duplicate
  settings.binds[action] = code;
  saveSettings();
}
function buildSettings() {
  $('fov').value = settings.fov;
  $('fovVal').textContent = `${settings.fov}°`;
  $('xhStyle').value = settings.xhStyle;
  $('xhColors').innerHTML = XH_COLORS.map((c) =>
    `<button type="button" data-c="${c}" class="${c === settings.xhColor ? 'on' : ''}" style="background:${c}" aria-label="Crosshair color ${c}"></button>`).join('');
  if (!document.getElementById('xhPrevEl')) {
    $('xhPreview').querySelector('.xhbox').innerHTML = '<div class="xh" id="xhPrevEl"><i></i><i></i><i></i><i></i><u></u><b></b></div>';
  }
  applyCrosshair();
  buildBindList();
}
$('openSettings').onclick = () => { $('settings').style.display = 'flex'; buildSettings(); };
$('closeSettings').onclick = () => { rebinding = null; $('settings').style.display = 'none'; saveSettings(); };
$('resetSettings').onclick = () => {
  Object.assign(settings, { fov: 78, xhStyle: 'crossdot', xhColor: '#ffffff', binds: { ...DEFAULT_BINDS } });
  BASE_FOV = settings.fov;
  saveSettings();
  buildSettings();
};
$('fov').oninput = () => { settings.fov = +$('fov').value; BASE_FOV = settings.fov; $('fovVal').textContent = `${settings.fov}°`; };
$('xhStyle').onchange = () => { settings.xhStyle = $('xhStyle').value; applyCrosshair(); saveSettings(); };
$('xhColors').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-c]');
  if (!b) return;
  settings.xhColor = b.dataset.c;
  buildSettings();
  saveSettings();
});
$('bindList').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-a]');
  if (!b) return;
  rebinding = b.dataset.a;
  buildBindList();
});
applyCrosshair();

// ---------------------------------------------------------------- multiplayer
// Roles (net.role): 'solo' (default), 'host' (runs the match for everyone: bots, health, kills, rounds)
// or 'client' (joined a friend's room: moves locally, sends hits to the host, shows what the host sends).
const humans = new Map();  // host: other people in the room, id -> { id, name, avatar }
const proxies = new Map(); // client: everyone else in the match, id -> entity
const nowS = () => performance.now() / 1000;
const isClient = () => net.role === 'client';
const isHost = () => net.role === 'host';
const idOf = (e) => (e ? e.id : null);
function entById(id) {
  if (id === null || id === undefined) return null;
  if (id === player.id) return player;
  return bots.find((b) => b.id === id) || null;
}
// Host -> everyone (or one player with ev.to)
function hostEv(ev) { if (isHost()) netSend({ t: 'ev', ...ev }); }
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Weapon shown in a bot's / remote player's hands.
function setEntWeapon(e, id) {
  e.weapon = WEAPONS[id] || WEAPONS.rifle;
  e.gunMesh.scale.z = { sniper: 1.6, shotgun: 0.8, pistol: 0.45, cannon: 0.6, knife: 0.3, smg: 0.75, burst: 0.95 }[e.weapon.id] || 1;
  e.gunMesh.scale.x = e.gunStrip.scale.x = e.weapon.id === 'shotgun' ? 1.6 : 1;
  e.gunStrip.material.color.set(e.weapon.color).multiplyScalar(2.2);
}

// A player or bot simulated somewhere else (another browser, or the host).
function makeRemote({ id, name, avatar, color, team, human }) {
  const model = makeCharacter(color, name, avatar);
  const e = {
    id, name, color, team, avatar, human, remote: true, isPlayer: false, ...model,
    pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0,
    hp: MAX_HP, alive: true, grounded: true, crouching: false, kills: 0, deaths: 0, respawnAt: Infinity,
    flash: 0, busy: false, actHeld: false, buf: [], hitTimes: {},
    ai: { target: null, aggro: null, aggroT: 0, hold: null },
  };
  e.body.userData.ent = e;
  e.head.userData.ent = e;
  setEntWeapon(e, 'rifle');
  return e;
}

// Smooth movement for remote entities: show them ~100 ms in the past, between two updates.
function pushPose(e, x, y, z, yaw) { e.buf.push({ t: nowS(), x, y, z, yaw }); if (e.buf.length > 40) e.buf.shift(); }
function snapPose(e, x, y, z, yaw) { e.buf.length = 0; e.pos.set(x, y, z); e.yaw = yaw; pushPose(e, x, y, z, yaw); }
function interpRemote(e, dt) {
  const b = e.buf;
  if (!b.length) return;
  const rt = nowS() - 0.1;
  while (b.length >= 2 && b[1].t <= rt) b.shift();
  const a = b[0], c = b[1];
  let x = a.x, y = a.y, z = a.z, yaw = a.yaw;
  if (c && rt > a.t) {
    const k = Math.min(1, (rt - a.t) / Math.max(1e-3, c.t - a.t));
    x += (c.x - a.x) * k; y += (c.y - a.y) * k; z += (c.z - a.z) * k;
    yaw = lerpAngle(a.yaw, c.yaw, k);
  }
  if (dt > 0) { e.vel.x = (x - e.pos.x) / dt; e.vel.z = (z - e.pos.z) / dt; }
  e.pos.set(x, y, z);
  e.yaw = yaw;
}

// The local player's hits: solo/host apply them; joiners send them to the host,
// which trusts what the shooter saw ("favor the shooter") after a sanity check.
function applyPlayerHit(target, dmg, head, weapon) {
  if (isClient()) netSend({ t: 'hit', target: target.id, dmg: Math.round(dmg), head: head ? 1 : 0, w: weapon.id });
  else damage(target, player, dmg, head, weapon);
}

// Tracers and gun sounds for everyone else.
function sendShot(id, origin, ends, weapon, color) {
  if (net.role === 'solo') return;
  const r = (v) => Math.round(v * 100) / 100;
  netSend({ t: 'shot', id, w: weapon.id, c: color, o: [r(origin.x), r(origin.y), r(origin.z)], e: ends.map((p) => [r(p.x), r(p.y), r(p.z)]) });
}
function onShot(m) {
  if (m.id === player.id || !Array.isArray(m.e)) return;
  const w = WEAPONS[m.w] || WEAPONS.rifle;
  const o = new THREE.Vector3(...m.o);
  const sniper = w.id === 'sniper';
  for (const p of m.e.slice(0, 12)) {
    const end = new THREE.Vector3(...p);
    tracer(o, end, m.c ?? w.color, sniper ? 2.5 : w.pellets > 1 ? 0.7 : 1, sniper ? 0.3 : 0.07);
    burst(end, m.c ?? w.color, w.pellets > 1 ? 1 : 3);
  }
  const h = hear(o, 90);
  sfx.gun(w.id, { vol: h.vol * 0.8, pan: h.pan, far: h.far });
  const shooter = entById(m.id);
  if (shooter && shooter.model) shooter.model.kick();
}

// ----- host side
function teamCounts(list) { const n = { blue: 0, red: 0 }; for (const e of list) if (e.team) n[e.team]++; return n; }
const smallerTeam = (list) => { const n = teamCounts(list); return n.blue < n.red ? 'blue' : 'red'; };

function onPeerJoin(m) {
  const h = { id: m.id, name: m.name || 'Player', avatar: AVATARS.some((a) => a.id === m.avatar) ? m.avatar : 'kaze', tint: tintOf(m.tint) };
  humans.set(h.id, h);
  const team = M.teams ? smallerTeam(ents) : null;
  const av = avatarById(h.avatar);
  const e = makeRemote({ id: h.id, name: h.name, avatar: av.id, color: team ? TEAMS[team].color : h.tint ?? av.color, team, human: true });
  bots.unshift(e);
  ents = [player, ...bots];
  if (M.rounds && match.phase !== 'freeze') { e.alive = false; e.group.visible = false; } // joins at the next round
  else respawn(e);
  centerMsg(`${h.name.toUpperCase()} JOINED`, 1800);
  hostEv({ k: 'msg', text: `${h.name.toUpperCase()} JOINED`, ms: 1800 });
  renderScores();
  updateOnlineUI();
}
function onPeerLeave(m) {
  const h = humans.get(m.id);
  humans.delete(m.id);
  const e = entById(m.id);
  if (e) {
    if (charge.carrier === e) dropCharge();
    if (charge.actor === e) { charge.actor = null; charge.progress = 0; }
    scene.remove(e.group);
    bots = bots.filter((b) => b !== e);
    ents = [player, ...bots];
    renderScores();
  }
  if (h) { centerMsg(`${h.name.toUpperCase()} LEFT`, 1800); hostEv({ k: 'msg', text: `${h.name.toUpperCase()} LEFT`, ms: 1800 }); }
  updateOnlineUI();
}
function onState(m) {
  const e = entById(m.from);
  if (!e || !e.human) return;
  e.pitch = +m.pitch || 0;
  e.grounded = !!m.g;
  e.crouching = !!m.cr;
  e.actHeld = !!m.act;
  if (m.w && e.weapon?.id !== m.w && WEAPONS[m.w]) setEntWeapon(e, m.w);
  if (e.alive && Array.isArray(m.p) && m.p.every(Number.isFinite)) pushPose(e, m.p[0], m.p[1], m.p[2], +m.yaw || 0);
}
function onHitClaim(m) {
  const shooter = entById(m.from), target = entById(m.target), w = WEAPONS[m.w];
  if (!shooter || !target || !w || !shooter.alive || !target.alive || !areEnemies(shooter, target)) return;
  if (match.over || (mode === 'demo' && match.phase === 'freeze')) return;
  const now = performance.now();
  if (now - (shooter.hitTimes[target.id] || 0) < (w.melee ? 300 : w.interval * 0.6)) return; // faster than the gun fires
  shooter.hitTimes[target.id] = now;
  if (shooter.pos.distanceTo(target.pos) > (w.melee ? 4 : w.range + 10)) return;
  const maxDmg = w.melee ? w.heavy * w.backstab : w.head * (w.pellets || 1);
  damage(target, shooter, Math.min(Math.max(0, +m.dmg || 0), maxDmg), !!m.head, w);
}

let snapAcc = 0;
function hostNet(dt) {
  snapAcc += dt;
  if (snapAcc < 0.05) return; // 20 snapshots per second
  snapAcc = 0;
  const r = (v) => Math.round(v * 100) / 100;
  const E = ents.map((e) => [
    e.id, r(e.pos.x), r(e.pos.y), r(e.pos.z), r(e.yaw), Math.ceil(e.hp), e.alive ? 1 : 0, e.team || '',
    e.kills, e.deaths, e === player ? W.id : (e.weapon?.id || 'rifle'), e.name,
    e === player ? settings.avatar : e.avatar, e.color, e === player || e.human ? 1 : 0,
    e.money || 0, Math.ceil(e.armor || 0), e.owned ? [...e.owned].join(',') : '', nadeStr(e),
  ]);
  const c = charge;
  netSend({
    t: 'snap', E,
    m: { mode, map: MAP.id, score: match.score, round: match.round, attack: match.attack, phase: match.phase,
      pe: r(match.phaseEnds - time), te: match.endsAt === Infinity ? -1 : r(match.endsAt - time),
      be: r(match.buyEnds - time), pk: pickups.map((p) => (time >= p.readyAt ? 1 : 0)).join('') },
    c: { s: c.state, cr: idOf(c.carrier), p: [r(c.pos.x), r(c.pos.z)], site: c.site?.name || null, tm: r(c.timer),
      a: idOf(c.actor), ac: c.action, pr: r(c.progress) },
  });
}

// ----- client side
let stateAcc = 0, scoreAcc = 0;
function clientNet(dt) {
  stateAcc += dt;
  if (stateAcc >= 0.05) {
    stateAcc = 0;
    const r = (v) => Math.round(v * 100) / 100;
    netSend({ t: 'state', p: [r(player.pos.x), r(player.pos.y), r(player.pos.z)], yaw: r(player.yaw), pitch: r(player.pitch),
      g: player.grounded ? 1 : 0, cr: player.crouching ? 1 : 0, act: isDown('use') ? 1 : 0, w: W.id });
  }
  player.busy = isDown('use') && charge.actor === player;
  if (charge.state === 'planted') { charge.timer -= dt; chargeBeep(); }
  scoreAcc += dt;
  if (scoreAcc > 1) { scoreAcc = 0; renderScores(); }
}

function setupClient() {
  for (const b of bots) scene.remove(b.group);
  bots = [];
  proxies.clear();
  ents = [player];
  player.alive = false; // the host spawns us
  player.kills = player.deaths = player.streak = 0;
  $('feed').innerHTML = '';
  $('endscreen').style.display = 'none';
  setupModeVisuals();
}

function onSnap(s) {
  const seen = new Set();
  for (const [id, x, y, z, yaw, hp, alive, team, kills, deaths, w, name, avatar, color, human, money, armor, owned, nd] of s.E) {
    seen.add(id);
    if (id === player.id) {
      if (hp < player.hp && player.alive) flash($('vignette'), 0.9);
      player.hp = hp; player.kills = kills; player.deaths = deaths;
      player.team = team || null; player.color = color;
      player.money = money; player.armor = armor;
      player.owned = new Set((owned || 'pistol,knife').split(','));
      if (nd) { const q = nd.split(',').map(Number); player.nades = { flash: q[0] || 0, smoke: q[1] || 0, frag: q[2] || 0 }; }
      if (!alive) player.alive = false;
      updateHud();
      continue;
    }
    let e = proxies.get(id);
    if (e && (e.team !== (team || null) || e.color !== color || e.avatar !== avatar)) { scene.remove(e.group); proxies.delete(id); e = null; }
    if (!e) {
      e = makeRemote({ id, name, avatar: avatarById(avatar).id, color, team: team || null, human: !!human });
      e.avatar = avatar;
      proxies.set(id, e);
      snapPose(e, x, y, z, yaw);
    } else if (alive && !e.alive) snapPose(e, x, y, z, yaw); // just respawned: jump there, don't slide
    else if (alive) pushPose(e, x, y, z, yaw);
    if (hp < e.hp && alive) e.flash = 0.1;
    e.hp = hp; e.alive = !!alive; e.kills = kills; e.deaths = deaths;
    e.group.visible = e.alive;
    if (e.weapon?.id !== w && WEAPONS[w]) setEntWeapon(e, w);
  }
  for (const [id, e] of proxies) if (!seen.has(id)) { scene.remove(e.group); proxies.delete(id); }
  bots = [...proxies.values()];
  ents = [player, ...bots];

  const m = s.m;
  if (m.mode !== mode) { mode = m.mode; M = MODES[mode]; setupModeVisuals(); }
  match.score = m.score; match.round = m.round; match.attack = m.attack; match.phase = m.phase;
  match.phaseEnds = time + m.pe;
  match.endsAt = m.te < 0 ? Infinity : time + m.te;
  const c = s.c;
  charge.state = c.s;
  charge.carrier = entById(c.cr);
  charge.pos.set(c.p[0], 0, c.p[1]);
  if (charge.state === 'carried' && charge.carrier) charge.pos.copy(charge.carrier.pos);
  charge.site = MAP.sites.find((x) => x.name === c.site) || null;
  charge.timer = c.tm;
  charge.actor = entById(c.a);
  charge.action = c.ac;
  charge.progress = c.pr;
  match.buyEnds = time + (m.be ?? 0);
  if (typeof m.pk === 'string') pickups.forEach((p, i) => { p.readyAt = m.pk[i] === '1' ? 0 : Infinity; });
}

function onEvent(ev) {
  switch (ev.k) {
    case 'kill': {
      const v = entById(ev.v);
      if (!v) return;
      v.alive = false;
      killFx(v, entById(ev.by), !!ev.h, WEAPONS[ev.w] || FEED_EXTRA[ev.w] || null);
      return;
    }
    case 'respawn':
      player.pos.set(...ev.p);
      player.vel.set(0, 0, 0);
      player.yaw = ev.yaw;
      player.hp = MAX_HP;
      player.alive = true;
      resetLocalPlayer();
      return;
    case 'say':
      showSay(ev);
      return;
    case 'tn':
      spawnNade(ev.id, ev.ty, new THREE.Vector3(...ev.p), new THREE.Vector3(...ev.v), ev.by);
      return;
    case 'nb': {
      const i = nades.findIndex((n) => n.id === ev.id);
      if (i >= 0) removeNade(i);
      const p = new THREE.Vector3(...ev.p);
      if (ev.ty === 'smoke') addSmoke(p);
      nadeFx(ev.ty, p);
      return;
    }
    case 'blind':
      blind(ev.dur);
      return;
    case 'msg':
      centerMsg(ev.text, ev.ms || 1800);
      if (ev.snd) { sfx.blip(880, 0.12, 0.25); setTimeout(() => sfx.blip(880, 0.12, 0.25), 180); }
      return;
    case 'round':
      match.attack = ev.attack;
      centerMsg(`${ev.half ? 'HALFTIME · SWITCHING SIDES · ' : ''}ROUND ${ev.n} · ${player.team === ev.attack ? 'ATTACK' : 'DEFEND'}`, 3200);
      return;
    case 'roundEnd': roundEndFx(ev.win, ev.why); return;
    case 'boom': charge.pos.set(ev.x, 0, ev.z); explodeFx(); return;
    case 'end': endMatch({ team: ev.team || null, winner: entById(ev.win), draw: !!ev.draw, st: ev.st }); return;
    case 'hurt': showHurt(ev.x, ev.z); return;
    case 'pick':
      if (ev.t === 'ammo') { refillReserve(); pickupFx('AMMO REFILLED', '#ffd36b'); }
      else pickupFx('+50 HEALTH', '#7cff9f');
      return;
    case 'bought':
      player.owned?.add(ev.w);
      equip(ev.w);
      sfx.blip(990, 0.08, 0.15);
      return;
    case 'reset':
      $('endscreen').style.display = 'none';
      $('feed').innerHTML = '';
      player.streak = 0; player.shots = 0; player.hits = 0;
      match.over = false;
      return;
  }
}

// ----- rooms (menu)
const roomFromUrl = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
const inviteUrl = () => `${location.origin}${location.pathname}?room=${net.room}`;

function updateOnlineUI() {
  const inRoom = net.role !== 'solo';
  const invited = !inRoom && !!roomFromUrl;
  document.body.classList.toggle('in-room', inRoom);
  document.body.classList.toggle('is-client', isClient() || invited);
  $('onlineIdle').style.display = inRoom || invited ? 'none' : 'block';
  $('onlineRoom').style.display = inRoom || invited ? 'block' : 'none';
  $('leaveRoom').textContent = invited ? 'Play solo instead' : 'Leave room';
  if (invited) {
    $('roomInfo').innerHTML = `You're invited to room <b>${roomFromUrl}</b>. Pick your name and avatar, then press <b>JOIN ROOM</b>.`;
    $('inviteRow').style.display = 'none';
    $('roomPlayers').innerHTML = '';
    $('play').textContent = 'JOIN ROOM';
    return;
  }
  if (!inRoom) return;
  $('inviteRow').style.display = 'flex';
  $('inviteLink').value = inviteUrl();
  const names = isHost()
    ? [`${settings.name} (you · host)`, ...[...humans.values()].map((h) => h.name)]
    : ents.filter((e) => e === player || e.human).map((e) => (e === player ? `${e.name} (you)` : e.name));
  $('roomInfo').innerHTML = `${isHost() ? 'Hosting' : 'Playing in'} room <b>${net.room}</b> · ${names.length} ${names.length === 1 ? 'player' : 'players'}` +
    (isHost() ? '<br><span class="tag">Keep this tab open: your game runs the match for everyone.</span>' : '');
  $('roomPlayers').innerHTML = names.map((n) => `<span>${escapeHtml(n)}</span>`).join('');
}

function wireNet() {
  Object.assign(net.handlers, {
    'peer-join': onPeerJoin, 'peer-leave': onPeerLeave, state: onState, hit: onHitClaim,
    shot: onShot, snap: onSnap, ev: onEvent,
    buy: (m) => { const e = entById(m.from); if (e) tryBuy(e, m.item); },
    say: (m) => {
      const e = entById(m.from);
      if (!e || (m.kind !== 'msg' && m.kind !== 'ping')) return;
      const p = Array.isArray(m.p) && m.p.length === 3 && m.p.every(Number.isFinite) ? m.p : null;
      if (m.kind === 'ping' && !p) return;
      deliverSay(e, { kind: m.kind, text: String(m.text || '').slice(0, 48), p });
    },
    throw: (m) => {
      const e = entById(m.from);
      if (!e || !NADES[m.ty] || !Array.isArray(m.d)) return;
      const d = new THREE.Vector3(+m.d[0] || 0, +m.d[1] || 0, +m.d[2] || 0);
      if (d.lengthSq() < 0.01) return;
      hostThrow(e, m.ty, d.normalize());
    },
    'host-left': () => { window.showGameError?.('The host left the room. Going back to solo...'); backToSolo(); },
  });
  net.onClose = () => { window.showGameError?.('Lost connection to the room. Going back to solo...'); backToSolo(); };
}
function backToSolo() {
  started = false;
  netLeave();
  setTimeout(() => { location.href = location.pathname; }, 2500);
}

async function createRoom() {
  readMenu();
  lock(); // needs the click
  $('status').textContent = 'Creating room...';
  try {
    await connect();
    wireNet();
    netSend({ t: 'create', name: settings.name, avatar: settings.avatar, tint: settings.tint, settings: { map: MAP.id, mode: settings.mode } });
    const r = await waitFor('created');
    Object.assign(net, { role: 'host', id: r.id, hostId: r.id, room: r.room });
    player.id = r.id;
    history.replaceState(null, '', `?room=${r.room}`);
    $('status').textContent = '';
    setupMatch();
    started = true;
    document.body.classList.remove('prestart');
    updateOnlineUI();
  } catch (err) {
    net.role = 'solo';
    $('status').textContent = `${err.message} Try again in a moment (a sleeping free server can take up to a minute to wake).`;
  }
}

async function joinRoom(code) {
  readMenu();
  lock();
  $('status').textContent = `Joining room ${code}...`;
  try {
    await connect();
    wireNet();
    netSend({ t: 'join', room: code, name: settings.name, avatar: settings.avatar, tint: settings.tint });
    const r = await waitFor('joined');
    if (r.settings?.map && r.settings.map !== MAP.id) {
      // The room plays another map: load it, then join again.
      netLeave();
      settings.map = r.settings.map;
      saveSettings();
      $('loading').style.display = 'flex';
      setTimeout(() => location.reload(), 30);
      return;
    }
    Object.assign(net, { role: 'client', id: r.id, hostId: r.hostId, room: r.room });
    player.id = r.id;
    $('status').textContent = '';
    setupClient();
    started = true;
    document.body.classList.remove('prestart');
    updateOnlineUI();
  } catch (err) {
    net.role = 'solo';
    $('status').textContent = err.message;
  }
}

$('createRoom').onclick = createRoom;
$('copyLink').onclick = () => {
  navigator.clipboard?.writeText(inviteUrl()).then(() => { $('copyLink').textContent = 'Copied!'; setTimeout(() => ($('copyLink').textContent = 'Copy link'), 1500); });
  $('inviteLink').select();
};
$('leaveRoom').onclick = () => {
  if (net.role === 'solo') { location.href = location.pathname; return; } // decline invite
  started = false;
  netLeave();
  location.href = location.pathname;
};

// ---------------------------------------------------------------- main loop
const clock = new THREE.Clock();
let bob = 0, scopedShown = false;
const vmPos = new THREE.Vector3();

function frame() {
  requestAnimationFrame(frame);
  tick(Math.min(clock.getDelta(), 0.05));
  composer.render();
}

const feel = { roll: 0, dip: 0, prevVy: 0, wasGrounded: true, speedFov: 0, slideTilt: 0, shake: 0 };

let testPause = false; // ?test only: freezes gameplay while still rendering
let netHudAcc = 0;

// ---------------------------------------------------------------- utility: grenades (flash, smoke, frag)
// Everyone simulates the flight of a grenade locally (so it looks right), but only the host/solo game decides
// what the blast does: damage, blinding, smoke. Joiners just ask the host to throw ('throw') and watch.
const nadeStr = (e) => NADE_IDS.map((k) => e.nades?.[k] || 0).join(',');
const nades = [];   // grenades in flight
const smokes = [];  // active smoke clouds
let nadeSeq = 0, nadeCool = 0, blindT = 0, blindMax = 1, utilRound = -1;

const nadeGeo = { frag: new THREE.SphereGeometry(0.09, 10, 8), flash: new THREE.CylinderGeometry(0.05, 0.05, 0.2, 10), smoke: new THREE.CylinderGeometry(0.07, 0.07, 0.22, 10) };
function spawnNade(id, ty, pos, vel, owner) {
  const mesh = new THREE.Mesh(nadeGeo[ty], new THREE.MeshStandardMaterial({ color: NADES[ty].color, roughness: 0.5, metalness: 0.4, emissive: NADES[ty].color, emissiveIntensity: 0.25 }));
  mesh.position.copy(pos);
  scene.add(mesh);
  nades.push({ id, ty, mesh, pos: pos.clone(), vel: vel.clone(), fuse: NADES[ty].fuse, age: 0, owner });
}

// One step of grenade flight: gravity, bounce off walls/boxes and the floor.
function nadeStep(n, dt) {
  const R = 0.12;
  n.vel.y -= 20 * dt;
  for (const axis of ['x', 'y', 'z']) {
    n.pos[axis] += n.vel[axis] * dt;
    for (const c of colliders) {
      if (n.pos.x + R > c.minX && n.pos.x - R < c.maxX && n.pos.y + R > c.minY && n.pos.y - R < c.maxY && n.pos.z + R > c.minZ && n.pos.z - R < c.maxZ) {
        n.pos[axis] -= n.vel[axis] * dt;
        n.vel[axis] *= -0.4;
        if (axis === 'y') { n.vel.x *= 0.8; n.vel.z *= 0.8; }
        break;
      }
    }
  }
  if (n.pos.y < R) { n.pos.y = R; if (n.vel.y < 0) n.vel.y *= -0.35; if (Math.abs(n.vel.y) < 1) n.vel.y = 0; n.vel.x *= 0.82; n.vel.z *= 0.82; }
  for (const a of ['x', 'z']) if (Math.abs(n.pos[a]) > S - R) { n.pos[a] = Math.sign(n.pos[a]) * (S - R); n.vel[a] *= -0.4; }
}

// Host/solo: someone throws. dir = unit vector, origin optional (the local player's camera).
function hostThrow(e, ty, dir, origin, speed) {
  if (!e.alive || !(e.nades?.[ty] > 0)) return;
  e.nades[ty]--;
  const o = origin || new THREE.Vector3(e.pos.x, e.pos.y + 1.5, e.pos.z).addScaledVector(dir, 0.6);
  const v = dir.clone().multiplyScalar(speed || 16);
  if (speed) { /* a planned lob: no extra boost */ } else { v.y += 3.2; v.x += (e.vel?.x || 0) * 0.5; v.z += (e.vel?.z || 0) * 0.5; }
  const id = `n${++nadeSeq}${net.id || 's'}`;
  spawnNade(id, ty, o, v, e.id);
  hostEv({ k: 'tn', id, ty, p: [o.x, o.y, o.z], v: [v.x, v.y, v.z], by: e.id });
}

function throwLocal(ty) {
  if (!player.alive || cantShoot() || buyMenuOpen || time < nadeCool) return;
  if (!(player.nades?.[ty] > 0)) { sfx.blip(180, 0.05, 0.08); return; }
  nadeCool = time + 0.6;
  syncCamera();
  const dir = camera.getWorldDirection(new THREE.Vector3());
  sfx.whoosh(false);
  if (isClient()) { netSend({ t: 'throw', ty, d: [dir.x, dir.y, dir.z] }); player.nades[ty]--; return; } // the next snapshot corrects the count
  hostThrow(player, ty, dir, camera.position.clone().addScaledVector(dir, 0.5));
}

// ---- smoke
const smokeTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();
const SMOKE_R = 4.2, SMOKE_TIME = 12;
function addSmoke(pos) {
  const group = new THREE.Group();
  const sprites = [];
  for (let i = 0; i < 18; i++) {
    const m = new THREE.SpriteMaterial({ map: smokeTex, color: new THREE.Color(0xb4bac4).multiplyScalar(0.85 + Math.random() * 0.2), transparent: true, opacity: 0, depthWrite: false });
    const s = new THREE.Sprite(m);
    const a = Math.random() * Math.PI * 2, r = Math.random() * SMOKE_R * 0.55;
    s.userData = { dx: Math.cos(a) * r, dz: Math.sin(a) * r, dy: 0.5 + Math.random() * 3.2, size: 4.5 + Math.random() * 3 };
    sprites.push(s);
    group.add(s);
  }
  group.position.set(pos.x, 0, pos.z);
  scene.add(group);
  smokes.push({ x: pos.x, y: Math.max(1.2, pos.y), z: pos.z, born: time, until: time + SMOKE_TIME, group, sprites });
}
// Does a smoke cloud sit between a and b (Vector3s)? Used for bot sight and the minimap.
function smokeBlocks(a, b) {
  for (const s of smokes) {
    if (time - s.born < 0.5) continue;
    const abx = b.x - a.x, abz = b.z - a.z, len2 = abx * abx + abz * abz || 1;
    const t = clamp(((s.x - a.x) * abx + (s.z - a.z) * abz) / len2, 0, 1);
    if (Math.hypot(a.x + abx * t - s.x, a.z + abz * t - s.z) < SMOKE_R * 0.75) return true;
  }
  return false;
}

// ---- blasts (host/solo decides, everyone shows)
const blastRay = new THREE.Raycaster();
function clearLine(from, to) {
  const d = to.clone().sub(from), dist = d.length();
  blastRay.set(from, d.normalize());
  blastRay.far = dist;
  return blastRay.intersectObjects(worldMeshes, false).length === 0;
}
function detonate(n) {
  const owner = entById(n.owner);
  const p = n.pos;
  if (n.ty === 'frag') {
    for (const e of ents) {
      if (!e.alive) continue;
      const chest = new THREE.Vector3(e.pos.x, e.pos.y + 1.1, e.pos.z);
      const d = chest.distanceTo(p);
      if (d > 8 || !clearLine(p.clone().setY(p.y + 0.3), chest)) continue;
      damage(e, owner, Math.round(115 * Math.pow(1 - d / 8, 1.2)) * (e === owner ? 0.5 : 1), false, FEED_EXTRA.frag);
    }
  } else if (n.ty === 'flash') {
    for (const e of ents) {
      if (!e.alive) continue;
      const eye = new THREE.Vector3(e.pos.x, e.pos.y + 1.6, e.pos.z);
      const d = eye.distanceTo(p);
      if (d > 38 || !clearLine(p, eye)) continue;
      const fx_ = e === player ? camera.getWorldDirection(new THREE.Vector3()).x : -Math.sin(e.yaw);
      const fz_ = e === player ? camera.getWorldDirection(new THREE.Vector3()).z : -Math.cos(e.yaw);
      const to = Math.hypot(p.x - e.pos.x, p.z - e.pos.z) || 1;
      const facing = (fx_ * (p.x - e.pos.x) + fz_ * (p.z - e.pos.z)) / (to * (Math.hypot(fx_, fz_) || 1));
      const base = d < 12 ? 3.2 : 3.2 - (d - 12) * 0.07;
      const dur = Math.max(0.3, base * (facing > 0.5 ? 1 : facing > -0.2 ? 0.55 : 0.25));
      if (e === player) blind(dur);
      else if (e.human) hostEv({ to: e.id, k: 'blind', dur });
      else e.blind = Math.max(e.blind || 0, dur);
    }
  } else addSmoke(p);
  hostEv({ k: 'nb', id: n.id, ty: n.ty, p: [p.x, p.y, p.z] });
  nadeFx(n.ty, p);
}
function blind(dur) { blindT = Math.max(blindT, dur); blindMax = Math.max(blindMax, blindT); }
function nadeFx(ty, p) {
  const h = hear(p, 90);
  if (ty === 'frag') {
    burst(p, 0xffa040, 40, 0.2); burst(p, 0xffffff, 12, 0.1);
    sfx.shot(Math.max(0.2, h.vol * 1.6), 0.7, 0.55);
  } else if (ty === 'flash') {
    burst(p, 0xffffff, 30, 0.16);
    sfx.shot(Math.max(0.15, h.vol * 1.1), 2.6, 0.2);
    if (h.vol > 0.1) sfx.blip(3200, 0.5, 0.06 * h.vol, 'sine');
  } else sfx.shot(Math.max(0.1, h.vol * 0.5), 4, 0.5);
}
function removeNade(i) { scene.remove(nades[i].mesh); nades.splice(i, 1); }

function clearUtility() {
  while (nades.length) removeNade(0);
  while (smokes.length) { scene.remove(smokes[0].group); smokes.shift(); }
  blindT = 0;
}

function updateUtility(dt) {
  if (match.round !== utilRound) { utilRound = match.round; clearUtility(); }
  for (let i = nades.length - 1; i >= 0; i--) {
    const n = nades[i];
    nadeStep(n, dt / 2); nadeStep(n, dt / 2);
    n.mesh.position.copy(n.pos);
    n.mesh.rotation.x += dt * 9;
    n.age += dt;
    n.fuse -= dt;
    if (!isClient() && n.fuse <= 0) { detonate(n); removeNade(i); }
    else if (n.age > 6) removeNade(i); // a joiner that never heard the blast
  }
  for (let i = smokes.length - 1; i >= 0; i--) {
    const s = smokes[i], age = time - s.born, left = s.until - time;
    if (left <= 0) { scene.remove(s.group); smokes.splice(i, 1); continue; }
    const grow = Math.min(1, age / 1.2), fade = Math.min(1, left / 2.5);
    for (const sp of s.sprites) {
      const u = sp.userData;
      sp.position.set(u.dx * grow, u.dy * (0.4 + 0.6 * grow), u.dz * grow);
      sp.scale.setScalar(u.size * (0.5 + 0.5 * grow));
      sp.material.opacity = 0.9 * grow * fade;
    }
  }
}

function updateBlind(dt) {
  if (blindT > 0) blindT -= dt; else blindMax = 1;
  const o = blindT <= 0 ? 0 : Math.min(1, blindT / (blindMax * 0.45));
  const el = $('blind');
  if (el.dataset.o !== String(Math.round(o * 50))) { el.dataset.o = String(Math.round(o * 50)); el.style.opacity = o; }
}

// Bots: now and then lob a frag or flash at an enemy they can see.
function botNades(b, tgt, dist) {
  const ai = b.ai;
  if (time < (ai.nextNade || 0) || !b.nades || dist < 8 || dist > 30) return;
  const ty = b.nades.frag > 0 && (b.nades.flash <= 0 || Math.random() < 0.5) ? 'frag' : b.nades.flash > 0 ? 'flash' : null;
  ai.nextNade = time + 5 + Math.random() * 6;
  if (!ty || Math.random() > 0.45) return;
  const dir = new THREE.Vector3(tgt.pos.x - b.pos.x, 0, tgt.pos.z - b.pos.z).normalize();
  dir.y = 0.18 + dist * 0.012;
  hostThrow(b, ty, dir.normalize());
}

// ---------------------------------------------------------------- minimap and callouts
const MM = 176, mmCv = $('minimap'), mmCtx = mmCv.getContext('2d');
mmCv.width = mmCv.height = MM * 2;
const mmK = MM / MAP.size;
const mmX = (x) => (x + MAP.size / 2) * mmK, mmY = (z) => (z + MAP.size / 2) * mmK;
const CALLOUTS = MAP.callouts || [
  ...MAP.sites.map((s) => ({ name: `${s.name} Site`, x: s.x, z: s.z })),
  { name: 'Mid', x: 0, z: 0 },
  ...['a', 'b'].map((k) => {
    const sp = MAP.teamSpawns?.[k] || [[0, 0, 0]];
    return { name: k === 'a' ? 'Blue Spawn' : 'Red Spawn', x: sp.reduce((t, s) => t + s[0], 0) / sp.length, z: sp.reduce((t, s) => t + s[2], 0) / sp.length };
  }),
];
const calloutAt = (x, z) => {
  let best = '', bd = Infinity;
  for (const c of CALLOUTS) { const d = Math.hypot(c.x - x, c.z - z); if (d < bd) { bd = d; best = c.name; } }
  return best;
};
const mmStatic = (() => {
  const c = document.createElement('canvas'); c.width = c.height = MM * 2;
  const g = c.getContext('2d'); g.scale(2, 2);
  g.fillStyle = 'rgba(6,9,18,0.82)'; g.fillRect(0, 0, MM, MM);
  for (const b of MAP.boxes) {
    if (b.t === 'barrier') g.fillStyle = '#4a5566';
    else g.fillStyle = b.h >= 3 ? '#8c96a8' : b.h > 1.5 ? '#667286' : '#465266';
    g.fillRect(mmX(b.x - b.w / 2), mmY(b.z - b.d / 2), Math.max(1, b.w * mmK), Math.max(1, b.d * mmK));
  }
  for (const s of MAP.sites) {
    g.strokeStyle = '#ffb347'; g.fillStyle = 'rgba(255,179,71,0.18)'; g.lineWidth = 1;
    g.beginPath(); g.arc(mmX(s.x), mmY(s.z), s.r * mmK, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = '#ffd89a'; g.font = '700 11px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(s.name, mmX(s.x), mmY(s.z) + 0.5);
  }
  if (MAP.callouts) { // area names, faint
    g.fillStyle = 'rgba(190,210,255,0.55)'; g.font = '500 7px sans-serif'; g.textAlign = 'center';
    for (const c of MAP.callouts) if (!/Site/.test(c.name)) g.fillText(c.name.toUpperCase(), mmX(c.x), mmY(c.z));
  }
  g.strokeStyle = 'rgba(0,229,255,0.6)'; g.lineWidth = 1.5; g.strokeRect(0.75, 0.75, MM - 1.5, MM - 1.5);
  return c;
})();
let mmAcc = 0, mmSeen = new Set(), seenAcc = 0;
function updateMinimap(dt) {
  const show = started && player.alive !== undefined;
  mmCv.style.display = show ? 'block' : 'none';
  $('callout').style.display = show ? 'block' : 'none';
  if (!show) return;
  mmAcc += dt;
  if (mmAcc < 0.07) return;
  mmAcc = 0;
  const mates = M.teams ? ents.filter((e) => e !== player && e.alive && e.team === player.team) : [];
  seenAcc += 0.07;
  if (seenAcc > 0.2) { // which enemies does my team see? (line of sight from me or a teammate, not through smoke)
    seenAcc = 0;
    mmSeen = new Set();
    const viewers = player.alive ? [player, ...mates] : mates;
    for (const e of ents) {
      if (e === player || !e.alive || (M.teams && e.team === player.team)) continue;
      for (const v of viewers) {
        const a = new THREE.Vector3(v.pos.x, v.pos.y + 1.6, v.pos.z), b = new THREE.Vector3(e.pos.x, e.pos.y + 1.2, e.pos.z);
        if (a.distanceTo(b) < 60 && !smokeBlocks(a, b) && canSee(v, e)) { mmSeen.add(e); break; }
      }
    }
  }
  const g = mmCtx;
  g.setTransform(2, 0, 0, 2, 0, 0);
  g.clearRect(0, 0, MM, MM);
  g.drawImage(mmStatic, 0, 0, MM, MM);
  for (const s of smokes) {
    g.fillStyle = 'rgba(200,206,216,0.6)';
    g.beginPath(); g.arc(mmX(s.x), mmY(s.z), SMOKE_R * mmK, 0, Math.PI * 2); g.fill();
  }
  for (const pg of pings) { // pings: a yellow diamond
    const x = mmX(pg.pos.x), y = mmY(pg.pos.z);
    g.fillStyle = '#ffd23c'; g.beginPath(); g.moveTo(x, y - 5); g.lineTo(x + 4, y); g.lineTo(x, y + 5); g.lineTo(x - 4, y); g.closePath(); g.fill();
  }
  for (const n of nades) { g.fillStyle = '#' + NADES[n.ty].color.toString(16).padStart(6, '0'); g.fillRect(mmX(n.pos.x) - 1.5, mmY(n.pos.z) - 1.5, 3, 3); }
  const dot = (x, z, col, r = 3) => { g.fillStyle = col; g.beginPath(); g.arc(mmX(x), mmY(z), r, 0, Math.PI * 2); g.fill(); };
  if (mode === 'demo') {
    if (charge.state === 'planted') {
      const pulse = 4 + Math.abs(Math.sin(time * 6)) * 3;
      g.strokeStyle = '#ff5a3c'; g.lineWidth = 1.5; g.beginPath(); g.arc(mmX(charge.pos.x), mmY(charge.pos.z), pulse, 0, Math.PI * 2); g.stroke();
      dot(charge.pos.x, charge.pos.z, '#ff5a3c', 2.5);
    } else if (charge.state === 'dropped') dot(charge.pos.x, charge.pos.z, '#ffd23c', 3.5);
    if (charge.state === 'carried' && charge.carrier && charge.carrier.alive && player.team === match.attack) dot(charge.carrier.pos.x, charge.carrier.pos.z, '#ffd23c', 3.5);
  }
  for (const e of mates) { // teammates
    dot(e.pos.x, e.pos.z, '#4fc3ff', 3.2);
    g.strokeStyle = '#4fc3ff'; g.lineWidth = 1; g.beginPath();
    g.moveTo(mmX(e.pos.x), mmY(e.pos.z)); g.lineTo(mmX(e.pos.x - Math.sin(e.yaw) * 2.6), mmY(e.pos.z - Math.cos(e.yaw) * 2.6)); g.stroke();
  }
  for (const e of mmSeen) if (e.alive) dot(e.pos.x, e.pos.z, '#ff4d5e', 3.4); // enemies someone can see
  if (player.alive) { // you: an arrow pointing where you look
    const px = mmX(player.pos.x), py = mmY(player.pos.z), a = Math.atan2(-Math.cos(player.yaw), -Math.sin(player.yaw));
    g.save(); g.translate(px, py); g.rotate(a);
    g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(6, 0); g.lineTo(-4, 3.6); g.lineTo(-2, 0); g.lineTo(-4, -3.6); g.closePath(); g.fill();
    g.restore();
  }
  const cname = calloutAt(player.pos.x, player.pos.z);
  if ($('callout').textContent !== cname) $('callout').textContent = cname;
}

// Grenade counts, bottom right above the ammo.
let lastNadeHud = '';
function updateNadeHud() {
  const on = started && player.alive && player.nades && NADE_IDS.some((k) => player.nades[k] > 0 || economyOn());
  const keyOf = { flash: settings.binds.flash, smoke: settings.binds.smoke, frag: settings.binds.frag };
  const html = on ? NADE_IDS.map((k) => `<span class="${player.nades[k] > 0 ? 'has' : ''}"><b>${keyName(keyOf[k])}</b> ${NADES[k].tag} ${player.nades[k] || 0}</span>`).join('') : '';
  if (html !== lastNadeHud) { lastNadeHud = html; $('nades').innerHTML = html; }
}

// ---------------------------------------------------------------- pings and quick chat (teammates only in team modes)
const CHAT_LINES = ['Rush A', 'Rush B', 'Enemy spotted', 'Need help', 'Hold here', 'Fall back', 'Nice shot!', 'Thanks!'];
const CHAT_WITH_PLACE = new Set([2, 3, 4, 5]); // these add where you are
let chatOpen = false, sayCool = 0;
$('chatmenu').innerHTML = `<h3>QUICK CHAT <span>press a number</span></h3>` +
  CHAT_LINES.map((t, i) => `<div><span class="k">${i + 1}</span>${t}</div>`).join('');
function toggleChat(force) {
  chatOpen = !!(force ?? !chatOpen);
  if (chatOpen) toggleBuyMenu(false);
  $('chatmenu').style.display = chatOpen ? 'block' : 'none';
}

// You say something or ping a spot. The host decides who hears it.
function sendSay(kind, text, p) {
  if (time < sayCool) return;
  sayCool = time + 0.8;
  const payload = { kind, text: String(text).slice(0, 48), p: p || null };
  if (isClient()) {
    netSend({ t: 'say', ...payload });
    showSay({ ...payload, by: player.name, color: player.color }); // your own is shown right away
  } else deliverSay(player, payload);
}
function sayLine(i) {
  const place = CHAT_WITH_PLACE.has(i) ? ` · ${calloutAt(player.pos.x, player.pos.z)}` : '';
  sendSay('msg', CHAT_LINES[i] + place);
}
function pingLook() {
  if (!player.alive) return;
  syncCamera();
  raycaster.set(camera.position, camera.getWorldDirection(new THREE.Vector3()));
  raycaster.far = 220;
  const hit = raycaster.intersectObjects(worldMeshes, false)[0];
  if (!hit) return;
  const p = hit.point;
  sendSay('ping', calloutAt(p.x, p.z), [p.x, p.y, p.z]);
}

// Host/solo: send to the right people. Joiners who sent it already showed it themselves.
function deliverSay(sender, pl) {
  const out = { kind: pl.kind, text: pl.text, p: pl.p, by: sender.name, color: sender.color };
  const sameTeam = (e) => !M.teams || e.team === sender.team;
  const audience = pl.kind === 'ping' && !M.teams ? [sender] : ents.filter((e) => (e === player || e.human) && sameTeam(e));
  for (const e of audience) {
    if (e === player) showSay(out);
    else if (e !== sender) hostEv({ to: e.id, k: 'say', ...out });
  }
}

const chatLog = $('chatlog');
function showSay(m) {
  const d = document.createElement('div');
  const col = hex(m.color ?? 0xffffff);
  d.innerHTML = m.kind === 'ping'
    ? `<b style="color:${col}">${escapeHtml(m.by)}</b> pinged <i>${escapeHtml(m.text)}</i>`
    : `<b style="color:${col}">${escapeHtml(m.by)}</b>: ${escapeHtml(m.text)}`;
  chatLog.append(d);
  while (chatLog.children.length > 5) chatLog.firstChild.remove();
  setTimeout(() => d.remove(), 7000);
  sfx.blip(m.kind === 'ping' ? 1250 : 900, 0.07, 0.1, 'sine');
  if (m.kind === 'ping' && Array.isArray(m.p)) addPingMarker(m);
}

// 3D marker: a diamond with the sender's name and distance. Drawn over walls so everyone can find it.
const pings = [];
function drawPing(pg, dist) {
  const g = pg.ctx, c = pg.canvas;
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = pg.col; g.strokeStyle = '#000'; g.lineWidth = 6;
  g.beginPath(); g.moveTo(128, 6); g.lineTo(152, 34); g.lineTo(128, 62); g.lineTo(104, 34); g.closePath(); g.stroke(); g.fill();
  g.font = '700 26px sans-serif'; g.textAlign = 'center'; g.lineWidth = 5;
  const t = `${pg.name} · ${dist}m`;
  g.strokeText(t, 128, 92); g.fillStyle = '#fff'; g.fillText(t, 128, 92);
  pg.tex.needsUpdate = true;
}
function addPingMarker(m) {
  while (pings.length >= 5) { scene.remove(pings[0].sprite); pings.shift(); }
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 104;
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
  sprite.renderOrder = 999;
  sprite.scale.set(0.2, 0.081, 1);
  const pos = new THREE.Vector3(m.p[0], m.p[1] + 0.9, m.p[2]);
  sprite.position.copy(pos);
  scene.add(sprite);
  const pg = { sprite, canvas, ctx: canvas.getContext('2d'), tex, pos, until: time + 8, born: time, col: hex(m.color ?? 0xffd23c), name: m.by, lastDist: -1 };
  pings.push(pg);
}
function updatePings() {
  for (let i = pings.length - 1; i >= 0; i--) {
    const pg = pings[i];
    const left = pg.until - time;
    if (left <= 0 || time < pg.born) { scene.remove(pg.sprite); pings.splice(i, 1); continue; }
    const dist = Math.round(pg.pos.distanceTo(camera.position));
    if (dist !== pg.lastDist) { pg.lastDist = dist; drawPing(pg, dist); }
    pg.sprite.material.opacity = Math.min(1, left);
  }
}

function tick(dt) {
  // Online matches keep running while you're in the menu (everyone else is still playing).
  const running = started && (locked || net.role !== 'solo') && !testPause;
  updateAtmosphere(dt);

  if (running) {
    time += dt;
    if (!isClient()) updateMode(dt);
    updatePlayer(dt);
    handleFire();
    updateUtility(dt);
    for (const b of bots) updateBot(b, dt);
    if (!isClient()) for (const e of ents) if (!e.alive && time >= e.respawnAt) respawn(e);
    if (!isClient()) updatePickups();
    if (isHost()) hostNet(dt);
    else if (isClient()) clientNet(dt);
    gun.bloom = Math.max(0, gun.bloom - dt * 0.03);
    if (!player.alive) {
      const mate = spectateTarget();
      $('deathTimer').textContent = M.rounds
        ? `${mate ? `Spectating ${mate.name} · ` : ''}you'll be back next round`
        : isClient() ? 'Respawning...' : `Respawning in ${Math.max(0, player.respawnAt - time).toFixed(1)}s`;
    }
  }
  updateFx(dt);
  if (started) { updateModeHud(); updateChargeMesh(); updateEconomyHud(); if (running) footsteps(dt); }
  updateBlind(dt);
  updatePings();
  updateMinimap(dt);
  updateNadeHud();
  renderPickups(dt);
  updateHurt();
  netHudAcc += dt;
  if (netHudAcc > 0.5) {
    netHudAcc = 0;
    $('ping').textContent = net.role === 'solo' ? '' : `ROOM ${net.room} · PING ${net.ping} ms${isHost() ? ' · HOST' : ''}`;
  }

  // Bots
  for (const b of bots) {
    b.group.position.copy(b.pos);
    b.group.rotation.y = b.yaw;
    b.flash = Math.max(0, b.flash - dt);
    b.model.setFlash(b.flash > 0);
    if (b.alive) b.model.animate(dt, Math.hypot(b.vel.x, b.vel.z));
  }

  // Aim-down-sights zoom (right mouse)
  const wantZoom = running && gun.ads && player.alive && !gun.reloading && time >= gun.switchEnd && !W.melee;
  gun.zoom += ((wantZoom ? 1 : 0) - gun.zoom) * (1 - Math.exp(-14 * dt));
  if (gun.zoom < 0.001) gun.zoom = 0;
  const speed = Math.hypot(player.vel.x, player.vel.z);
  feel.speedFov += (clamp(speed / 7.2, 0, 1.7) * 3.2 - feel.speedFov) * (1 - Math.exp(-5 * dt));
  const fov = BASE_FOV + (W.adsFov - BASE_FOV) * gun.zoom + feel.speedFov * (1 - gun.zoom);
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  const scoped = !!W.scope && gun.zoom > 0.85;
  if (scoped !== scopedShown) {
    scopedShown = scoped;
    $('scope').style.display = scoped ? 'block' : 'none';
    $('crosshair').style.visibility = scoped ? 'hidden' : '';
  }

  // Camera
  if (player.grounded && speed > 1) bob += dt * speed * 1.6;
  const bobAmt = (player.grounded && !stance.sliding ? Math.min(speed / 7, 1.2) : 0) * (1 - gun.zoom * 0.8) * (1 - stance.crouch * 0.5);
  if (!started) {
    // Menu: slow cinematic orbit around the arena
    const a = uTime.value * 0.045;
    camera.position.set(Math.sin(a) * 24, 8.5 + Math.sin(a * 0.7) * 1.5, Math.cos(a) * 24);
    camera.lookAt(0, 3, 0);
  } else {
    syncCamera();
    const mate = !player.alive && M.rounds ? spectateTarget() : null;
    if (mate) {
      // Dead in Demolition: watch a living teammate from behind
      camera.position.set(mate.pos.x + Math.sin(mate.yaw) * 3.2, mate.pos.y + 2.3, mate.pos.z + Math.cos(mate.yaw) * 3.2);
      camera.lookAt(mate.pos.x, mate.pos.y + 1.3, mate.pos.z);
    } else if (!player.alive) {
      camera.position.y = player.pos.y + 0.5;
      camera.rotation.z = 0.35;
    } else {
      // Feel: head bob, a dip when landing, a slight lean when strafing
      const lateral = player.vel.x * Math.cos(player.yaw) - player.vel.z * Math.sin(player.yaw);
      feel.roll += (-lateral * 0.0035 - feel.roll) * (1 - Math.exp(-8 * dt));
      if (player.grounded && !feel.wasGrounded && feel.prevVy < -6) {
        feel.dip = Math.min(-feel.prevVy * 0.012, 0.16);
        sfx.step({ kind: 'land', vol: Math.min(0.7, -feel.prevVy * 0.05) });
      }
      feel.dip *= Math.exp(-7 * dt);
      camera.position.y += Math.sin(bob * 2) * 0.03 * bobAmt - feel.dip;
      feel.slideTilt += ((stance.sliding ? 0.09 : 0) - feel.slideTilt) * (1 - Math.exp(-10 * dt));
      camera.rotation.z = feel.roll + feel.slideTilt + Math.sin(bob) * 0.003 * bobAmt;
    }
    feel.wasGrounded = player.grounded;
    feel.prevVy = player.vel.y;
    if (feel.shake > 0.001) { // explosion shake
      camera.position.x += (Math.random() - 0.5) * feel.shake * 0.25;
      camera.position.y += (Math.random() - 0.5) * feel.shake * 0.25;
      feel.shake *= Math.exp(-3 * dt);
    }
  }

  // Viewmodel: bob, recoil, sway, reload, weapon switch, aiming
  gun.kick = Math.max(0, gun.kick - dt * 12);
  swayX *= Math.exp(-10 * dt); swayY *= Math.exp(-10 * dt);
  let reloadAnim = 0;
  if (gun.reloading) reloadAnim = Math.sin(clamp(1 - (gun.reloadEnd - time) / (W.reload / 1000), 0, 1) * Math.PI);
  const switchAnim = clamp((gun.switchEnd - time) / 0.35, 0, 1);
  vmPos.copy(VM_BASE).lerp(VM_ADS, gun.zoom);
  vm.visible = started && player.alive && !scoped;
  vm.position.set(
    vmPos.x + Math.sin(bob) * 0.012 * bobAmt - clamp(swayX, -0.04, 0.04),
    vmPos.y + Math.abs(Math.cos(bob)) * 0.01 * bobAmt + clamp(swayY, -0.03, 0.03) - reloadAnim * 0.12 - switchAnim * 0.25,
    vmPos.z + gun.kick * 0.05,
  );
  vm.rotation.set(gun.kick * 0.06 - reloadAnim * 0.7 - switchAnim * 0.8, 0, reloadAnim * 0.3);
  // Sprint pose: gun lowered and turned inwards. Slide: gun tilted.
  const sp = stance.sprint * (1 - gun.zoom);
  vm.position.x -= sp * 0.06;
  vm.position.y -= sp * 0.06;
  vm.rotation.x -= sp * 0.35;
  vm.rotation.y += sp * 0.7;
  vm.rotation.z += feel.slideTilt * 2.5;
  // Knife swing: a side-to-side slash, or a forward stab for the heavy attack
  if (gun.swingT > 0) {
    gun.swingT = Math.max(0, gun.swingT - dt);
    const s = Math.sin((1 - gun.swingT / gun.swingMax) * Math.PI);
    if (gun.swingHeavy) {
      vm.position.z -= s * 0.22;
      vm.position.x -= s * 0.08;
      vm.rotation.x -= s * 0.5;
    } else {
      vm.position.x -= s * 0.14 * gun.swingSide;
      vm.rotation.y += s * 0.9 * gun.swingSide;
      vm.rotation.z += s * 0.6 * gun.swingSide;
    }
  }
  gun.flashT -= dt;
  muzzleFlash.visible = gun.flashT > 0;
  muzzleFlash.rotation.z = Math.random() * Math.PI;
  muzzleFlash.scale.setScalar(W.id === 'shotgun' ? 1.8 : W.id === 'sniper' ? 1.5 : 1);
  muzzleLight.intensity = gun.flashT > 0 ? 8 : 0;
}

if (TEST) {
  // Advance the game by n frames without needing the page to be visible.
  window.__arena.step = (n = 60) => { for (let i = 0; i < n; i++) tick(1 / 60); composer.render(); };
}

// Initial state: show the arena behind the menu
setupMatch();
started = false;
try { portraits = renderPortraits(); } catch (err) { console.warn('Portraits failed', err); }
buildPicker();
buildLooks();
buildMapPicker();
buildModePicker();
updateOnlineUI();
openMenu();
updateHud();
frame();
