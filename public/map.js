// Shared between the browser and the server.
//
// MAPS: each map has a layout (boxes + spawn points) and an `env` describing how it looks.
// Each box: x/z = center, y = bottom, w/h/d = size,
//   t = material: concrete | barrier | crate | container | steel | brick
//   p = paint/tint color, c = small neon accent color (used sparingly).
// Players can jump about 1.4 m, so anything taller needs a crate (or similar) next to it.

const CYAN = 0x00e5ff, PINK = 0xff2bd6, ORANGE = 0xff8a00, VIOLET = 0x8b5cff, GREEN = 0x7cff4f;
const RUST = 0x9a3f2c, BLUE = 0x2f5a8c, DGREEN = 0x3f6e4c, GREY = 0x8a8f96, OCHRE = 0xc06a2b, WHITE = 0xd8d8d0;

function mirror4(b) {
  // Repeat a box in all four quadrants.
  return [
    { ...b },
    { ...b, x: -b.x },
    { ...b, z: -b.z },
    { ...b, x: -b.x, z: -b.z },
  ];
}

// A 6 m shipping container. axis 'x' or 'z' = which way it is long. level 0 = on the ground, 1 = stacked.
const box6 = (x, z, axis, paint, level = 0) => ({
  x, z, y: level * 2.4, w: axis === 'x' ? 6 : 2.4, h: 2.4, d: axis === 'x' ? 2.4 : 6, t: 'container', p: paint,
});

const CORNER_SPAWNS = [
  [0, 0, -28], [0, 0, 28], [-28, 0, 0], [28, 0, 0],
  [-28, 0, -28], [28, 0, 28], [-28, 0, 28], [28, 0, -28],
];

// Sky colors are linear RGB (0..1+). sunDir points towards the sun.
const DUSK_SKY = {
  top: [0.03, 0.045, 0.12], mid: [0.16, 0.13, 0.26], hor: [0.55, 0.28, 0.3], horSun: [1.1, 0.5, 0.22],
  sunDir: [-0.75, 0.25, -0.5], sunGlow: [1.2, 0.55, 0.25], cloudDark: [0.22, 0.17, 0.26], cloudLit: [0.8, 0.42, 0.3],
  below: [0.12, 0.1, 0.14], clouds: 0.7,
};

