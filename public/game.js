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
import {
  setMaxAnisotropy, concrete, asphalt, container, crate, steelPlates, hazard, gunmetal, polymer, walnut, boxUV,
} from './textures.js';
import { ARENA, BOXES, SPAWNS, WEAPONS, MAX_HP, RESPAWN_MS } from './map.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// ---------------------------------------------------------------- settings
const settings = { name: 'Player', sens: 1, bots: 3, difficulty: 'normal', quality: 'low', volume: 0.7, avatar: 'kaze' };
try { Object.assign(settings, JSON.parse(localStorage.getItem('neon-arena') || '{}')); } catch {}
// Graphics now default to Low (smoother). Reset older saves that stored High by default.
if (settings.qualityV !== 2) { settings.quality = 'low'; settings.qualityV = 2; }
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
renderer.toneMappingExposure = 1.0;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const FOG_COLOR = new THREE.Color().setRGB(0.2, 0.16, 0.22); // dusk haze
scene.background = FOG_COLOR.clone();
scene.fog = new THREE.FogExp2(FOG_COLOR, 0.012);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;
const sky = makeSky();
scene.add(sky);

const BASE_FOV = 78;
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
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.35, 0.4, 0.9);
if (!HIGH) { // Low: compute the glow at half resolution (4x cheaper, looks almost the same)
  const setBloomSize = bloom.setSize.bind(bloom);
  bloom.setSize = (w, h) => setBloomSize(Math.round(w / 2), Math.round(h / 2));
}
composer.addPass(bloom);
composer.addPass(new OutputPass());
const grade = makeGradePass();
composer.addPass(grade);

// ---------------------------------------------------------------- lights
// Dusk: a low warm sun with long shadows, cool sky light, warm street lamps.
scene.add(new THREE.HemisphereLight(0x8a9ad0, 0x3a2a24, 0.9));
const sun = new THREE.DirectionalLight(0xffb27a, 1.9);
sun.position.set(-45, 22, -30);
sun.castShadow = true;
sun.shadow.mapSize.set(HIGH ? 2048 : 1024, HIGH ? 2048 : 1024);
Object.assign(sun.shadow.camera, { left: -48, right: 48, top: 48, bottom: -48, near: 1, far: 160 });
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.03;
scene.add(sun);
const centerLight = new THREE.PointLight(0xff4fb0, 14, 16, 2);
centerLight.position.set(0, 5, 0);
scene.add(centerLight);

// ---------------------------------------------------------------- world
const colliders = [];   // AABBs for movement
const worldMeshes = []; // meshes bullets can hit
const animated = [];    // decorations with an update(t, dt)

// Procedural surface textures (see textures.js)
setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());
const TEX = {
  concrete: concrete({ seed: 1 }),
  wall: concrete({ seed: 2, base: [122, 120, 118], seams: true }),
  container: container(),
  crate: crate(),
  steel: steelPlates(),
  hazard: hazard(),
};
// How many metres one texture covers, per surface (crates show one texture per face).
const TILE = { concrete: 3, barrier: 2, wall: 6, container: 2.6, steel: 2.5 };
const surfaceCache = new Map();
function surface(type, paint) {
  const key = type + ':' + (paint ?? '');
  if (!surfaceCache.has(key)) {
    const t = TEX[type === 'barrier' ? 'concrete' : type];
    surfaceCache.set(key, new THREE.MeshStandardMaterial({
      map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, roughness: 1,
      metalness: type === 'container' || type === 'steel' ? 0.45 : 0,
      color: paint ?? (type === 'container' ? 0x9a3f2c : 0xffffff),
    }));
  }
  return surfaceCache.get(key);
}
const hazardMat = new THREE.MeshStandardMaterial({ map: TEX.hazard.map, roughness: 0.8 });

// Ground: wet asphalt with painted lines; glossy patches pick up the lamp light.
const ground = asphalt();
for (const t of Object.values(ground)) t.repeat.set(4, 4);
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(ARENA.size, ARENA.size),
  new THREE.MeshStandardMaterial({ ...ground, roughness: 1, metalness: 0, normalScale: new THREE.Vector2(0.6, 0.6), envMapIntensity: 0.25 }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
worldMeshes.push(floor);

const neonMat = (c, k) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k) });

