// Procedural textures (no image files): concrete, asphalt, shipping containers, wood crates,
// steel plates, hazard stripes and gun materials (gunmetal, polymer, wood).
// Each generator returns { map, normalMap, roughnessMap } built from canvases.
import * as THREE from 'three';

// ------------------------------------------------------------------ noise helpers
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

// Tileable value noise with separate cell counts per axis.
// In fbm(), stretch > 1 gives features long along x (horizontal grain), < 1 long along y.
function noise(size, cx, cy, rand) {
  const g = new Float32Array(cx * cy);
  for (let i = 0; i < g.length; i++) g[i] = rand();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * cy, y0 = Math.floor(fy), ty = fy - y0, y1 = (y0 + 1) % cy;
    const sy = ty * ty * (3 - 2 * ty);
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cx, x0 = Math.floor(fx), tx = fx - x0, x1 = (x0 + 1) % cx;
      const sx = tx * tx * (3 - 2 * tx);
      const a = g[y0 * cx + x0], b = g[y0 * cx + x1], c = g[y1 * cx + x0], d = g[y1 * cx + x1];
      out[y * size + x] = (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
    }
  }
  return out;
}

function fbm(size, cells, octaves, rand, stretch = 1) {
  const out = new Float32Array(size * size);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const c = cells * 2 ** o;
    const n = noise(size, Math.max(1, Math.round(c / stretch)), c, rand);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ------------------------------------------------------------------ packing into textures
function canvasOf(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

// height (0..1) -> tangent-space normal map
function normalCanvas(height, size, strength) {
  const c = canvasOf(size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size), d = img.data;
  for (let y = 0; y < size; y++) {
    const yu = ((y - 1 + size) % size) * size, yd = ((y + 1) % size) * size;
    for (let x = 0; x < size; x++) {
      const xl = (x - 1 + size) % size, xr = (x + 1) % size;
      const dx = (height[y * size + xr] - height[y * size + xl]) * strength;
      const dy = (height[yd + x] - height[yu + x]) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      d[i] = (-dx / len * 0.5 + 0.5) * 255;
      d[i + 1] = (dy / len * 0.5 + 0.5) * 255;
      d[i + 2] = (1 / len * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function grayCanvas(values, size) {
  const c = canvasOf(size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size), d = img.data;
  for (let i = 0; i < values.length; i++) {
    const v = clamp01(values[i]) * 255;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function colorCanvas(rgb, size) {
  const c = canvasOf(size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size), d = img.data;
  for (let i = 0; i < size * size; i++) {
    d[i * 4] = rgb[i * 3]; d[i * 4 + 1] = rgb[i * 3 + 1]; d[i * 4 + 2] = rgb[i * 3 + 2]; d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

let maxAniso = 8;
export function setMaxAnisotropy(n) { maxAniso = n; }

function tex(canvas, srgb) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// rgb: Uint8ClampedArray(size*size*3), height & rough: Float32Array(size*size)
function pack(size, rgb, height, rough, normalStrength, colorCanvasOverride) {
  return {
    map: tex(colorCanvasOverride || colorCanvas(rgb, size), true),
    normalMap: tex(normalCanvas(height, size, normalStrength), false),
    roughnessMap: tex(grayCanvas(rough, size), false),
  };
}

// Draw on top of a color array via a 2D canvas (for lines, text, shapes).
function paintOver(rgb, size, draw) {
  const c = colorCanvas(rgb, size);
  draw(c.getContext('2d'));
  return c;
}

// ------------------------------------------------------------------ materials
// Concrete: blotchy grey with pits and stains. seams: draw formwork panel lines + tie holes.
export function concrete({ size = 512, seed = 1, base = [138, 136, 132], seams = false, paint = null } = {}) {
  const r = rng(seed);
  const big = fbm(size, 3, 4, r), fine = fbm(size, 24, 3, r), stain = fbm(size, 2, 4, r);
  const rgb = new Uint8ClampedArray(size * size * 3), h = new Float32Array(size * size), ro = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    let v = 0.82 + big[i] * 0.22 + (fine[i] - 0.5) * 0.18;
    const st = clamp01((stain[i] - 0.5) * 3);
    v *= 1 - st * 0.22;
    h[i] = fine[i] * 0.7 + big[i] * 0.3;
    ro[i] = 0.92 - st * 0.18;
    rgb[i * 3] = base[0] * v; rgb[i * 3 + 1] = base[1] * v * (1 - st * 0.03); rgb[i * 3 + 2] = base[2] * v * (1 - st * 0.08);
  }
  for (let k = 0; k < size * 3; k++) { // little pits
    const x = Math.floor(r() * size), y = Math.floor(r() * size), i = y * size + x;
    h[i] -= 0.5; rgb[i * 3] *= 0.6; rgb[i * 3 + 1] *= 0.6; rgb[i * 3 + 2] *= 0.6;
  }
  if (seams) {
    const step = size / 2;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const onSeam = x % step < 2 || y % step < 2;
      const hx = (x % step) - step / 2, hy = (y % step) - step / 2;
      const hole = [[-step / 3, -step / 3], [step / 3, -step / 3], [-step / 3, step / 3], [step / 3, step / 3]]
        .some(([ax, ay]) => (hx - ax) ** 2 + (hy - ay) ** 2 < 36);
      if (onSeam || hole) {
        const i = y * size + x;
        h[i] -= 0.6;
        rgb[i * 3] *= 0.55; rgb[i * 3 + 1] *= 0.55; rgb[i * 3 + 2] *= 0.55;
      }
    }
  }
  return pack(size, rgb, h, ro, 3.5, paint ? paintOver(rgb, size, paint) : null);
}

// Dock floor: pale concrete slabs with yellow safety lines and tyre marks.
export function dockFloor({ size = 1024 } = {}) {
  return concrete({ size, seed: 15, base: [168, 164, 156], paint: (g) => {
    g.globalAlpha = 0.18; g.strokeStyle = '#222'; g.lineWidth = 3;      // slab joints
    for (let i = 0; i <= 4; i++) {
      g.beginPath(); g.moveTo(i * size / 4, 0); g.lineTo(i * size / 4, size); g.stroke();
      g.beginPath(); g.moveTo(0, i * size / 4); g.lineTo(size, i * size / 4); g.stroke();
    }
    g.globalAlpha = 0.8; g.strokeStyle = '#d9b32a'; g.lineWidth = 12; // yellow walkway lines
    g.beginPath(); g.moveTo(size * 0.05, 0); g.lineTo(size * 0.05, size); g.stroke();
    g.beginPath(); g.moveTo(0, size * 0.55); g.lineTo(size, size * 0.55); g.stroke();
    g.globalAlpha = 0.12; g.strokeStyle = '#111'; g.lineWidth = 26;    // tyre marks
    g.beginPath(); g.moveTo(size * 0.2, size); g.bezierCurveTo(size * 0.3, size * 0.6, size * 0.6, size * 0.5, size * 0.8, 0); g.stroke();
    g.beginPath(); g.moveTo(size * 0.26, size); g.bezierCurveTo(size * 0.36, size * 0.6, size * 0.66, size * 0.5, size * 0.86, 0); g.stroke();
    g.globalAlpha = 1;
  } });
}

// Brick wall: staggered bricks with mortar. Tint per building with material.color.
export function brick({ size = 512, seed = 51 } = {}) {
  const r = rng(seed);
  const fine = fbm(size, 32, 3, r), blot = fbm(size, 3, 4, r);
  const rgb = new Uint8ClampedArray(size * size * 3), h = new Float32Array(size * size), ro = new Float32Array(size * size);
  const rows = 16, bh = size / rows, bw = size / 4;
  const tone = Array.from({ length: rows * 9 }, () => 0.8 + r() * 0.35);
  for (let y = 0; y < size; y++) {
    const row = Math.floor(y / bh), off = row % 2 ? bw / 2 : 0;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const bx = (x + off) % size, col = Math.floor(bx / bw);
      const mortar = y % bh < 3 || bx % bw < 3;
      const d = clamp01((blot[i] - 0.5) * 2.5); // grime
      const v = mortar ? 0.55 + fine[i] * 0.1 : tone[row * 9 + col] * (0.9 + (fine[i] - 0.5) * 0.25);
      const g = 1 - d * 0.3;
      if (mortar) { rgb[i * 3] = 150 * v * g; rgb[i * 3 + 1] = 146 * v * g; rgb[i * 3 + 2] = 138 * v * g; }
      else { rgb[i * 3] = 225 * v * g; rgb[i * 3 + 1] = 205 * v * g; rgb[i * 3 + 2] = 190 * v * g; }
      h[i] = mortar ? 0.1 : 0.7 + fine[i] * 0.3;
      ro[i] = mortar ? 0.95 : 0.8 - d * 0.1;
    }
  }
  return pack(size, rgb, h, ro, 6);
}

// Small animated-looking water ripples (normal map only).
export function waves({ size = 256 } = {}) {
  const r = rng(61);
  const h = fbm(size, 8, 4, r);
  return { normalMap: tex(normalCanvas(h, size, 6), false) };
}

// Asphalt ground with aggregate speckle, painted lane lines and wet (glossy) patches.
export function asphalt({ size = 1024, seed = 7 } = {}) {
  const r = rng(seed);
  const big = fbm(size, 4, 4, r), fine = fbm(size, 96, 2, r), wet = fbm(size, 3, 4, r);
  const rgb = new Uint8ClampedArray(size * size * 3), h = new Float32Array(size * size), ro = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    let v = 38 + big[i] * 18 + (fine[i] - 0.5) * 24;
    if (r() < 0.04) v += 40 * r(); // light aggregate stones
    const w = clamp01((wet[i] - 0.55) * 5);
    v *= 1 - w * 0.35; // wet = darker
    rgb[i * 3] = v; rgb[i * 3 + 1] = v; rgb[i * 3 + 2] = v * 1.04;
    h[i] = fine[i] * (1 - w * 0.8);
    ro[i] = 0.9 - w * 0.55; // wet = glossier
  }
  const painted = paintOver(rgb, size, (g) => {
    const lane = (x1, y1, x2, y2, color, width, dash) => {
      g.strokeStyle = color; g.lineWidth = width; g.setLineDash(dash || []);
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    };
    g.globalAlpha = 0.75;
    lane(size / 2, 0, size / 2, size, '#c9a227', 10, [70, 50]);          // dashed yellow center line
    lane(size * 0.1, 0, size * 0.1, size, '#d8d8d0', 7);                  // white edge lines
    lane(size * 0.9, 0, size * 0.9, size, '#d8d8d0', 7);
    for (let y = size * 0.15; y < size; y += size * 0.25) lane(size * 0.62, y, size * 0.88, y, '#d8d8d0', 6); // parking bays
    g.globalAlpha = 0.5;
    g.fillStyle = '#2a2a2a'; // a manhole cover
    g.beginPath(); g.arc(size * 0.3, size * 0.7, 34, 0, 7); g.fill();
    g.strokeStyle = '#5a5a5a'; g.lineWidth = 3; g.setLineDash([]);
    for (let k = 0; k < 5; k++) { g.beginPath(); g.moveTo(size * 0.3 - 28, size * 0.7 - 20 + k * 10); g.lineTo(size * 0.3 + 28, size * 0.7 - 20 + k * 10); g.stroke(); }
    g.globalAlpha = 1;
  });
  return pack(size, rgb, h, ro, 2.5, painted);
}

// Shipping container wall: corrugated, with dirt and rust streaks. Light base color:
// tint per container with material.color.
export function container({ size = 512, seed = 3 } = {}) {
  const r = rng(seed);
  const dirt = fbm(size, 4, 4, r), streak = fbm(size, 12, 3, r, 0.15), fine = fbm(size, 48, 2, r);
  const rgb = new Uint8ClampedArray(size * size * 3), h = new Float32Array(size * size), ro = new Float32Array(size * size);
  const ridges = 10;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const ph = (x / size) * ridges % 1;
    const corr = ph < 0.35 ? 1 : ph < 0.5 ? 1 - (ph - 0.35) / 0.15 : ph < 0.85 ? 0 : (ph - 0.85) / 0.15; // trapezoid ridges
    const rust = clamp01((streak[i] - 0.55) * 4) * (0.4 + 0.6 * (1 - y / size)); // streaks run down from the top
    const d = clamp01((dirt[i] - 0.45) * 2);
    let v = 0.86 - d * 0.25 + (fine[i] - 0.5) * 0.08 + corr * 0.06;
    rgb[i * 3] = 255 * v * (1 - rust * 0.25) + rust * 40;
    rgb[i * 3 + 1] = 255 * v * (1 - rust * 0.45);
    rgb[i * 3 + 2] = 255 * v * (1 - rust * 0.6);
    h[i] = corr * 0.9 + fine[i] * 0.1;
    ro[i] = 0.55 + d * 0.25 + rust * 0.2;
  }
  return pack(size, rgb, h, ro, 6);
}

// Wooden crate: planks, frame boards and a diagonal brace.
export function crate({ size = 512, seed = 11 } = {}) {
  const r = rng(seed);
  const grain = fbm(size, 3, 5, r, 8), fine = fbm(size, 40, 2, r);
  const rgb = new Uint8ClampedArray(size * size * 3), h = new Float32Array(size * size), ro = new Float32Array(size * size);
  const planks = 5, ph = size / planks;
  const shade = Array.from({ length: planks }, () => 0.85 + r() * 0.25);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, p = Math.floor(y / ph);
    const gap = y % ph < 3;
    const g = 0.75 + Math.sin((grain[i] * 18 + x * 0.004) * 3.1) * 0.12 + (fine[i] - 0.5) * 0.12;
    const v = gap ? 0.3 : g * shade[p];
    rgb[i * 3] = 168 * v; rgb[i * 3 + 1] = 122 * v; rgb[i * 3 + 2] = 76 * v;
    h[i] = gap ? 0 : 0.6 + grain[i] * 0.4;
    ro[i] = 0.82;
  }
  const painted = paintOver(rgb, size, (g) => {
    const board = (draw) => { g.save(); draw(); g.restore(); };
    const bw = size * 0.12;
    board(() => { // frame boards with a shadow edge
      g.fillStyle = 'rgba(190,140,90,0.9)';
      g.fillRect(0, 0, size, bw); g.fillRect(0, size - bw, size, bw); g.fillRect(0, 0, bw, size); g.fillRect(size - bw, 0, bw, size);
      g.strokeStyle = 'rgba(40,25,10,0.8)'; g.lineWidth = 4;
      g.strokeRect(bw, bw, size - bw * 2, size - bw * 2);
      g.strokeRect(2, 2, size - 4, size - 4);
    });
    board(() => { // diagonal brace
      g.translate(size / 2, size / 2); g.rotate(-Math.PI / 4);
      g.fillStyle = 'rgba(185,135,85,0.95)'; g.fillRect(-size * 0.7, -bw / 2, size * 1.4, bw);
      g.strokeStyle = 'rgba(40,25,10,0.8)'; g.lineWidth = 4; g.strokeRect(-size * 0.7, -bw / 2, size * 1.4, bw);
    });
    g.fillStyle = 'rgba(30,30,30,0.85)'; // nails
    for (const [x, y] of [[0.06, 0.06], [0.94, 0.06], [0.06, 0.94], [0.94, 0.94], [0.5, 0.06], [0.5, 0.94], [0.06, 0.5], [0.94, 0.5]]) {
      g.beginPath(); g.arc(x * size, y * size, 5, 0, 7); g.fill();
    }
    g.font = `bold ${size * 0.08}px sans-serif`; g.textAlign = 'center';
    g.fillStyle = 'rgba(30,20,10,0.45)'; g.fillText('FRAGILE', size * 0.5, size * 0.3); // stencil
  });
  // add frame/brace relief to the height map
  const ctx = painted.getContext('2d').getImageData(0, 0, size, size).data;
  for (let i = 0; i < size * size; i++) h[i] = h[i] * 0.7 + (ctx[i * 4] / 255) * 0.3;
  return pack(size, rgb, h, ro, 4, painted);
}

// Painted steel plates with rivets and scratches.
export function steelPlates({ size = 512, seed = 5 } = {}) {
  const r = rng(seed);
  const dirt = fbm(size, 4, 4, r), fine = fbm(size, 64, 2, r);
  const rgb = new Uint8ClampedArray(size * size * 3), h = new Float32Array(size * size), ro = new Float32Array(size * size);
  const step = size / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const sx = x % step, sy = y % step;
    const seam = sx < 3 || sy < 3;
    const rivet = [12, step - 12].some((a) => [12, step / 2, step - 12].some((b) => (sx - a) ** 2 + (sy - b) ** 2 < 30 || (sy - a) ** 2 + (sx - b) ** 2 < 30));
    const d = clamp01((dirt[i] - 0.45) * 2);
    let v = (0.7 - d * 0.25 + (fine[i] - 0.5) * 0.06) * (seam ? 0.45 : 1) * (rivet ? 1.25 : 1);
    rgb[i * 3] = 120 * v; rgb[i * 3 + 1] = 128 * v; rgb[i * 3 + 2] = 120 * v;
    h[i] = seam ? 0 : rivet ? 1 : 0.5 + fine[i] * 0.05;
    ro[i] = 0.5 + d * 0.3;
  }
  for (let k = 0; k < 60; k++) { // scratches: bright metal shows through
    let x = r() * size, y = r() * size;
    const a = r() * Math.PI, len = 20 + r() * 80;
    for (let t = 0; t < len; t++) {
      const i = (Math.floor(y + Math.sin(a) * t) & (size - 1)) * size + (Math.floor(x + Math.cos(a) * t) & (size - 1));
      rgb[i * 3] = 170; rgb[i * 3 + 1] = 172; rgb[i * 3 + 2] = 175; ro[i] = 0.3;
    }
  }
  return pack(size, rgb, h, ro, 5);
}

// Yellow/black hazard stripes (for the concrete barriers).
export function hazard({ size = 256 } = {}) {
  const c = canvasOf(size), g = c.getContext('2d');
  g.fillStyle = '#d8b21c'; g.fillRect(0, 0, size, size);
  g.fillStyle = '#18181a';
  for (let k = -size; k < size * 2; k += size / 2) {
    g.beginPath(); g.moveTo(k, 0); g.lineTo(k + size / 4, 0); g.lineTo(k + size / 4 - size, size); g.lineTo(k - size, size); g.fill();
  }
  const r = rng(9);
  for (let k = 0; k < 900; k++) { g.fillStyle = `rgba(0,0,0,${r() * 0.25})`; g.fillRect(r() * size, r() * size, 3, 3); } // wear
  return { map: tex(c, true) };
}

// ------------------------------------------------------------------ gun materials
// Gunmetal: dark brushed metal with edge wear and fine scratches.
export function gunmetal({ size = 256, seed = 21, base = [70, 72, 78] } = {}) {
  const r = rng(seed);
  const brush = fbm(size, 64, 2, r, 32), blot = fbm(size, 4, 3, r);
  const rgb = new Uint8ClampedArray(size * size * 3), h = new Float32Array(size * size), ro = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    const v = 0.88 + (brush[i] - 0.5) * 0.12 + (blot[i] - 0.5) * 0.12;
    rgb[i * 3] = base[0] * v; rgb[i * 3 + 1] = base[1] * v; rgb[i * 3 + 2] = base[2] * v;
    h[i] = brush[i];
    ro[i] = 0.32 + blot[i] * 0.25;
  }
  for (let k = 0; k < 40; k++) { // scratches
    const x = r() * size, y = r() * size, a = (r() - 0.5) * 0.6, len = 10 + r() * 50;
    for (let t = 0; t < len; t++) {
      const i = (Math.floor(y + Math.sin(a) * t) & (size - 1)) * size + (Math.floor(x + Math.cos(a) * t) & (size - 1));
      rgb[i * 3] = 140; rgb[i * 3 + 1] = 142; rgb[i * 3 + 2] = 148; ro[i] = 0.2; h[i] -= 0.3;
    }
  }
  return pack(size, rgb, h, ro, 1.5);
}

// Polymer (grips, stocks): matte with a stippled texture.
export function polymer({ size = 256, seed = 31 } = {}) {
  const r = rng(seed);
  const stip = fbm(size, 64, 2, r), blot = fbm(size, 4, 3, r);
  const rgb = new Uint8ClampedArray(size * size * 3), h = new Float32Array(size * size), ro = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    const v = 0.92 + (stip[i] - 0.5) * 0.16 + (blot[i] - 0.5) * 0.08;
    rgb[i * 3] = 34 * v; rgb[i * 3 + 1] = 35 * v; rgb[i * 3 + 2] = 38 * v;
    h[i] = stip[i];
    ro[i] = 0.78 + (stip[i] - 0.5) * 0.2;
  }
  return pack(size, rgb, h, ro, 1.6);
}

// Walnut wood for gun stocks.
export function walnut({ size = 256, seed = 41 } = {}) {
  const r = rng(seed);
  const grain = fbm(size, 2, 5, r, 10), fine = fbm(size, 48, 2, r);
  const rgb = new Uint8ClampedArray(size * size * 3), h = new Float32Array(size * size), ro = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const v = 0.7 + Math.sin(grain[i] * 30) * 0.15 + (fine[i] - 0.5) * 0.1;
    rgb[i * 3] = 120 * v; rgb[i * 3 + 1] = 70 * v; rgb[i * 3 + 2] = 40 * v;
    h[i] = grain[i];
    ro[i] = 0.45 + (fine[i] - 0.5) * 0.1;
  }
  return pack(size, rgb, h, ro, 1.5);
}

// ------------------------------------------------------------------ UV helper
// BoxGeometry gives every face UVs 0..1, which stretches textures. This rescales them so a
// texture covers `tile` metres, whatever the box size.
export function boxUV(geo, w, h, d, tile) {
  const uv = geo.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; // +x -x +y -y +z -z
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile);
    }
  }
  uv.needsUpdate = true;
  return geo;
}