export const MAPS = [
  // ---------------------------------------------------------------- Dusk Yard
  {
    id: 'yard', name: 'Dusk Yard', tag: 'Rainy dusk lot. Crates, barriers and containers.',
    size: 64, wallHeight: 7,
    boxes: [
      // Center concrete bunker + crates to climb it
      { x: 0, y: 0, z: 0, w: 8, h: 2.6, d: 8, c: PINK, t: 'concrete' },
      { x: 5.5, y: 0, z: 0, w: 3, h: 1.3, d: 3, t: 'crate' },
      { x: -5.5, y: 0, z: 0, w: 3, h: 1.3, d: 3, t: 'crate' },
      // Tall concrete pillars
      ...mirror4({ x: 14, y: 0, z: 14, w: 2, h: 6, d: 2, c: VIOLET, t: 'concrete' }),
      // Low cover: concrete road barriers
      { x: 0, y: 0, z: 16, w: 12, h: 1.2, d: 1, t: 'barrier' },
      { x: 0, y: 0, z: -16, w: 12, h: 1.2, d: 1, t: 'barrier' },
      { x: 16, y: 0, z: 0, w: 1, h: 1.2, d: 12, t: 'barrier' },
      { x: -16, y: 0, z: 0, w: 1, h: 1.2, d: 12, t: 'barrier' },
      // Scattered crates
      ...mirror4({ x: 22, y: 0, z: 8, w: 2.5, h: 2.5, d: 2.5, t: 'crate' }),
      ...mirror4({ x: 8, y: 0, z: 24, w: 2.5, h: 1.2, d: 4, t: 'crate' }),
      ...mirror4({ x: 7, y: 0, z: 9, w: 1.5, h: 1.5, d: 1.5, t: 'crate' }),
      // Shipping containers to climb on, with a step crate each
      { x: 24, y: 0, z: -22, w: 8, h: 2.4, d: 6, t: 'container', p: RUST },
      { x: 24, y: 0, z: -17.5, w: 3, h: 1.2, d: 3, t: 'crate' },
      { x: -24, y: 0, z: 22, w: 8, h: 2.4, d: 6, t: 'container', p: BLUE },
      { x: -24, y: 0, z: 17.5, w: 3, h: 1.2, d: 3, t: 'crate' },
      // Long mid walls (tall, block sightlines): steel plate
      { x: -24, y: 0, z: -12, w: 1, h: 4, d: 10, t: 'steel' },
      { x: 24, y: 0, z: 12, w: 1, h: 4, d: 10, t: 'steel', p: DGREEN },
    ],
    spawns: CORNER_SPAWNS,
    // Team modes: side a = blue / attackers, side b = red / defenders. Bombsites for Demolition.
    teamSpawns: {
      a: [[-12, 0, -29], [-6, 0, -29], [0, 0, -29], [6, 0, -29], [12, 0, -29]],
      b: [[-12, 0, 29], [-6, 0, 29], [0, 0, 29], [6, 0, 29], [12, 0, 29]],
    },
    sites: [{ name: 'A', x: -17, z: 21, r: 3.5 }, { name: 'B', x: 17, z: 21, r: 3.5 }],
    pickups: [
      { t: 'hp', x: -10, z: -6 }, { t: 'hp', x: 10, z: 6 }, { t: 'hp', x: 0, z: -22 }, { t: 'hp', x: 0, z: 22 },
      { t: 'ammo', x: -22, z: 0 }, { t: 'ammo', x: 22, z: 0 }, { t: 'ammo', x: -12, z: -22 }, { t: 'ammo', x: 12, z: 22 },
    ],
    env: {
      sky: DUSK_SKY,
      fog: { color: [0.2, 0.16, 0.22], density: 0.012 },
      exposure: 1.0, bloom: 0.35,
      hemi: { sky: 0x8a9ad0, ground: 0x3a2a24, intensity: 0.9 },
      sun: { color: 0xffb27a, intensity: 1.9, pos: [-45, 22, -30] },
      floor: 'asphalt', wall: 'wall', wallLight: 0x9fd8ff,
      lamps: [[19.5, 19.5, 0xffb070], [-19.5, -19.5, 0xffb070], [19.5, -19.5, 0xdfe8ff], [-19.5, 19.5, 0xffb070]],
      // Signs on the outer walls: [text, color, wall N/S/E/W, position along the wall, width]
      wallSigns: [
        ['NEON ARENA', PINK, 'N', 0, 9], ['ARC-7', CYAN, 'N', -19, 5], ['OPEN 24H', ORANGE, 'S', -14, 6],
        ['VOLT//', GREEN, 'S', 13, 5], ['SECTOR 9', VIOLET, 'E', 9, 6], ['RAIN CITY', CYAN, 'W', -9, 6.5],
      ],
      rain: true, rainColor: [0.16, 0.18, 0.24], hologram: true, centerLight: 0xff4fb0,
      skyline: { color: 0x1c1e26, windows: 0.45, beacons: true },
    },
  },

  // ---------------------------------------------------------------- Harbor
  {
    id: 'harbor', name: 'Harbor', tag: 'Sunny docks. Stacked containers and long sightlines.',
    size: 64, wallHeight: 7,
    boxes: [
      // West container row (one double stack at each end)
      box6(-22, -20, 'z', RUST), box6(-22, -20, 'z', BLUE, 1),
      box6(-22, -11, 'z', DGREEN),
      box6(-22, 11, 'z', GREY),
      box6(-22, 20, 'z', OCHRE), box6(-22, 20, 'z', WHITE, 1),
      { x: -18.6, y: 0, z: -15.5, w: 2, h: 1.2, d: 2, t: 'crate' }, // steps up the west row
      // East container row
      box6(22, -20, 'z', WHITE), box6(22, -20, 'z', RUST, 1),
      box6(22, -11, 'z', BLUE),
      box6(22, 11, 'z', OCHRE),
      box6(22, 20, 'z', DGREEN), box6(22, 20, 'z', GREY, 1),
      { x: 18.6, y: 0, z: 15.5, w: 2, h: 1.2, d: 2, t: 'crate' },
      // Center: a square of containers with gaps at the corners, and a climbable tower on the north side
      box6(0, -6, 'x', BLUE), box6(0, 6, 'x', RUST), box6(-6, 0, 'z', OCHRE), box6(6, 0, 'z', DGREEN),
      // Climb: ground crate -> container roof -> crate -> half container on top (sniper perch)
      { x: -2.2, y: 0, z: -9, w: 1.6, h: 1.2, d: 2, t: 'crate' },
      { x: -1.0, y: 2.4, z: -6, w: 1.2, h: 1.2, d: 2, t: 'crate' },
      { x: 1.5, y: 2.4, z: -6, w: 3, h: 2.4, d: 2.4, t: 'container', p: WHITE },
      { x: 0, y: 0, z: 0, w: 1.6, h: 1.6, d: 1.6, t: 'crate' },                  // cover inside the square
      // Scattered cargo
      { x: 12, y: 0, z: -20, w: 2.5, h: 2.5, d: 2.5, t: 'crate' },
      { x: -12, y: 0, z: 20, w: 2.5, h: 2.5, d: 2.5, t: 'crate' },
      { x: 13, y: 0, z: 14, w: 3, h: 1.2, d: 1.5, t: 'crate' },
      { x: -13, y: 0, z: -14, w: 3, h: 1.2, d: 1.5, t: 'crate' },
      { x: 10, y: 0, z: 24, w: 6, h: 1.2, d: 1, t: 'barrier' },
      { x: -10, y: 0, z: -24, w: 6, h: 1.2, d: 1, t: 'barrier' },
      // Mooring bollards along the waterfront
      ...[-20, -12, -4, 4, 12, 20].map((x) => ({ x, y: 0, z: 29.6, w: 0.5, h: 0.7, d: 0.5, t: 'steel', p: 0x2b2d31 })),
    ],
    spawns: CORNER_SPAWNS,
    teamSpawns: {
      a: [[-12, 0, -29], [-6, 0, -29], [0, 0, -29], [6, 0, -29], [12, 0, -29]],
      b: [[-12, 0, 27], [-6, 0, 27], [0, 0, 27], [6, 0, 27], [12, 0, 27]],
    },
    sites: [{ name: 'A', x: -14, z: 18, r: 4 }, { name: 'B', x: 14, z: 18, r: 4 }],
    pickups: [
      { t: 'hp', x: 0, z: -14 }, { t: 'hp', x: 0, z: 14 }, { t: 'hp', x: -16, z: 0 }, { t: 'hp', x: 16, z: 0 },
      { t: 'ammo', x: -10, z: -28 }, { t: 'ammo', x: 9, z: 26 }, { t: 'ammo', x: -27, z: 10 }, { t: 'ammo', x: 27, z: -10 },
    ],
    env: {
      sky: {
        top: [0.12, 0.28, 0.65], mid: [0.35, 0.55, 0.85], hor: [0.75, 0.82, 0.9], horSun: [1.0, 0.92, 0.8],
        sunDir: [0.48, 0.8, 0.32], sunGlow: [1.5, 1.3, 1.0], cloudDark: [0.72, 0.76, 0.84], cloudLit: [1.0, 0.98, 0.95],
        below: [0.45, 0.52, 0.6], clouds: 0.45,
      },
      fog: { color: [0.62, 0.7, 0.8], density: 0.007 },
      exposure: 1.0, bloom: 0.15,
      hemi: { sky: 0xc8dcff, ground: 0x8a7a66, intensity: 1.2 },
      sun: { color: 0xfff1dc, intensity: 3.0, pos: [30, 50, 20] },
      floor: 'dock', wall: 'wall', wallLight: null,
      openSide: 'S', // the south edge is a waterfront with a railing instead of a wall
      lamps: [], wallSigns: [], rain: false, hologram: false, cranes: true,
      skyline: { color: 0x5f6b7a, windows: 0.04, beacons: false },
    },
  },

  // ---------------------------------------------------------------- Neon Alley
  {
    id: 'alley', name: 'Neon Alley', tag: 'Rainy night streets. Tight corners, neon everywhere.',
    size: 64, wallHeight: 8,
    boxes: [
      // Four corner blocks
      { x: -19, y: 0, z: -19, w: 12, h: 7, d: 12, t: 'brick', p: 0xb0675a },
      { x: 19, y: 0, z: -19, w: 12, h: 7, d: 12, t: 'brick', p: 0x8f8a84 },
      { x: -19, y: 0, z: 19, w: 12, h: 7, d: 12, t: 'brick', p: 0x9c8a7a },
      { x: 19, y: 0, z: 19, w: 12, h: 7, d: 12, t: 'brick', p: 0xb0675a },
      // Edge blocks: two are tall, two are low shops you can climb onto
      { x: 0, y: 0, z: -24, w: 10, h: 2.6, d: 8, t: 'brick', p: 0xa59a8c },
      { x: 0, y: 0, z: 24, w: 10, h: 7, d: 8, t: 'brick', p: 0x8f8a84 },
      { x: -24, y: 0, z: 0, w: 8, h: 7, d: 10, t: 'brick', p: 0xa0705e },
      { x: 24, y: 0, z: 0, w: 8, h: 2.6, d: 10, t: 'brick', p: 0xa59a8c },
      { x: 0, y: 0, z: -18.8, w: 2, h: 1.3, d: 2, t: 'crate' },  // steps onto the low shops
      { x: 18.8, y: 0, z: 0, w: 2, h: 1.3, d: 2, t: 'crate' },
      // Plaza: newsstand kiosk, dumpsters, a food cart and crates
      { x: 0, y: 0, z: 0, w: 3, h: 2.4, d: 3, t: 'steel', p: 0x3f6e4c },
      { x: -8, y: 0, z: -6, w: 2.2, h: 1.4, d: 1.2, t: 'steel', p: 0x2f5a3c },
      { x: 8, y: 0, z: 6, w: 2.2, h: 1.4, d: 1.2, t: 'steel', p: 0x2f5a3c },
      { x: 6, y: 0, z: -8, w: 1.6, h: 1.2, d: 2.6, t: 'container', p: OCHRE },
      { x: -6, y: 0, z: 8, w: 1.5, h: 1.5, d: 1.5, t: 'crate' },
      { x: -9, y: 0, z: 9, w: 6, h: 1.2, d: 1, t: 'barrier' },
      { x: 9, y: 0, z: -9, w: 1, h: 1.2, d: 6, t: 'barrier' },
      // Back-alley cover
      { x: -29, y: 0, z: -10, w: 1.5, h: 1.5, d: 1.5, t: 'crate' },
      { x: 29, y: 0, z: 10, w: 1.5, h: 1.5, d: 1.5, t: 'crate' },
      { x: 10, y: 0, z: -29, w: 1.5, h: 1.5, d: 1.5, t: 'crate' },
      { x: -10, y: 0, z: 29, w: 1.5, h: 1.5, d: 1.5, t: 'crate' },
      { x: -29.4, y: 0, z: 12, w: 1.2, h: 1.4, d: 2.2, t: 'steel', p: 0x2f5a3c },
      { x: 29.4, y: 0, z: -12, w: 1.2, h: 1.4, d: 2.2, t: 'steel', p: 0x5a2f2f },
    ],
    spawns: [
      [-29, 0, -29], [29, 0, 29], [-29, 0, 29], [29, 0, -29],
      [0, 0, -30], [0, 0, 30], [-30, 0, 0], [30, 0, 0],
    ],
    teamSpawns: {
      a: [[-29, 0, -30], [-20, 0, -30], [-10, 0, -30], [14, 0, -30], [20, 0, -30]],
      b: [[-29, 0, 30], [-20, 0, 30], [-14, 0, 30], [14, 0, 30], [20, 0, 30]],
    },
    sites: [{ name: 'A', x: -9, z: 20, r: 3.5 }, { name: 'B', x: 9, z: 20, r: 3.5 }],
    pickups: [
      { t: 'hp', x: -11, z: 0 }, { t: 'hp', x: 11, z: 0 }, { t: 'hp', x: 0, z: -16 }, { t: 'hp', x: 0, z: 16 },
      { t: 'ammo', x: -29, z: -20 }, { t: 'ammo', x: 29, z: 20 }, { t: 'ammo', x: -20, z: -10 }, { t: 'ammo', x: 20, z: 10 },
    ],
    env: {
      sky: {
        top: [0.006, 0.004, 0.02], mid: [0.045, 0.018, 0.09], hor: [0.32, 0.07, 0.24], horSun: [0.32, 0.07, 0.24],
        sunDir: [0, -1, 0], sunGlow: [0, 0, 0], cloudDark: [0.16, 0.05, 0.16], cloudLit: [0.16, 0.05, 0.16],
        below: [0.02, 0.01, 0.035], clouds: 0.75,
      },
      fog: { color: [0.045, 0.02, 0.085], density: 0.022 },
      exposure: 1.05, bloom: 0.55,
      hemi: { sky: 0x4a3a9a, ground: 0x12061a, intensity: 0.5 },
      sun: { color: 0x8fa6ff, intensity: 0.45, pos: [-25, 45, -15] },
      floor: 'asphalt', wall: 'brick', wallLight: PINK,
      lamps: [[-10, -10, CYAN], [10, 10, PINK], [-10, 10, VIOLET], [10, -10, ORANGE], [-30, 20, CYAN], [30, -20, PINK]],
      wallSigns: [['CHINATOWN', PINK, 'N', 14, 8], ['RAMEN', ORANGE, 'S', -14, 5], ['HOTEL', CYAN, 'E', -16, 5]],
      // Shop signs on building faces: [text, color, x, y, z, rotationY, width]
      signs: [
        ['NOODLES', ORANGE, -12.95, 3.2, -19, Math.PI / 2, 4.5], ['ARCADE', PINK, 12.95, 3.2, -19, -Math.PI / 2, 4.5],
        ['KARAOKE', VIOLET, -12.95, 3.2, 19, Math.PI / 2, 4.5], ['24/7', GREEN, 12.95, 3.2, 19, -Math.PI / 2, 3.2],
        ['PAWN', CYAN, -19, 3.2, -12.95, 0, 3.6], ['BAR', PINK, 19, 3.2, 12.95, Math.PI, 3],
        ['CYBER CAFE', CYAN, 0, 4.2, 19.95, Math.PI, 6], ['TATTOO', ORANGE, -19.95, 4.2, 0, Math.PI / 2, 4.5],
      ],
      rain: true, rainColor: [0.22, 0.28, 0.42], hologram: true, centerLight: 0xff2bd6,
      skyline: { color: 0x0e1018, windows: 0.6, beacons: true, neon: true },
    },
  },
];
export const mapById = (id) => MAPS.find((m) => m.id === id) || MAPS[0];