function addBox(b, type = b.t || 'concrete', paint = b.p) {
  const { x, y, z, w, h, d } = b;
  const geo = new THREE.BoxGeometry(w, h, d);
  if (type !== 'crate') boxUV(geo, w, h, d, TILE[type]);
  const m = new THREE.Mesh(geo, surface(type, paint));
  m.position.set(x, y + h / 2, z);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
  worldMeshes.push(m);
  colliders.push({ minX: x - w / 2, maxX: x + w / 2, minY: y, maxY: y + h, minZ: z - d / 2, maxZ: z + d / 2 });

  if (type === 'barrier') { // yellow/black hazard band on both long sides
    const long = w > d;
    const sg = new THREE.BoxGeometry(long ? w * 0.98 : d + 0.012, 0.2, long ? d + 0.012 : d * 0.98);
    boxUV(sg, long ? w : d + 0.012, 0.2, long ? d + 0.012 : d, 0.6);
    const stripe = new THREE.Mesh(sg, hazardMat);
    stripe.position.set(x, y + h - 0.25, z);
    scene.add(stripe);
  }
  if (type === 'concrete' && h > 2 && b.c) { // a thin neon accent line near the top
    const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.035, d + 0.02), neonMat(b.c, 1.2));
    band.position.set(x, y + h - 0.3, z);
    scene.add(band);
  }
  if (type === 'container') { // corner posts and top rails
    const frame = surface('steel', 0x2b2d31);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, h + 0.01, 0.16), frame);
      post.position.set(x + sx * (w / 2 - 0.07), y + h / 2, z + sz * (d / 2 - 0.07));
      scene.add(post);
    }
  }
  return m;
}
BOXES.forEach((b) => addBox(b));

// Outer walls: concrete panels with a thin cool accent light along the top
const S = ARENA.size / 2, WH = ARENA.wallHeight;
for (const [x, z, w, d] of [[0, -S - 0.5, ARENA.size + 2, 1], [0, S + 0.5, ARENA.size + 2, 1], [-S - 0.5, 0, 1, ARENA.size], [S + 0.5, 0, 1, ARENA.size]]) {
  addBox({ x, y: 0, z, w, h: WH, d }, 'wall');
  const strip = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.05, d + 0.02), neonMat(0x9fd8ff, 1.3));
  strip.position.set(x, WH - 0.5, z);
  scene.add(strip);
}

// Street lamps: warm sodium light, one cooler LED lamp
for (const [x, z, c] of [[19.5, 19.5, 0xffb070], [-19.5, -19.5, 0xffb070], [19.5, -19.5, 0xdfe8ff], [-19.5, 19.5, 0xffb070]]) {
  const lamp = makeLamp(x, z, c);
  scene.add(lamp.group, lamp.light);
  colliders.push(lamp.collider);
  worldMeshes.push(lamp.pole);
}

// Neon signs on the inside of the walls (kept, but toned down)
for (const [text, color, wall, along, width] of [
  ['NEON ARENA', 0xff2bd6, 'N', 0, 9], ['ARC-7', 0x00e5ff, 'N', -19, 5], ['OPEN 24H', 0xff8a00, 'S', -14, 6],
  ['VOLT//', 0x7cff4f, 'S', 13, 5], ['SECTOR 9', 0x8b5cff, 'E', 9, 6], ['RAIN CITY', 0x00e5ff, 'W', -9, 6.5],
]) {
  const sign = makeSign(text, color, width);
  const inset = S - 0.04;
  if (wall === 'N') { sign.position.set(along, 4.6, -inset); }
  if (wall === 'S') { sign.position.set(along, 4.6, inset); sign.rotation.y = Math.PI; }
  if (wall === 'E') { sign.position.set(inset, 4.6, along); sign.rotation.y = -Math.PI / 2; }
  if (wall === 'W') { sign.position.set(-inset, 4.6, along); sign.rotation.y = Math.PI / 2; }
  scene.add(sign);
  animated.push(sign);
}

// Hologram above the center bunker
const hologram = makeHologram();
scene.add(hologram);
animated.push(hologram);

// Weather
const rain = makeRain(HIGH ? 2500 : 1000);
const ripples = makeRipples(HIGH ? 200 : 90);
scene.add(rain, ripples);

