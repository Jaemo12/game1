// Shared between the browser and the server.
// Each box: x/z = center, y = bottom, w/h/d = size,
//   t = material: concrete | barrier | crate | container | steel
//   p = paint color (containers), c = small neon accent color (used sparingly).
export const ARENA = { size: 64, wallHeight: 7 };

const CYAN = 0x00e5ff, PINK = 0xff2bd6, ORANGE = 0xff8a00, VIOLET = 0x8b5cff;
const RUST = 0x9a3f2c, BLUE = 0x2f5a8c, GREEN = 0x3f6e4c;

function mirror4(b) {
  // Repeat a box in all four quadrants.
  return [
    { ...b },
    { ...b, x: -b.x },
    { ...b, z: -b.z },
    { ...b, x: -b.x, z: -b.z },
  ];
}

export const BOXES = [
  // Center concrete bunker + crates to climb it
  { x: 0, y: 0, z: 0, w: 8, h: 2.6, d: 8, c: PINK, t: 'concrete' },
  { x: 5.5, y: 0, z: 0, w: 3, h: 1.3, d: 3, c: CYAN, t: 'crate' },
  { x: -5.5, y: 0, z: 0, w: 3, h: 1.3, d: 3, c: CYAN, t: 'crate' },

  // Tall concrete pillars
  ...mirror4({ x: 14, y: 0, z: 14, w: 2, h: 6, d: 2, c: VIOLET, t: 'concrete' }),

  // Low cover: concrete road barriers
  { x: 0, y: 0, z: 16, w: 12, h: 1.2, d: 1, c: ORANGE, t: 'barrier' },
  { x: 0, y: 0, z: -16, w: 12, h: 1.2, d: 1, c: ORANGE, t: 'barrier' },
  { x: 16, y: 0, z: 0, w: 1, h: 1.2, d: 12, c: ORANGE, t: 'barrier' },
  { x: -16, y: 0, z: 0, w: 1, h: 1.2, d: 12, c: ORANGE, t: 'barrier' },

  // Scattered crates
  ...mirror4({ x: 22, y: 0, z: 8, w: 2.5, h: 2.5, d: 2.5, c: CYAN, t: 'crate' }),
  ...mirror4({ x: 8, y: 0, z: 24, w: 2.5, h: 1.2, d: 4, c: PINK, t: 'crate' }),
  ...mirror4({ x: 7, y: 0, z: 9, w: 1.5, h: 1.5, d: 1.5, c: ORANGE, t: 'crate' }),

  // Shipping containers to climb on, with a step crate each
  { x: 24, y: 0, z: -22, w: 8, h: 2.4, d: 6, c: VIOLET, t: 'container', p: RUST },
  { x: 24, y: 0, z: -17.5, w: 3, h: 1.2, d: 3, c: CYAN, t: 'crate' },
  { x: -24, y: 0, z: 22, w: 8, h: 2.4, d: 6, c: VIOLET, t: 'container', p: BLUE },
  { x: -24, y: 0, z: 17.5, w: 3, h: 1.2, d: 3, c: CYAN, t: 'crate' },

  // Long mid walls (tall, block sightlines): steel plate
  { x: -24, y: 0, z: -12, w: 1, h: 4, d: 10, c: PINK, t: 'steel' },
  { x: 24, y: 0, z: 12, w: 1, h: 4, d: 10, c: PINK, t: 'steel', p: GREEN },
];

export const SPAWNS = [
  [0, 0, -28], [0, 0, 28], [-28, 0, 0], [28, 0, 0],
  [-28, 0, -28], [28, 0, 28], [-28, 0, 28], [28, 0, -28],
];

// Weapon tuning.
//   body/head    damage per bullet (per pellet for the shotgun)
//   interval     ms between shots       auto     hold to keep firing
//   spread       base inaccuracy        adsSpread  multiplier while aiming (right mouse)
//   moveSpread   extra inaccuracy while moving
//   falloff      [start, end] metres: damage drops to 30% between these
//   adsFov       zoom level while aiming (lower = more zoom)   kick  recoil
export const WEAPONS = {
  rifle: {
    id: 'rifle', slot: 1, name: 'Pulse Rifle', short: 'RIFLE', color: 0x00e5ff,
    body: 20, head: 50, interval: 100, mag: 30, reload: 1500, range: 120, auto: true, pellets: 1,
    spread: 0.003, adsSpread: 0.4, moveSpread: 0.01, adsFov: 58, kick: 0.009,
  },
  shotgun: {
    id: 'shotgun', slot: 2, name: 'Scatter Gun', short: 'SHOTGUN', color: 0xff8a00,
    body: 11, head: 16, interval: 750, mag: 6, reload: 2000, range: 40, auto: false, pellets: 10,
    spread: 0.055, adsSpread: 0.8, moveSpread: 0.008, adsFov: 68, kick: 0.045, falloff: [8, 30],
  },
  sniper: {
    id: 'sniper', slot: 3, name: 'Rail Sniper', short: 'SNIPER', color: 0xff2bd6,
    body: 85, head: 200, interval: 1100, mag: 5, reload: 2400, range: 200, auto: false, pellets: 1,
    spread: 0.05, adsSpread: 0, moveSpread: 0.03, adsFov: 22, kick: 0.05, scope: true, speed: 0.92,
  },
  pistol: {
    id: 'pistol', slot: 4, name: 'Volt Pistol', short: 'PISTOL', color: 0x7cff4f,
    body: 18, head: 45, interval: 160, mag: 12, reload: 1100, range: 80, auto: false, pellets: 1,
    spread: 0.004, adsSpread: 0.5, moveSpread: 0.006, adsFov: 64, kick: 0.012, speed: 1.05,
  },
  // Heavy pistol: one-shot headshots, but big recoil and very inaccurate while running.
  cannon: {
    id: 'cannon', slot: 5, name: 'Hand Cannon', short: 'CANNON', color: 0xffe600,
    body: 45, head: 110, interval: 450, mag: 7, reload: 1800, range: 100, auto: false, pellets: 1,
    spread: 0.003, adsSpread: 0.5, moveSpread: 0.04, adsFov: 60, kick: 0.065,
  },
  // Melee. Left click = quick slash (body), right click = heavy stab (heavy).
  // Hitting someone from behind multiplies damage (backstab).
  knife: {
    id: 'knife', slot: 6, name: 'Arc Blade', short: 'KNIFE', color: 0x8b5cff, melee: true,
    body: 50, heavy: 75, backstab: 2, interval: 420, heavyInterval: 950, range: 2.3, mag: 0,
    speed: 1.15,
  },
};

export const MAX_HP = 100;
export const RESPAWN_MS = 3000;