// Defaults for older code (the server uses the first map's spawns).
export const ARENA = { size: MAPS[0].size, wallHeight: MAPS[0].wallHeight };
export const BOXES = MAPS[0].boxes;
export const SPAWNS = MAPS[0].spawns;

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
    spread: 0.003, adsSpread: 0.4, moveSpread: 0.01, adsFov: 58, kick: 0.009, reserve: 90, price: 2900,
  },
  shotgun: {
    id: 'shotgun', slot: 2, name: 'Scatter Gun', short: 'SHOTGUN', color: 0xff8a00,
    body: 11, head: 16, interval: 750, mag: 6, reload: 2000, range: 40, auto: false, pellets: 10,
    spread: 0.055, adsSpread: 0.8, moveSpread: 0.008, adsFov: 68, kick: 0.045, falloff: [8, 30], reserve: 24, price: 1200,
  },
  sniper: {
    id: 'sniper', slot: 3, name: 'Rail Sniper', short: 'SNIPER', color: 0xff2bd6,
    body: 85, head: 200, interval: 1100, mag: 5, reload: 2400, range: 200, auto: false, pellets: 1,
    spread: 0.05, adsSpread: 0, moveSpread: 0.03, adsFov: 22, kick: 0.05, scope: true, speed: 0.92, reserve: 15, price: 4700,
  },
  pistol: {
    id: 'pistol', slot: 4, name: 'Volt Pistol', short: 'PISTOL', color: 0x7cff4f,
    body: 18, head: 45, interval: 160, mag: 12, reload: 1100, range: 80, auto: false, pellets: 1,
    spread: 0.004, adsSpread: 0.5, moveSpread: 0.006, adsFov: 64, kick: 0.012, speed: 1.05, reserve: 48, price: 0,
  },
  // Heavy pistol: one-shot headshots, but big recoil and very inaccurate while running.
  cannon: {
    id: 'cannon', slot: 5, name: 'Hand Cannon', short: 'CANNON', color: 0xffe600,
    body: 45, head: 110, interval: 450, mag: 7, reload: 1800, range: 100, auto: false, pellets: 1,
    spread: 0.003, adsSpread: 0.5, moveSpread: 0.04, adsFov: 60, kick: 0.065, reserve: 21, price: 700,
  },
  // Melee. Left click = quick slash (body), right click = heavy stab (heavy).
  // Hitting someone from behind multiplies damage (backstab).
  knife: {
    id: 'knife', slot: 6, name: 'Arc Blade', short: 'KNIFE', color: 0x8b5cff, melee: true,
    body: 50, heavy: 75, backstab: 2, interval: 420, heavyInterval: 950, range: 2.3, mag: 0,
    speed: 1.15, price: 0,
  },
};
//   reserve: spare ammo beyond the magazine (refilled by ammo boxes and each life)
//   price: cost in Demolition's buy menu (the pistol and knife are free)

// Demolition economy
export const ECONOMY = {
  start: 800, max: 9000, kill: 300, roundWin: 3000, roundLoss: 1900, plant: 300,
  armorPrice: 1000, buyTime: 15, // seconds you can still buy after the round starts
};

export const MAX_HP = 100;
export const RESPAWN_MS = 3000;
