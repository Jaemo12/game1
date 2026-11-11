// Neon Arena characters. Built from simple shapes with cel ("toon") shading and black outlines,
// so they read like anime / cartoon characters. Each one walks, sways and reacts to being hit.
//
// To add an avatar: add an entry to AVATARS and a matching builder in BUILDERS.
import * as THREE from 'three';

export const AVATARS = [
  { id: 'kaze', name: 'Kaze', color: 0x00e5ff, tag: 'Wandering blade of the rain city' },
  { id: 'mango', name: 'Boss Mango', color: 0xffb020, tag: 'Owns the arena. And your rent.' },
  { id: 'glitch', name: 'Glitch', color: 0x7cff4f, tag: 'Friendly. Mostly. ^_^' },
  { id: 'nyx', name: 'Nyx', color: 0xff2bd6, tag: 'Hacker cat. Nine respawns.' },
];
export const avatarById = (id) => AVATARS.find((a) => a.id === id) || AVATARS[0];

const UP = new THREE.Vector3(0, 1, 0);
const hdr = (c, k) => new THREE.Color(c).multiplyScalar(k);

// ------------------------------------------------------------------ shared materials
let gradientTex;
function toonGradient() {
  if (!gradientTex) {
    gradientTex = new THREE.DataTexture(new Uint8Array([55, 140, 255]), 3, 1, THREE.RedFormat);
    gradientTex.minFilter = gradientTex.magFilter = THREE.NearestFilter;
    gradientTex.needsUpdate = true;
  }
  return gradientTex;
}

const OUTLINE = 0.018; // outline thickness in metres
// Outline for round shapes: push vertices out along their normals, draw back faces in black.
const outlineMat = new THREE.MeshBasicMaterial({ color: 0x07040d, side: THREE.BackSide });
outlineMat.onBeforeCompile = (sh) => {
  sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `vec3 transformed = position + normal * ${OUTLINE.toFixed(3)};`);
};
outlineMat.customProgramCacheKey = () => 'outline-push-v1';
// Outline for boxes: a slightly bigger copy (pushing along face normals would crack the corners).
const outlineBoxMat = new THREE.MeshBasicMaterial({ color: 0x07040d, side: THREE.BackSide });

// Per-character materials: toon shading + a rim light in the accent color + a white hit flash.
function materialKit(accent) {
  const uFlash = { value: 0 };
  const uRim = { value: hdr(accent, 0.8) };
  const cache = new Map();
  const toon = (color) => {
    if (cache.has(color)) return cache.get(color);
    const m = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uFlash = uFlash;
      sh.uniforms.uRim = uRim;
      sh.fragmentShader = 'uniform float uFlash;\nuniform vec3 uRim;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  totalEmissiveRadiance += uRim * pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0) + vec3(uFlash);`);
    };
    m.customProgramCacheKey = () => 'toon-rim-v1';
    cache.set(color, m);
    return m;
  };
  const glow = (color, k = 2.5) => new THREE.MeshBasicMaterial({ color: hdr(color, k) });
  return { toon, glow, uFlash };
}

// ------------------------------------------------------------------ building blocks
const geo = {
  box: (w, h, d) => new THREE.BoxGeometry(w, h, d),
  sph: (r, ws = 18, hs = 14, ...rest) => new THREE.SphereGeometry(r, ws, hs, ...rest),
  cap: (r, len) => new THREE.CapsuleGeometry(r, len, 5, 12),
  cyl: (rt, rb, h, s = 16) => new THREE.CylinderGeometry(rt, rb, h, s),
  cone: (r, h) => new THREE.ConeGeometry(r, h, 10),
  tor: (r, t, arc = Math.PI * 2) => new THREE.TorusGeometry(r, t, 8, 28, arc),
};

// Add a mesh to `parent`. opts: pos, rot, scale, outline (default true), shadow.
function part(parent, g, mat, { pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1], outline = true, shadow = false } = {}) {
  const m = new THREE.Mesh(g, mat);
  m.position.set(...pos);
  m.rotation.set(...rot);
  m.scale.set(...scale);
  m.castShadow = shadow;
  if (outline) {
    let o;
    if (g.type === 'BoxGeometry') {
      const p = g.parameters;
      o = new THREE.Mesh(g, outlineBoxMat);
      o.scale.set(1 + (2 * OUTLINE) / p.width, 1 + (2 * OUTLINE) / p.height, 1 + (2 * OUTLINE) / p.depth);
    } else {
      o = new THREE.Mesh(g, outlineMat);
    }
    m.add(o);
  }
  parent.add(m);
  return m;
}