// Backdrop: a city skyline at dusk with lit windows and blinking aviation lights
(function backdrop() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 64, 128);
  for (let y = 4; y < 128; y += 8) for (let x = 4; x < 64; x += 8) {
    if (Math.random() < 0.35) { g.fillStyle = ['#ffcf8a', '#ffe2b0', '#9fd0ff'][Math.floor(Math.random() * 3)]; g.fillRect(x, y, 4, 4); }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 5);
  const beacons = [];
  for (let i = 0; i < 70; i++) {
    const a = Math.random() * Math.PI * 2, r = rand(50, 120);
    const w = rand(6, 14), h = rand(12, 75), d = rand(6, 14);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), trimMaterial({
      half: new THREE.Vector3(w / 2, h / 2, d / 2), trim: 0x9fb4ff, intensity: 0.15, width: 0.2, band: false,
      color: 0x1c1e26, roughness: 0.8, emissiveMap: tex, emissiveIntensity: 0.45,
    }));
    m.position.set(Math.cos(a) * r, h / 2 - 2, Math.sin(a) * r);
    scene.add(m);
    if (h > 45) {
      const b = glowSprite(0xff2040, 2.2, 1.5);
      b.position.set(m.position.x, h - 1.5, m.position.z);
      b.userData.phase = Math.random() * 6;
      scene.add(b);
      beacons.push(b);
    }
  }
  animated.push({ userData: { update: (t) => {
    for (const b of beacons) b.material.opacity = Math.sin(t * 2 + b.userData.phase) > 0.6 ? 1 : 0.05;
  } } });
})();