// Point a mesh's +Y axis along `dir`.
function aim(mesh, dir) {
  mesh.quaternion.setFromUnitVectors(UP, new THREE.Vector3(...dir).normalize());
  return mesh;
}

// ------------------------------------------------------------------ skeleton
// Every avatar shares one rig: hips (legs hang from it), torso, head, two arms and a gun.
// The character faces -Z. Feet are at y = 0.
function makeRig(kit, look) {
  const { toon, glow } = kit;
  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = 0.88;
  root.add(hips);

  const legs = [-1, 1].map((side) => {
    const leg = new THREE.Group();
    leg.position.set(side * 0.12, 0, 0);
    hips.add(leg);
    part(leg, geo.cap(0.1, 0.48), toon(look.pants), { pos: [0, -0.38, 0], shadow: true });
    part(leg, geo.box(0.17, 0.11, 0.28), toon(look.shoes), { pos: [0, -0.83, -0.04] });
    if (look.shoeGlow) part(leg, geo.box(0.172, 0.02, 0.22), glow(look.shoeGlow, 2), { pos: [0, -0.8, -0.04], outline: false });
    return leg;
  });

  const torso = new THREE.Group();
  hips.add(torso);
  const head = new THREE.Group();
  head.position.y = 0.66;
  torso.add(head);

  const arms = [-1, 1].map((side) => {
    const arm = new THREE.Group();
    arm.position.set(side * 0.26, 0.47, 0);
    torso.add(arm);
    part(arm, geo.cap(0.075, 0.32), toon(look.sleeves), { pos: [0, -0.24, 0] });
    part(arm, geo.sph(0.075), toon(look.hands), { pos: [0, -0.48, 0] });
    return arm;
  });
  // Arms forward, holding the gun in front of the chest
  arms[1].rotation.set(1.35, 0, 0.05);
  arms[0].rotation.set(1.25, -0.5, -0.1);

  const gunMesh = part(torso, geo.box(0.08, 0.1, 0.55), toon(0x22252f), { pos: [0.1, 0.3, -0.5] });
  const gunStrip = part(torso, geo.box(0.02, 0.02, 0.5), glow(look.accent, 2.2), { pos: [0.145, 0.32, -0.5], outline: false });

  return { root, hips, legs, torso, head, arms, gunMesh, gunStrip };
}