function updateAtmosphere(dt) {
  uTime.value += dt;
  const t = uTime.value;
  sky.position.copy(camera.position);
  rain.userData.update(camera);
  ripples.userData.update(camera);
  for (const a of animated) a.userData.update(t, dt);
  centerLight.intensity = 14 + Math.sin(t * 1.7) * 3;
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

// ---------------------------------------------------------------- entities
const player = {
  name: settings.name, color: avatarById(settings.avatar).color, isPlayer: true,
  pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0,
  hp: MAX_HP, alive: true, grounded: false, kills: 0, deaths: 0, streak: 0, respawnAt: 0, killedBy: null,
};
const BOT_NAMES = ['Viper', 'Nova', 'Rook', 'Echo', 'Blitz', 'Ghost', 'Jinx', 'Raven'];
const BOT_COLORS = [0xff2bd6, 0xff8a00, 0x7cff4f, 0x8b5cff, 0xffe600, 0xff4f6d, 0x4fa3ff];
let bots = [];
let ents = [player];

// Bots use the avatars you did not pick first, then repeat with other names and colors.
function makeBot(i) {
  const order = [...AVATARS.filter((a) => a.id !== settings.avatar), avatarById(settings.avatar)];
  const av = order[i % order.length];
  const unique = i < order.length && av.id !== settings.avatar;
  const color = unique ? av.color : BOT_COLORS[i % BOT_COLORS.length];
  const name = unique ? av.name : BOT_NAMES[i % BOT_NAMES.length];
  const model = makeCharacter(color, name, av.id);
  const b = {
    name, color, isPlayer: false, ...model,
    pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0,
    hp: MAX_HP, alive: true, grounded: false, kills: 0, deaths: 0, respawnAt: 0, flash: 0,
    ai: { target: null, aggro: null, aggroT: 0, react: 0, nextShot: 0, scan: 0, goal: null,
      strafe: 1, strafeT: 0, stuckT: 0, lastPos: new THREE.Vector3() },
  };
  b.body.userData.ent = b;
  b.head.userData.ent = b;
  return b;
}

function pickSpawn(self) {
  let best = SPAWNS[0], bestScore = -1;
  for (const s of SPAWNS) {
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
  const s = pickSpawn(e);
  e.pos.set(s[0], s[1], s[2]);
  e.vel.set(0, 0, 0);
  e.yaw = Math.atan2(s[0], s[2]); // face the middle
  e.hp = MAX_HP;
  e.alive = true;
  if (e.isPlayer) {
    e.pitch = 0;
    refillAmmo();
    Object.assign(stance, { crouch: 0, sliding: false, slideT: 0, sprinting: false, sprint: 0 });
    e.height = H;
    e.crouching = false;
    gun.zoom = 0;
    equip(W.id, true);
    $('death').style.display = 'none';
    updateHud();
  } else {
    // Bots pick a weapon each life (weights in BOT_LOADOUT).
    let r = Math.random(), pick = 'rifle';
    for (const [id, w] of BOT_LOADOUT) { if (r < w) { pick = id; break; } r -= w; }
    e.weapon = WEAPONS[pick];
    e.gunMesh.scale.z = { sniper: 1.6, shotgun: 0.8, pistol: 0.45, cannon: 0.6 }[pick] || 1;
    e.gunMesh.scale.x = e.gunStrip.scale.x = e.weapon.id === 'shotgun' ? 1.6 : 1;
    e.gunStrip.material.color.set(e.weapon.color).multiplyScalar(2.2);
    e.group.visible = true;
    Object.assign(e.ai, { target: null, aggro: null, goal: null, react: 0 });
    e.ai.lastPos.copy(e.pos);
  }
}

function setupMatch() {
  for (const b of bots) scene.remove(b.group);
  bots = Array.from({ length: settings.bots }, (_, i) => makeBot(i));
  ents = [player, ...bots];
  for (const e of ents) { e.kills = 0; e.deaths = 0; e.alive = false; }
  player.streak = 0;
  for (const e of ents) respawn(e);
  $('feed').innerHTML = '';
  renderScores();
}

// ---------------------------------------------------------------- combat
const raycaster = new THREE.Raycaster();
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();

function canSee(from, to) {
  const a = tmpV.set(from.pos.x, from.pos.y + EYE, from.pos.z);
  const b = tmpV2.set(to.pos.x, to.pos.y + 1.2, to.pos.z);
  const dist = a.distanceTo(b);
  raycaster.set(a, b.sub(a).normalize());
  raycaster.far = dist;
  return raycaster.intersectObjects(worldMeshes, false).length === 0;
}

function damage(target, attacker, amount, head, weapon) {
  if (!target.alive) return;
  target.hp = Math.max(0, target.hp - amount);
  if (target.isPlayer) {
    flash($('vignette'), 0.9);
    updateHud();
  } else {
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
  victim.deaths++;
  if (killer && killer !== victim) killer.kills++;
  victim.respawnAt = time + RESPAWN_MS / 1000;
  burst(victim.pos.clone().setY(victim.pos.y + 1), victim.color, 40, 0.12);
  addFeed(killer, victim, head, weapon);
  if (victim.isPlayer) {
    victim.killedBy = killer;
    gun.ads = false;
    $('death').style.display = 'flex';
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
const sfx = (() => {
  let ctx, master, noise;
  const init = () => {
    if (ctx) return ctx;
    ctx = new AudioContext();
    master = ctx.createGain(); master.gain.value = 0.7 * settings.volume; master.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate * 0.8, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    ambience();
    return ctx;
  };
  // Background: steady rain plus a low, slowly breathing city hum.
  const ambience = () => {
    const long = ctx.createBuffer(2, ctx.sampleRate * 4, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = long.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < d.length; i++) { last = last * 0.6 + (Math.random() * 2 - 1) * 0.4; d[i] = last; }
    }
    const rainSrc = ctx.createBufferSource(); rainSrc.buffer = long; rainSrc.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 400;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4500;
    const rainGain = ctx.createGain(); rainGain.gain.value = 0.09;
    rainSrc.connect(hp).connect(lp).connect(rainGain).connect(master);
    rainSrc.start();
    const humGain = ctx.createGain(); humGain.gain.value = 0.035;
    const humLp = ctx.createBiquadFilter(); humLp.type = 'lowpass'; humLp.frequency.value = 220;
    for (const f of [55, 55.35, 82.4]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      o.connect(humLp); o.start();
    }
    humLp.connect(humGain).connect(master);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.015;
    lfo.connect(lfoGain).connect(humGain.gain); lfo.start();
  };
  return {
    init,
    setVolume(v) { if (master) master.gain.value = 0.7 * v; },
    // len = how long the bang rings out (short for rifle, long for sniper)
    shot(vol = 1, pitch = 1, len = 0.14) {
      if (!ctx || vol < 0.02) return;
      const t = ctx.currentTime;
      const n = ctx.createBufferSource(); n.buffer = noise; n.playbackRate.value = pitch;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass';
      f.frequency.setValueAtTime(5000 * pitch, t); f.frequency.exponentialRampToValueAtTime(400, t + len * 0.85);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.35 * vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
      n.connect(f).connect(g).connect(master); n.start(t); n.stop(t + len + 0.06);
      const o = ctx.createOscillator(); o.frequency.setValueAtTime(160 * pitch, t); o.frequency.exponentialRampToValueAtTime(45, t + len * 0.7);
      const og = ctx.createGain(); og.gain.setValueAtTime(0.4 * vol, t); og.gain.exponentialRampToValueAtTime(0.001, t + len * 0.85);
      o.connect(og).connect(master); o.start(t); o.stop(t + len);
    },
    weapon(w, vol = 1) {
      if (w.id === 'shotgun') this.shot(vol * 1.15, rand(0.62, 0.7), 0.26);
      else if (w.id === 'sniper') { this.shot(vol * 1.2, rand(1.25, 1.35), 0.45); this.blip(2400, 0.05, 0.06 * vol, 'sawtooth'); }
      else if (w.id === 'pistol') this.shot(vol * 0.7, rand(1.3, 1.4), 0.1);
      else if (w.id === 'cannon') { this.shot(vol * 1.25, rand(0.82, 0.88), 0.34); this.blip(70, 0.12, 0.25 * vol, 'sine'); }
      else this.shot(vol * 0.9, rand(0.95, 1.05), 0.14);
    },
    whoosh(heavy) {
      if (!ctx) return;
      const t = ctx.currentTime, len = heavy ? 0.3 : 0.18;
      const n = ctx.createBufferSource(); n.buffer = noise;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.5;
      f.frequency.setValueAtTime(700, t); f.frequency.exponentialRampToValueAtTime(heavy ? 2200 : 3200, t + len);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, t); g.gain.exponentialRampToValueAtTime(0.25, t + len * 0.4);
      g.gain.exponentialRampToValueAtTime(0.001, t + len);
      n.connect(f).connect(g).connect(master); n.start(t); n.stop(t + len + 0.05);
    },
    blip(freq, dur = 0.06, vol = 0.2, type = 'square') {
      if (!ctx) return;
      const t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
      const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.02);
    },
  };
})();

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
{ // Pulse Rifle: modern carbine (cyan accent)
  const g = new THREE.Group(), accent = glowMat(0x00e5ff, 0.9);
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
  const g = new THREE.Group(), accent = glowMat(0xff8a00, 0.9);
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
  const g = new THREE.Group(), accent = glowMat(0xff2bd6, 0.9);
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
  const g = new THREE.Group(), accent = glowMat(0x7cff4f, 1);
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
  const g = new THREE.Group(), accent = glowMat(0xffe600, 1);
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
for (const g of Object.values(models)) { g.visible = false; vm.add(g); }

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
  ammo: {}, reloading: false, reloadEnd: 0, nextFire: 0, bloom: 0, kick: 0, flashT: 0,
  switchEnd: 0, ads: false, zoom: 0, shotHeld: false,
  swingT: 0, swingMax: 1, swingSide: 1, swingHeavy: false, heavyHeld: false, // knife
};
function refillAmmo() {
  for (const w of WEAPON_LIST) gun.ammo[w.id] = w.mag;
  gun.reloading = false;
}
refillAmmo();

function equip(id, instant = false) {
  if (!WEAPONS[id] || (W.id === id && !instant)) return;
  if (W.id !== id) prevWeapon = W.id;
  W = WEAPONS[id];
  gun.reloading = false;
  gun.switchEnd = instant ? 0 : time + 0.35;
  gun.nextFire = gun.switchEnd; // each weapon only waits for the switch animation
  for (const [k, g] of Object.entries(models)) g.visible = k === id;
  muzzleFlash.position.z = models[id].userData.muzzle;
  muzzleFlash.position.y = models[id].position.y + 0.02;
  for (const m of muzzleFlash.children) m.material.color.set(W.color).multiplyScalar(2.5);
  muzzleLight.color.set(W.color);
  $('crosshair').dataset.w = id;
  updateHud();
  if (!instant) sfx.blip(420, 0.04, 0.08);
}

function cycleWeapon(step) {
  const i = WEAPON_LIST.findIndex((w) => w.id === W.id);
  equip(WEAPON_LIST[(i + step + WEAPON_LIST.length) % WEAPON_LIST.length].id);
}

function startReload() {
  if (W.melee || gun.reloading || gun.ammo[W.id] === W.mag || !player.alive) return;
  gun.reloading = true;
  gun.reloadEnd = time + W.reload / 1000;
  sfx.blip(300, 0.05, 0.1);
  setTimeout(() => sfx.blip(500, 0.05, 0.1), W.reload * 0.6);
  updateHud();
}

// ---------------------------------------------------------------- input
const keys = {};
let locked = false, started = false, firing = false, swayX = 0, swayY = 0;

addEventListener('keydown', (e) => {
  if (e.code === 'Tab') { e.preventDefault(); if (started) $('scoreboard').style.display = 'block'; }
  if (!locked) return;
  // While playing, swallow Ctrl shortcuts we can block (Ctrl+D bookmark, Ctrl+S save...).
  if (e.ctrlKey || e.code === 'Space') e.preventDefault();
  keys[e.code] = true;
  if (e.code === 'KeyR') startReload();
  if (e.code === 'KeyQ') equip(prevWeapon);
  const slot = WEAPON_LIST.find((w) => e.code === 'Digit' + w.slot);
  if (slot) equip(slot.id);
});
addEventListener('wheel', (e) => { if (locked && player.alive) cycleWeapon(e.deltaY > 0 ? 1 : -1); }, { passive: true });
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'Tab' && player.alive) $('scoreboard').style.display = 'none';
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
  $('play').textContent = started ? 'RESUME' : 'PLAY';
  $('restart').style.display = started ? 'block' : 'none';
}

function readMenu() {
  const before = { bots: settings.bots };
  settings.name = nameEl.value.trim().slice(0, 16) || 'Player';
  settings.sens = +sensEl.value;
  settings.bots = +botsEl.value;
  settings.difficulty = diffEl.value;
  settings.volume = +volEl.value;
  player.name = settings.name;
  saveSettings();
  const changed = before.bots !== settings.bots || avatarDirty;
  avatarDirty = false;
  return changed;
}

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
let portraits = {};
function buildPicker() {
  $('avatars').innerHTML = AVATARS.map((a) =>
    `<button type="button" class="av ${a.id === settings.avatar ? 'on' : ''}" data-id="${a.id}" style="--ac:${hex(a.color)}" aria-pressed="${a.id === settings.avatar}">` +
    `<img src="${portraits[a.id] || ''}" alt="" /><span>${a.name}</span></button>`).join('');
  $('avatarTag').textContent = avatarById(settings.avatar).tag;
}
$('avatars').addEventListener('click', (e) => {
  const btn = e.target.closest('.av');
  if (!btn || btn.dataset.id === settings.avatar) return;
  settings.avatar = btn.dataset.id;
  player.color = avatarById(settings.avatar).color;
  saveSettings();
  if (started) avatarDirty = true; // bots get re-picked on resume
  buildPicker();
});