// ------------------------------------------------------------------ the four avatars
const BUILDERS = {
  // Anime ronin: spiky silver hair, big glowing eyes, red scarf, katana on her back.
  kaze(kit, accent) {
    const { toon, glow } = kit;
    const look = { pants: 0x23263a, shoes: 0xf0f0f4, sleeves: 0x1b1e2e, hands: 0xffdcc8, accent, shoeGlow: accent };
    const rig = makeRig(kit, look);
    const { torso, head } = rig;
    part(torso, geo.cap(0.2, 0.3), toon(0x1b1e2e), { pos: [0, 0.3, 0], scale: [1.1, 1, 0.8], shadow: true });
    part(torso, geo.box(0.015, 0.4, 0.01), glow(accent, 2.5), { pos: [0, 0.3, -0.168], outline: false }); // zipper
    part(torso, geo.box(0.42, 0.05, 0.3), toon(0x111320), { pos: [0, 0.08, 0] });                          // belt
    part(torso, geo.tor(0.13, 0.055), toon(0xe02848), { pos: [0, 0.6, 0], rot: [Math.PI / 2, 0, 0] });     // scarf wrap
    const scarf = new THREE.Group();
    scarf.position.set(0.05, 0.6, 0.12);
    torso.add(scarf);
    part(scarf, geo.box(0.1, 0.02, 0.5), toon(0xe02848), { pos: [0, 0, 0.25] });
    part(scarf, geo.box(0.09, 0.02, 0.38), toon(0xc01d3a), { pos: [-0.09, -0.04, 0.2], rot: [0, 0.15, 0] });
    const katana = new THREE.Group();
    katana.position.set(0, 0.35, 0.2);
    katana.rotation.z = 0.6;
    torso.add(katana);
    part(katana, geo.box(0.03, 0.85, 0.015), glow(accent, 1.4), { outline: false });
    part(katana, geo.box(0.045, 0.22, 0.03), toon(0x111111), { pos: [0, -0.52, 0] });
    part(katana, geo.box(0.1, 0.02, 0.05), toon(0xd8b450), { pos: [0, -0.41, 0] });

    // Head: face, big anime eyes, spiky hair with bangs and a ponytail
    part(head, geo.sph(0.21), toon(0xffdcc8), { pos: [0, 0.04, 0], shadow: true });
    for (const s of [-1, 1]) {
      part(head, geo.sph(0.055), toon(0xffffff), { pos: [s * 0.078, 0.03, -0.18], scale: [0.85, 1.2, 0.35], outline: false });
      part(head, geo.sph(0.04), glow(accent, 1.8), { pos: [s * 0.078, 0.025, -0.197], scale: [0.8, 1.15, 0.3], outline: false });
      part(head, geo.sph(0.013), glow(0xffffff, 2), { pos: [s * 0.078 + 0.014, 0.05, -0.207], outline: false });
      part(head, geo.box(0.07, 0.012, 0.01), toon(0x2a2a3a), { pos: [s * 0.08, 0.115, -0.19], rot: [0, 0, s * -0.15], outline: false });
    }
    part(head, geo.box(0.04, 0.008, 0.01), toon(0x9a4a4a), { pos: [0, -0.07, -0.205], outline: false }); // mouth
    const hair = toon(0xe8ecff);
    part(head, geo.sph(0.235, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, { pos: [0, 0.05, 0.02] });
    for (const d of [[0, 1, 0.3], [0.55, 0.8, 0.35], [-0.55, 0.8, 0.35], [0.85, 0.25, 0.45], [-0.85, 0.25, 0.45], [0, 0.35, 1], [0.45, 0.1, 0.9], [-0.45, 0.1, 0.9]]) {
      const v = new THREE.Vector3(...d).normalize();
      aim(part(head, geo.cone(0.07, 0.24), hair, { pos: [v.x * 0.2, 0.06 + v.y * 0.2, v.z * 0.2] }), d);
    }
    for (const x of [-0.11, -0.03, 0.06, 0.13]) {
      aim(part(head, geo.cone(0.05, 0.15), hair, { pos: [x, 0.13, -0.17] }), [x * 0.6, -0.7, -0.45]);
    }
    const pony = aim(part(head, geo.cone(0.075, 0.38), hair, { pos: [0, 0.0, 0.3] }), [0, -0.55, 1]);
    const tipGlow = part(head, geo.sph(0.02), glow(accent, 3), { pos: [0, -0.1, 0.45], outline: false });
    tipGlow.visible = true;

    rig.extra = (t, amt) => {
      scarf.rotation.x = -0.25 - amt * 0.5 + Math.sin(t * 9) * 0.12 * (0.3 + amt);
      scarf.rotation.y = Math.sin(t * 5.3) * 0.15;
      pony.rotation.z = Math.sin(t * 6) * 0.08;
    };
    return rig;
  },

  // Satirical corporate fat cat: round belly, pinstripe suit, top hat, mustache, monocle, cigar.
  mango(kit, accent) {
    const { toon, glow } = kit;
    const look = { pants: 0x1d2340, shoes: 0x0b0b10, sleeves: 0x1d2340, hands: 0xf4f4f4, accent };
    const rig = makeRig(kit, look);
    const { torso, head } = rig;
    part(torso, geo.sph(0.3), toon(0x1d2340), { pos: [0, 0.3, 0], scale: [1.18, 1.05, 1.02], shadow: true }); // belly
    for (const x of [-0.18, -0.09, 0.09, 0.18]) { // pinstripes
      part(torso, geo.box(0.006, 0.42, 0.006), toon(0x6a76a8), { pos: [x, 0.3, -0.29 + Math.abs(x) * 0.35], outline: false });
    }
    part(torso, geo.box(0.16, 0.3, 0.05), toon(0xffffff), { pos: [0, 0.43, -0.26], rot: [-0.25, 0, 0] });  // shirt
    part(torso, geo.box(0.07, 0.26, 0.02), toon(0xd8263a), { pos: [0, 0.38, -0.3], rot: [-0.25, 0, 0] });    // tie
    part(torso, geo.box(0.08, 0.06, 0.04), toon(0xb01a2c), { pos: [0, 0.53, -0.27] });                       // knot
    part(torso, geo.cyl(0.06, 0.06, 0.015), glow(accent, 2.2), { pos: [0.18, 0.44, -0.24], rot: [Math.PI / 2 - 0.3, 0, 0] }); // gold coin badge
    part(torso, geo.tor(0.2, 0.01, Math.PI), glow(accent, 1.6), { pos: [0, 0.2, -0.3], rot: [0.1, 0, Math.PI], outline: false }); // gold chain

    part(head, geo.sph(0.23), toon(0xf5a04a), { pos: [0, 0.04, 0], scale: [1.06, 0.95, 1], shadow: true });
    part(head, geo.sph(0.05), toon(0xe0853a), { pos: [0, 0.0, -0.225] });                                    // nose
    for (const s of [-1, 1]) {
      part(head, geo.sph(0.024), toon(0x111111), { pos: [s * 0.08, 0.07, -0.2], outline: false });
      part(head, geo.box(0.08, 0.02, 0.02), toon(0x5a3a1a), { pos: [s * 0.08, 0.12, -0.2], rot: [0, 0, s * 0.35], outline: false }); // grumpy brows
      part(head, geo.cap(0.035, 0.13), toon(0xf4f1e8), { pos: [s * 0.085, -0.05, -0.21], rot: [0, 0, s * 1.25] });   // mustache
      part(head, geo.sph(0.03), toon(0xf4f1e8), { pos: [s * 0.16, -0.01, -0.19] });
    }
    part(head, geo.tor(0.045, 0.008), toon(0xffc23d), { pos: [0.08, 0.07, -0.215], outline: false });       // monocle
    part(head, new THREE.CircleGeometry(0.04, 20), glow(accent, 0.5), { pos: [0.08, 0.07, -0.218], rot: [0, Math.PI, 0], outline: false });
    part(head, geo.cyl(0.018, 0.018, 0.15), toon(0x7a4a28), { pos: [0.06, -0.09, -0.28], rot: [Math.PI / 2, 0.2, 0], outline: false }); // cigar
    const ember = part(head, geo.sph(0.022), glow(0xff5a1a, 3), { pos: [0.075, -0.09, -0.355], outline: false });
    const hat = new THREE.Group();
    hat.position.set(0, 0.22, 0);
    hat.rotation.z = 0.12;
    head.add(hat);
    part(hat, geo.cyl(0.27, 0.27, 0.03, 24), toon(0x121218));
    part(hat, geo.cyl(0.17, 0.17, 0.32, 24), toon(0x121218), { pos: [0, 0.17, 0] });
    part(hat, geo.cyl(0.173, 0.173, 0.05, 24), glow(accent, 1.8), { pos: [0, 0.05, 0], outline: false });

    rig.extra = (t) => {
      ember.scale.setScalar(0.8 + Math.sin(t * 7) * 0.25);
      hat.position.y = 0.22 + Math.abs(Math.sin(t * 4)) * 0.01;
    };
    return rig;
  },

  // Friendly robot with an old TV for a head; the screen shows a pixel face.
  glitch(kit, accent) {
    const { toon, glow } = kit;
    const look = { pants: 0xb9bec9, shoes: 0x2a2e38, sleeves: 0xb9bec9, hands: 0x2a2e38, accent, shoeGlow: accent };
    const rig = makeRig(kit, look);
    const { torso, head, legs } = rig;
    for (const leg of legs) part(leg, geo.sph(0.08), toon(0x2a2e38), { pos: [0, -0.42, 0] }); // knees
    part(torso, geo.box(0.44, 0.42, 0.3), toon(0xd9dde6), { pos: [0, 0.3, 0], shadow: true });
    part(torso, geo.box(0.28, 0.2, 0.02), toon(0x2a2e38), { pos: [0, 0.34, -0.155], outline: false });
    const core = part(torso, geo.cyl(0.06, 0.06, 0.02), glow(accent, 2.5), { pos: [0, 0.34, -0.168], rot: [Math.PI / 2, 0, 0], outline: false });
    for (const y of [0.16, 0.12, 0.08]) part(torso, geo.box(0.3, 0.012, 0.01), glow(accent, 1.2), { pos: [0, y, -0.152], outline: false });
    part(torso, geo.cyl(0.06, 0.07, 0.1), toon(0x2a2e38), { pos: [0, 0.56, 0], outline: false }); // neck

    part(head, geo.box(0.5, 0.38, 0.36), toon(0xd9dde6), { pos: [0, 0.08, 0], shadow: true });
    part(head, geo.box(0.44, 0.32, 0.01), toon(0x1a1d24), { pos: [0, 0.08, -0.181], outline: false });
    const faces = ['happy', 'hurt'].map((kind) => {
      const c = document.createElement('canvas');
      c.width = 64; c.height = 48;
      const g = c.getContext('2d');
      g.fillStyle = '#000'; g.fillRect(0, 0, 64, 48);
      g.fillStyle = '#fff';
      const px = (x, y) => g.fillRect(x * 4, y * 4, 4, 4);
      if (kind === 'happy') { // ^ ^ and a smile
        for (const ox of [3, 10]) { px(ox, 4); px(ox + 1, 3); px(ox + 2, 4); }
        for (const [x, y] of [[5, 8], [6, 9], [7, 9], [8, 9], [9, 9], [10, 8]]) px(x, y);
      } else { // > < and a wobbly mouth
        for (const [x, y] of [[3, 3], [4, 4], [3, 5], [12, 3], [11, 4], [12, 5]]) px(x, y);
        for (const [x, y] of [[5, 9], [6, 8], [7, 9], [8, 8], [9, 9], [10, 8]]) px(x, y);
      }
      const tex = new THREE.CanvasTexture(c);
      tex.magFilter = THREE.NearestFilter;
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    });
    const screenMat = new THREE.MeshBasicMaterial({ map: faces[0], color: hdr(accent, 1.6) });
    part(head, new THREE.PlaneGeometry(0.4, 0.28), screenMat, { pos: [0, 0.08, -0.187], rot: [0, Math.PI, 0], outline: false });
    for (const s of [-1, 1]) part(head, geo.cyl(0.05, 0.05, 0.05), toon(0x2a2e38), { pos: [s * 0.27, 0.08, 0], rot: [0, 0, Math.PI / 2] });
    const antenna = new THREE.Group();
    antenna.position.set(0.12, 0.27, 0);
    head.add(antenna);
    part(antenna, geo.cyl(0.012, 0.012, 0.26), toon(0x2a2e38), { pos: [0, 0.13, 0], outline: false });
    part(antenna, geo.sph(0.035), glow(accent, 3), { pos: [0, 0.27, 0], outline: false });

    rig.extra = (t, amt, flash) => {
      antenna.rotation.z = -0.25 + Math.sin(t * 8) * 0.12 * (0.4 + amt);
      core.scale.setScalar(0.85 + Math.sin(t * 3) * 0.15);
      screenMat.map = flash ? faces[1] : faces[0];
    };
    return rig;
  },

  // Hacker cat: hoodie with cat ears, glowing cat-eye goggles, face mask and a swishing tail.
  nyx(kit, accent) {
    const { toon, glow } = kit;
    const look = { pants: 0x15121f, shoes: 0x221c30, sleeves: 0x2b1f45, hands: 0x15121f, accent, shoeGlow: accent };
    const rig = makeRig(kit, look);
    const { torso, head, hips } = rig;
    part(torso, geo.cap(0.19, 0.3), toon(0x2b1f45), { pos: [0, 0.3, 0], scale: [1.12, 1, 0.85], shadow: true });
    part(torso, geo.box(0.24, 0.1, 0.04), toon(0x241a3a), { pos: [0, 0.18, -0.16] }); // pocket
    for (const s of [-1, 1]) part(torso, geo.box(0.012, 0.18, 0.012), glow(accent, 2), { pos: [s * 0.05, 0.5, -0.17], outline: false }); // drawstrings

    part(head, geo.sph(0.2), toon(0xf0c8b8), { pos: [0, 0.04, 0], shadow: true });
    part(head, geo.sph(0.205, 18, 10, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45), toon(0x0d0b14), { pos: [0, 0.03, -0.005], outline: false }); // mask
    part(head, geo.sph(0.255, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), toon(0x2b1f45), { pos: [0, 0.06, 0.03], rot: [-0.35, 0, 0] }); // hood
    for (const s of [-1, 1]) {
      part(head, geo.cone(0.075, 0.15), toon(0x2b1f45), { pos: [s * 0.14, 0.27, 0.04], rot: [0, 0, s * -0.4] });              // cat ears
      part(head, geo.cone(0.035, 0.09), glow(accent, 1.8), { pos: [s * 0.135, 0.26, -0.01], rot: [0, 0, s * -0.4], outline: false });
      part(head, geo.sph(0.045), glow(accent, 2.6), { pos: [s * 0.07, 0.05, -0.18], scale: [1.3, 0.55, 0.4], rot: [0, 0, s * -0.25], outline: false }); // cat-eye goggles
    }
    part(head, geo.box(0.34, 0.07, 0.05), toon(0x0d0b14), { pos: [0, 0.05, -0.165], outline: false }); // goggle band

    const tail = new THREE.Group();
    tail.position.set(0, 0.0, 0.17);
    hips.add(tail);
    const seg = [];
    let parent = tail;
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group();
      g.position.set(0, i === 0 ? 0 : 0.1, i === 0 ? 0 : 0.03);
      parent.add(g);
      part(g, geo.sph(0.045 - i * 0.004), i === 5 ? glow(accent, 3) : toon(0x2b1f45), { outline: i !== 5 });
      seg.push(g);
      parent = g;
    }
    tail.rotation.x = -0.9;

    rig.extra = (t, amt) => {
      seg.forEach((g, i) => {
        g.rotation.x = 0.18 + Math.sin(t * 3 - i * 0.6) * 0.05;
        g.rotation.z = Math.sin(t * 2.5 - i * 0.7) * (0.18 + amt * 0.1);
      });
    };
    return rig;
  },
};