// ?test in the URL skips pointer lock (for automated checks) and exposes game state.
const TEST = new URLSearchParams(location.search).has('test');
if (TEST) {
  window.__arena = { player, get bots() { return bots; }, keys, gun, setFiring: (v) => (firing = v), equip,
    renderer, scene, camera, composer, THREE, pause: (v) => (testPause = v), get stance() { return stance; }, vm, gunCam,
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
  const botsChanged = readMenu();
  $('status').textContent = '';
  if (!started || botsChanged) { setupMatch(); started = true; }
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
  $('ammoM').textContent = W.melee ? '' : ` / ${W.mag}`;
  $('ammoW').textContent = W.name;
  $('ammo').style.setProperty('--wc', hex(W.color));
  $('slots').innerHTML = WEAPON_LIST.map((w) =>
    `<span class="${w.id === W.id ? 'on' : ''}" style="--wc:${hex(w.color)}"><b>${w.slot}</b>${w.short}</span>`).join('');
}
function flash(el, op) {
  el.style.transition = 'none'; el.style.opacity = op;
  requestAnimationFrame(() => { el.style.transition = ''; el.style.opacity = 0; });
}
let centerTimer;
function centerMsg(text) {
  const el = $('center');
  el.textContent = text; el.style.opacity = 1;
  clearTimeout(centerTimer);
  centerTimer = setTimeout(() => (el.style.opacity = 0), 1400);
}
function addFeed(killer, victim, head, weapon) {
  const d = document.createElement('div');
  const k = killer && killer !== victim ? `<b style="color:${hex(killer.color)}">${killer.name}</b> ` : '';
  const w = weapon ? `<span class="wtag" style="color:${hex(weapon.color)}">${weapon.short}</span>` : '';
  d.innerHTML = `${k}${w}<span style="opacity:.6">${head ? ' ⌖ ' : ' › '}</span><b style="color:${hex(victim.color)}">${victim.name}</b>`;
  $('feed').prepend(d);
  setTimeout(() => d.remove(), 5000);
}
function renderScores() {
  const rows = [...ents].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
    .map((e) => `<tr class="${e.isPlayer ? 'me' : ''}"><td><span class="dot" style="color:${hex(e.color)}"></span>${e.name}</td>` +
      `<td class="num">${e.kills}</td><td class="num">${e.deaths}</td></tr>`).join('');
  $('sbTable').innerHTML = `<tr><th>PLAYER</th><th class="num">KILLS</th><th class="num">DEATHS</th></tr>${rows}`;
  $('sbRoom').textContent = settings.difficulty.toUpperCase();
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
  const f = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  const s = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
  let wx = -sin * f + cos * s, wz = -cos * f - sin * s;
  const len = Math.hypot(wx, wz);
  if (len > 0) { wx /= len; wz /= len; }

  const v = player.vel;
  const horiz = Math.hypot(v.x, v.z);
  // C does both: slide when running fast, crouch otherwise. (Ctrl is not used: Ctrl+W closes browser tabs.)
  const crouchKey = !!keys.KeyC;
  const crouchPressed = crouchKey && !stance.crouchKeyWas;
  stance.crouchKeyWas = crouchKey;
  const sprintKey = !!(keys.ShiftLeft || keys.ShiftRight);

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
    if (keys.Space && player.grounded) { // slide-jump keeps the momentum
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
    if (keys.Space && player.grounded) { v.y = JUMP; player.grounded = false; }
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
  if (!player.alive || time < gun.nextFire) return;
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
    if (!b.alive) continue;
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
  damage(best, player, dmg, false, W);
  burst(at, best.color, 10);
  burst(at, W.color, 6);
  showHitmarker(back);
  sfx.blip(130, 0.09, 0.3, 'triangle');
  sfx.shot(0.25, 2, 0.05);
}

function handleFire() {
  if (gun.reloading && time >= gun.reloadEnd) { gun.reloading = false; gun.ammo[W.id] = W.mag; updateHud(); }
  if (W.melee) { melee(); return; }
  if (!firing) gun.shotHeld = false;
  if (!firing || !player.alive || gun.reloading || time < gun.nextFire) return;
  if (!W.auto && gun.shotHeld) return; // shotgun & sniper: one shot per click
  if (gun.ammo[W.id] <= 0) { startReload(); return; }
  gun.shotHeld = true;
  gun.nextFire = time + W.interval / 1000;
  gun.ammo[W.id]--;

  syncCamera();
  const moving = Math.hypot(player.vel.x, player.vel.z) > 1.5;
  const aiming = gun.zoom > 0.7;
  // Crouching steadies your aim; sprinting and sliding make it worse.
  const stanceMul = stance.sliding ? 1.6 : stance.sprinting ? 1.5 : player.crouching && player.grounded ? 0.65 : 1;
  const spread = ((aiming ? W.spread * W.adsSpread : W.spread) + (moving ? W.moveSpread : 0)) * stanceMul
    + (player.grounded ? 0 : 0.03) + (stance.sliding ? 0.015 : 0) + gun.bloom * (player.crouching ? 0.6 : 1);
  if (W.auto) gun.bloom = Math.min(gun.bloom + 0.003, 0.02);

  const targets = worldMeshes.slice();
  for (const b of bots) if (b.alive) targets.push(b.body, b.head);
  const muzzle = new THREE.Vector3(0.16 * (1 - gun.zoom), -0.13 + 0.05 * gun.zoom, -0.75).applyMatrix4(camera.matrixWorld);
  const hits = new Map(); // bot -> total damage from this shot
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
  }

  let headAny = false;
  for (const [ent, h] of hits) {
    damage(ent, player, Math.round(h.dmg), h.head, W);
    burst(h.point, ent.color, 6);
    headAny ||= h.head;
  }
  if (hits.size) {
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
};
// Chance a bot spawns with each weapon.
const BOT_LOADOUT = [['rifle', 0.4], ['shotgun', 0.2], ['sniper', 0.15], ['pistol', 0.12], ['cannon', 0.13]];

function updateBot(b, dt) {
  if (!b.alive) return;
  const ai = b.ai, d = DIFF[settings.difficulty], bg = BOT_GUNS[b.weapon.id];
  ai.aggroT -= dt;
  if (ai.aggroT <= 0) ai.aggro = null;

  // Look for the nearest enemy we can see (within our field of view, unless they shot us).
  ai.scan -= dt;
  if (ai.scan <= 0) {
    ai.scan = 0.2;
    let best = null, bestD = Infinity;
    const fx_ = -Math.sin(b.yaw), fz = -Math.cos(b.yaw);
    for (const e of ents) {
      if (e === b || !e.alive) continue;
      const dx = e.pos.x - b.pos.x, dz = e.pos.z - b.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 70 || dist >= bestD) continue;
      const facing = (dx * fx_ + dz * fz) / (dist || 1);
      if (e !== ai.aggro && facing < d.fov) continue;
      if (canSee(b, e)) { best = e; bestD = dist; }
    }
    if (best !== ai.target) {
      ai.target = best;
      ai.react = d.reaction * rand(0.7, 1.3);
    }
  }

  let wx = 0, wz = 0, speed = 5.4;
  const tgt = ai.target;
  if (tgt && tgt.alive) {
    const dx = tgt.pos.x - b.pos.x, dz = tgt.pos.z - b.pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    b.yaw = lerpAngle(b.yaw, Math.atan2(-dx, -dz), 1 - Math.exp(-10 * dt));
    ai.strafeT -= dt;
    if (ai.strafeT <= 0) { ai.strafe = Math.random() < 0.5 ? -1 : 1; ai.strafeT = rand(0.5, 1.6); }
    const rx = dx / dist, rz = dz / dist;
    const approach = dist > bg.range[1] ? 0.9 : dist < bg.range[0] ? -0.6 : 0;
    wx = -rz * ai.strafe + rx * approach;
    wz = rx * ai.strafe + rz * approach;
    speed = b.weapon.id === 'shotgun' && approach > 0 ? 5.6 : 4.6;
    ai.react -= dt;
    if (ai.react <= 0 && time >= ai.nextShot && dist <= bg.maxDist) {
      botShoot(b, tgt, dist, d, bg);
      ai.nextShot = time + d.interval * bg.interval * rand(0.8, 1.4);
    }
  } else {
    ai.target = null;
    if (!ai.goal || Math.hypot(ai.goal.x - b.pos.x, ai.goal.z - b.pos.z) < 1.5) ai.goal = randomPoint();
    wx = ai.goal.x - b.pos.x;
    wz = ai.goal.z - b.pos.z;
    b.yaw = lerpAngle(b.yaw, Math.atan2(-wx, -wz), 1 - Math.exp(-6 * dt));
  }
  const len = Math.hypot(wx, wz);
  if (len > 0) { wx /= len; wz /= len; }
  const k = 1 - Math.exp(-(b.grounded ? 10 : 3) * dt);
  b.vel.x += (wx * speed - b.vel.x) * k;
  b.vel.z += (wz * speed - b.vel.z) * k;
  const blocked = moveBody(b, dt);
  if (blocked && b.grounded && Math.random() < 0.06) b.vel.y = JUMP;

  ai.stuckT += dt;
  if (ai.stuckT > 1) {
    if (b.pos.distanceTo(ai.lastPos) < 0.6) { ai.goal = randomPoint(); ai.strafe *= -1; }
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
  b.model.kick();
  const hearDist = b.pos.distanceTo(player.pos);
  sfx.weapon(w, clamp(1 - hearDist / 60, 0, 0.6));
}

// ---------------------------------------------------------------- main loop
const clock = new THREE.Clock();
let bob = 0, scopedShown = false;
const vmPos = new THREE.Vector3();

function frame() {
  requestAnimationFrame(frame);
  tick(Math.min(clock.getDelta(), 0.05));
  composer.render();
}

const feel = { roll: 0, dip: 0, prevVy: 0, wasGrounded: true, speedFov: 0, slideTilt: 0 };

let testPause = false; // ?test only: freezes gameplay while still rendering

function tick(dt) {
  const running = started && locked && !testPause;
  updateAtmosphere(dt);

  if (running) {
    time += dt;
    updatePlayer(dt);
    handleFire();
    for (const b of bots) updateBot(b, dt);
    for (const e of ents) if (!e.alive && time >= e.respawnAt) respawn(e);
    gun.bloom = Math.max(0, gun.bloom - dt * 0.03);
    if (!player.alive) $('deathTimer').textContent = `Respawning in ${Math.max(0, player.respawnAt - time).toFixed(1)}s`;
  }
  updateFx(dt);

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
    if (!player.alive) {
      camera.position.y = player.pos.y + 0.5;
      camera.rotation.z = 0.35;
    } else {
      // Feel: head bob, a dip when landing, a slight lean when strafing
      const lateral = player.vel.x * Math.cos(player.yaw) - player.vel.z * Math.sin(player.yaw);
      feel.roll += (-lateral * 0.0035 - feel.roll) * (1 - Math.exp(-8 * dt));
      if (player.grounded && !feel.wasGrounded && feel.prevVy < -6) feel.dip = Math.min(-feel.prevVy * 0.012, 0.16);
      feel.dip *= Math.exp(-7 * dt);
      camera.position.y += Math.sin(bob * 2) * 0.03 * bobAmt - feel.dip;
      feel.slideTilt += ((stance.sliding ? 0.09 : 0) - feel.slideTilt) * (1 - Math.exp(-10 * dt));
      camera.rotation.z = feel.roll + feel.slideTilt + Math.sin(bob) * 0.003 * bobAmt;
    }
    feel.wasGrounded = player.grounded;
    feel.prevVy = player.vel.y;
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
openMenu();
updateHud();
frame();