// ------------------------------------------------------------------ public API
// Returns { group, hitBody, hitHead, gunMesh, gunStrip, animate(dt, speed), setFlash(bool), kick() }.
export function buildAvatar(id, accent) {
  const kit = materialKit(accent);
  const rig = (BUILDERS[id] || BUILDERS.kaze)(kit, accent);
  const group = rig.root;

  // Invisible hitboxes used for shooting (same size for every avatar, so it's fair).
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const hitBody = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.75, 4, 8), hitMat);
  hitBody.position.y = 0.72;
  const hitHead = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), hitMat);
  hitHead.position.y = 1.6;
  hitBody.userData.part = 'body';
  hitHead.userData.part = 'head';
  group.add(hitBody, hitHead);

  let t = Math.random() * 10, phase = 0, kick = 0, flash = false;
  return {
    group, hitBody, hitHead, gunMesh: rig.gunMesh, gunStrip: rig.gunStrip,
    animate(dt, speed) {
      t += dt;
      const amt = Math.min(speed / 5, 1);
      phase += dt * (3 + speed * 1.7);
      const swing = Math.sin(phase) * 0.75 * amt;
      rig.legs[0].rotation.x = swing;
      rig.legs[1].rotation.x = -swing;
      rig.hips.position.y = 0.88 + Math.abs(Math.cos(phase)) * 0.05 * amt + Math.sin(t * 2.2) * 0.008;
      rig.torso.rotation.set(0.1 * amt, Math.sin(phase) * 0.1 * amt, 0);
      rig.head.rotation.set(-0.08 * amt + Math.sin(t * 1.3) * 0.03, Math.sin(t * 0.7) * 0.06, 0);
      kick = Math.max(0, kick - dt * 9);
      rig.arms[1].rotation.x = 1.35 + kick * 0.35;
      rig.arms[0].rotation.x = 1.25 + kick * 0.3;
      rig.gunMesh.position.z = -0.5 + kick * 0.06;
      rig.gunStrip.position.z = -0.5 + kick * 0.06;
      if (rig.extra) rig.extra(t, amt, flash);
    },
    setFlash(on) { flash = on; kit.uFlash.value = on ? 0.55 : 0; },
    kick() { kick = 1; },
  };
}
