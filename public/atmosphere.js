// Visual atmosphere for Neon Arena: sky, glowing trims, rain, mist, light beams, signs, hologram,
// and the final color-grading pass. Everything here is decoration: none of it affects gameplay.
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const rand = (a, b) => a + Math.random() * (b - a);
const hdr = (c, k) => new THREE.Color(c).multiplyScalar(k);

// Shared clock uniform so every shader animates in sync.
export const uTime = { value: 0 };

// ------------------------------------------------------------------ glowing-edge material
// A dark, slightly wet material whose box edges glow (anti-aliased, constant width at any size),
// plus a thin horizontal band near the top of taller boxes.
let streakTex;
function streakTexture() {
  if (streakTex) return streakTex;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#6a6a6a'; g.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 90; i++) { // vertical rain streaks = shinier lines
    const x = Math.random() * 128, w = rand(0.5, 2.5);
    g.fillStyle = `rgba(20,20,20,${rand(0.15, 0.5)})`;
    g.fillRect(x, rand(-40, 200), w, rand(30, 200));
  }
  for (let i = 0; i < 600; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${rand(0.03, 0.1)})`;
    g.fillRect(Math.random() * 128, Math.random() * 256, 2, 2);
  }
  streakTex = new THREE.CanvasTexture(c);
  return streakTex;
}

export function trimMaterial({
  half, trim = 0x00e5ff, intensity = 2.2, width = 0.05, band = true,
  color = 0x141826, roughness = 0.42, metalness = 0.55, emissiveMap = null, emissiveIntensity = 0,
}) {
  const mat = new THREE.MeshStandardMaterial({
    color, roughness, metalness, roughnessMap: streakTexture(),
    emissive: emissiveMap ? 0xffffff : 0x000000, emissiveMap, emissiveIntensity,
  });
  const trimColor = hdr(trim, intensity);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uHalf = { value: half };
    sh.uniforms.uTrim = { value: trimColor };
    sh.uniforms.uWidth = { value: width };
    sh.uniforms.uBand = { value: band ? 1 : 0 };
    sh.vertexShader = 'varying vec3 vObjPos;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>', '#include <begin_vertex>\n  vObjPos = position;');
    sh.fragmentShader = 'varying vec3 vObjPos;\nuniform vec3 uHalf;\nuniform vec3 uTrim;\nuniform float uWidth;\nuniform float uBand;\n'
      + sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  {
    vec3 dd = uHalf - abs(vObjPos);
    float mn = min(dd.x, min(dd.y, dd.z));
    float mx = max(dd.x, max(dd.y, dd.z));
    float mid = dd.x + dd.y + dd.z - mn - mx;           // distance to the nearest edge
    float fw = max(fwidth(mid), 1e-4);
    float edge = 1.0 - smoothstep(uWidth - fw, uWidth + fw, mid);
    float glow = exp(-mid * 9.0) * 0.18;                 // soft halo next to the edge
    float by = abs(vObjPos.y - (uHalf.y - 0.22));
    float fb = max(fwidth(by), 1e-4);
    float bandLine = (1.0 - smoothstep(0.016 - fb, 0.016 + fb, by)) * uBand * step(1.05, uHalf.y * 2.0);
    totalEmissiveRadiance += uTrim * (edge + glow + bandLine * 0.6);
  }`);
  };
  mat.customProgramCacheKey = () => 'trim-v2';
  return mat;
}

// ------------------------------------------------------------------ sky
export function makeSky(cfg) {
  const v3 = (a) => new THREE.Vector3(...a);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uTime,
      uTop: { value: v3(cfg.top) }, uMid: { value: v3(cfg.mid) }, uHor: { value: v3(cfg.hor) }, uHorSun: { value: v3(cfg.horSun) },
      uSunDir: { value: v3(cfg.sunDir).normalize() }, uSunGlow: { value: v3(cfg.sunGlow) },
      uCloudDark: { value: v3(cfg.cloudDark) }, uCloudLit: { value: v3(cfg.cloudLit) },
      uBelow: { value: v3(cfg.below) }, uClouds: { value: cfg.clouds },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vDir;
      uniform float uTime, uClouds;
      uniform vec3 uTop, uMid, uHor, uHorSun, uSunDir, uSunGlow, uCloudDark, uCloudLit, uBelow;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
        return v;
      }
      void main() {
        float h = vDir.y;
        vec2 flatSun = normalize(uSunDir.xz + 1e-4);
        float toSun = max(dot(normalize(vDir.xz + 1e-4), flatSun), 0.0);
        vec3 hor = mix(uHor, uHorSun, toSun);
        vec3 col = mix(uMid, uTop, smoothstep(0.08, 0.7, h));
        col = mix(hor, col, smoothstep(-0.02, 0.3, h));
        col += uSunGlow * pow(max(dot(vDir, uSunDir), 0.0), 64.0) * 1.5;   // sun glow
        col += uSunGlow * pow(max(dot(vDir, uSunDir), 0.0), 900.0) * 6.0;  // sun disc
        vec2 uv = vDir.xz / (h + 0.18) * 1.6 + vec2(uTime * 0.012, uTime * 0.004);
        float cl = smoothstep(0.42, 0.85, fbm(uv));
        vec3 cloudCol = mix(uCloudDark, uCloudLit, toSun * (1.0 - smoothstep(0.0, 0.5, h)) + 0.25 * step(0.5, uSunDir.y));
        col = mix(col, cloudCol, cl * smoothstep(0.0, 0.25, h) * uClouds);
        col = mix(uBelow, col, smoothstep(-0.15, 0.0, h));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(320, 48, 24), mat);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  return sky;
}

// ------------------------------------------------------------------ rain
export function makeRain(count, color = [0.16, 0.18, 0.24]) {
  const pos = new Float32Array(count * 6), end = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const x = rand(-25, 25), y = rand(0, 26), z = rand(-25, 25);
    pos.set([x, y, z, x, y, z], i * 6);
    end[i * 2 + 1] = 1;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  const uCam = { value: new THREE.Vector3() };
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime, uCam, uColor: { value: new THREE.Color(...color) } },
    vertexShader: /* glsl */`
      attribute float aEnd;
      uniform float uTime;
      uniform vec3 uCam;
      varying float vA;
      void main() {
        vec3 p = position;
        float speed = 20.0 + fract(p.x * 13.7) * 8.0;
        p.y = mod(p.y - uTime * speed, 26.0);
        p.x = uCam.x + mod(p.x - uCam.x + 25.0, 50.0) - 25.0;
        p.z = uCam.z + mod(p.z - uCam.z + 25.0, 50.0) - 25.0;
        p += vec3(0.1, 0.75, 0.04) * aEnd;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float d = length(mv.xyz);
        vA = (1.0 - smoothstep(8.0, 24.0, d)) * smoothstep(0.4, 2.0, d) * (0.25 + 0.75 * aEnd);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      varying float vA;
      void main() { gl_FragColor = vec4(uColor * vA, 1.0); }`,
  });
  const rain = new THREE.LineSegments(geo, mat);
  rain.frustumCulled = false;
  rain.userData.update = (cam) => uCam.value.copy(cam.position);
  return rain;
}

// Little rings where raindrops hit the ground.
export function makeRipples(count) {
  const base = new THREE.PlaneGeometry(1, 1);
  base.rotateX(-Math.PI / 2);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  geo.setAttribute('uv', base.getAttribute('uv'));
  const data = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) data.set([rand(-20, 20), rand(-20, 20), Math.random(), rand(0.8, 1.6)], i * 4);
  geo.setAttribute('aData', new THREE.InstancedBufferAttribute(data, 4));
  geo.instanceCount = count;
  const uCam = { value: new THREE.Vector3() };
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime, uCam },
    vertexShader: /* glsl */`
      attribute vec4 aData;
      uniform float uTime;
      uniform vec3 uCam;
      varying vec2 vUv;
      varying float vT;
      float hash(float n) { return fract(sin(n) * 43758.5453); }
      void main() {
        float cyc = uTime * aData.w + aData.z;
        float t = fract(cyc), id = floor(cyc);
        vec2 c = aData.xy + vec2(hash(id * 1.31 + aData.x), hash(id * 2.17 + aData.y)) * 10.0 - 5.0;
        c = uCam.xz + mod(c - uCam.xz + 20.0, 40.0) - 20.0;
        vec3 p = vec3(c.x, 0.012, c.y) + position * (0.06 + t * 0.3);
        vUv = uv; vT = t;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */`
      varying vec2 vUv;
      varying float vT;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float ring = smoothstep(0.68, 0.84, d) * (1.0 - smoothstep(0.86, 1.0, d));
        gl_FragColor = vec4(vec3(0.35, 0.45, 0.65) * ring * (1.0 - vT) * (1.0 - vT) * 0.35, 1.0);
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  m.userData.update = (cam) => uCam.value.copy(cam.position);
  return m;
}

// Slow drifting glow motes in the air.
export function makeMotes(count, size) {
  const palette = [0x00e5ff, 0xff2bd6, 0x8b5cff, 0xff8a00].map((c) => new THREE.Color(c));
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos.set([rand(-size, size), rand(0.3, 9), rand(-size, size)], i * 3);
    const c = palette[i % palette.length];
    col.set([c.r, c.g, c.b], i * 3);
    seed[i] = Math.random() * 100;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const uScale = { value: 600 };
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
    uniforms: { uTime, uScale },
    vertexShader: /* glsl */`
      attribute float aSeed;
      uniform float uTime;
      uniform float uScale;
      varying vec3 vCol;
      varying float vA;
      void main() {
        vec3 p = position;
        p.x += sin(uTime * 0.21 + aSeed) * 1.2;
        p.y += sin(uTime * 0.17 + aSeed * 1.7) * 0.6;
        p.z += cos(uTime * 0.19 + aSeed * 0.7) * 1.2;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uScale * 0.06 / -mv.z;
        vCol = color;
        vA = (0.5 + 0.5 * sin(uTime * 1.3 + aSeed * 3.0)) * (1.0 - smoothstep(20.0, 45.0, -mv.z));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vCol;
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = exp(-d * d * 4.0) * vA;
        gl_FragColor = vec4(vCol * a * 1.6, 1.0);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.userData.setScale = (h, fov) => { uScale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2)); };
  return pts;
}

// ------------------------------------------------------------------ light beams & pools
const beamMat = (color) => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  uniforms: { uColor: { value: hdr(color, 1) }, uTime },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    varying vec3 vN;
    varying vec3 vV;
    varying vec3 vW;
    void main() {
      vUv = uv;
      vec4 w = modelMatrix * vec4(position, 1.0);
      vW = w.xyz;
      vN = normalize(mat3(modelMatrix) * normal);
      vV = normalize(cameraPosition - w.xyz);
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: /* glsl */`
    uniform vec3 uColor;
    uniform float uTime;
    varying vec2 vUv;
    varying vec3 vN;
    varying vec3 vV;
    varying vec3 vW;
    void main() {
      float facing = abs(dot(vN, vV));                    // soft edges on the silhouette
      float fall = pow(clamp(vUv.y, 0.0, 1.0), 1.6);      // brightest at the lamp (clamped: pow of a negative is NaN)
      float dust = 0.85 + 0.15 * sin(vW.y * 6.0 - uTime * 3.0 + vW.x * 2.0);
      gl_FragColor = vec4(uColor * facing * facing * fall * dust * 0.05, 1.0);
    }`,
});

let poolTex;
export function glowTexture() {
  if (poolTex) return poolTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.4, 'rgba(255,255,255,.35)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  poolTex = new THREE.CanvasTexture(c);
  return poolTex;
}

export function glowSprite(color, size, k = 2) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color: hdr(color, k), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  s.scale.setScalar(size);
  return s;
}

// A street lamp: pole, glowing head, a soft cone of light and a pool of light on the ground.
// Returns the group plus a collider box for the pole.
export function makeLamp(x, z, color, height = 5.6) {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x1a1d28, roughness: 0.4, metalness: 0.8 });
  const pole = new THREE.Mesh(new THREE.BoxGeometry(0.18, height, 0.18), metal);
  pole.position.y = height / 2;
  pole.castShadow = true;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.5), metal);
  head.position.y = height;
  const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.03, 0.42), new THREE.MeshBasicMaterial({ color: hdr(color, 2.2) }));
  bulb.position.y = height - 0.075;
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 3.4, height - 0.1, 32, 1, true), beamMat(color));
  beam.position.y = (height - 0.1) / 2;
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), new THREE.MeshBasicMaterial({
    map: glowTexture(), color: hdr(color, 0.18), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.02;
  const halo = glowSprite(color, 1.6, 0.6);
  halo.position.y = height - 0.15;
  g.add(pole, head, bulb, beam, pool, halo);
  g.position.set(x, 0, z);
  const light = new THREE.PointLight(color, 38, 22, 2);
  light.position.set(x, height - 0.6, z);
  return {
    group: g, light, pole,
    collider: { minX: x - 0.09, maxX: x + 0.09, minY: 0, maxY: height, minZ: z - 0.09, maxZ: z + 0.09 },
  };
}

// ------------------------------------------------------------------ neon signs
export function makeSign(text, color, width = 6) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const g = c.getContext('2d');
  const css = '#' + new THREE.Color(color).getHexString();
  g.strokeStyle = css; g.lineWidth = 6;
  g.shadowColor = css; g.shadowBlur = 18;
  g.strokeRect(14, 14, 996, 228);
  g.font = '800 120px "Segoe UI", system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  g.fillText(text, 512, 134);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: hdr(color, 1.25), transparent: true, depthWrite: false });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 4), mat);
  const base = mat.color.clone();
  // Neon flicker: mostly steady, with the occasional stutter.
  let off = 0, next = rand(2, 12);
  m.userData.update = (t, dt) => {
    next -= dt;
    if (next <= 0) { off = rand(0.05, 0.25); next = rand(3, 14); }
    if (off > 0) { off -= dt; mat.color.copy(base).multiplyScalar(Math.random() < 0.5 ? 0.15 : 0.7); }
    else mat.color.copy(base).multiplyScalar(0.92 + 0.08 * Math.sin(t * 30));
  };
  return m;
}

// ------------------------------------------------------------------ hologram over the center tower
export function makeHologram() {
  const g = new THREE.Group();
  const ringA = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.035, 8, 96), new THREE.MeshBasicMaterial({ color: hdr(0xff2bd6, 1.5) }));
  const ringB = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.03, 8, 96), new THREE.MeshBasicMaterial({ color: hdr(0x00e5ff, 1.5) }));
  const coreGeo = new THREE.IcosahedronGeometry(0.75, 0);
  const core = new THREE.LineSegments(new THREE.EdgesGeometry(coreGeo), new THREE.LineBasicMaterial({ color: hdr(0xffffff, 1.3) }));
  const coreFill = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({
    color: hdr(0xff2bd6, 0.6), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 2.2, 5, 32, 1, true), beamMat(0xff2bd6));
  shaft.rotation.x = Math.PI; // brightest at the bottom (tower top), fading upwards
  shaft.position.y = -1.9;
  const halo = glowSprite(0xff2bd6, 5, 0.25);
  g.add(ringA, ringB, core, coreFill, shaft, halo);
  g.position.set(0, 7, 0);
  g.userData.update = (t) => {
    ringA.rotation.set(Math.PI / 2 + Math.sin(t * 0.5) * 0.3, t * 0.4, 0);
    ringB.rotation.set(Math.PI / 2 + Math.cos(t * 0.6) * 0.5, -t * 0.7, t * 0.2);
    core.rotation.set(t * 0.3, t * 0.5, 0);
    coreFill.rotation.copy(core.rotation);
    g.position.y = 7 + Math.sin(t * 0.8) * 0.15;
  };
  return g;
}

// ------------------------------------------------------------------ wet floor texture
// Dark tiles with puddles. Returns the color map, roughness map (puddles are glossy)
// and an alpha map (puddles are see-through so the mirror underneath shows).
export function floorTextures(maxAniso) {
  const N = 1024;
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = N; return [c, c.getContext('2d')]; };
  const [cc, cg] = mk(), [rc, rg] = mk(), [ac, ag] = mk(), [ec, eg] = mk();
  // base color: dark concrete tiles
  cg.fillStyle = '#121420'; cg.fillRect(0, 0, N, N);
  for (let i = 0; i < 9000; i++) {
    cg.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${rand(0.02, 0.06)})`;
    cg.fillRect(Math.random() * N, Math.random() * N, rand(1, 3), rand(1, 3));
  }
  cg.strokeStyle = '#090a12'; cg.lineWidth = 6;
  for (let i = 0; i <= 4; i++) {
    cg.beginPath(); cg.moveTo(i * N / 4, 0); cg.lineTo(i * N / 4, N); cg.stroke();
    cg.beginPath(); cg.moveTo(0, i * N / 4); cg.lineTo(N, i * N / 4); cg.stroke();
  }
  // roughness + alpha: start rough/opaque, paint glossy see-through puddles
  rg.fillStyle = '#b0b0b0'; rg.fillRect(0, 0, N, N);
  ag.fillStyle = '#dcdcdc'; ag.fillRect(0, 0, N, N); // the whole floor is a little wet
  for (let i = 0; i < 9; i++) {
    const x = Math.random() * N, y = Math.random() * N, r = rand(60, 190);
    for (const [ox, oy] of [[0, 0], [N, 0], [-N, 0], [0, N], [0, -N]]) {
      for (let k = 0; k < 5; k++) { // irregular blob from overlapping soft circles
        const px = x + ox + rand(-r, r) * 0.6, py = y + oy + rand(-r, r) * 0.4, pr = r * rand(0.4, 0.8);
        let gr = rg.createRadialGradient(px, py, 0, px, py, pr);
        gr.addColorStop(0, 'rgba(10,10,10,1)'); gr.addColorStop(0.7, 'rgba(10,10,10,.8)'); gr.addColorStop(1, 'rgba(10,10,10,0)');
        rg.fillStyle = gr; rg.beginPath(); rg.arc(px, py, pr, 0, 7); rg.fill();
        gr = ag.createRadialGradient(px, py, 0, px, py, pr);
        gr.addColorStop(0, 'rgba(70,70,70,1)'); gr.addColorStop(0.7, 'rgba(70,70,70,.8)'); gr.addColorStop(1, 'rgba(70,70,70,0)');
        ag.fillStyle = gr; ag.beginPath(); ag.arc(px, py, pr, 0, 7); ag.fill();
      }
    }
  }
  // emissive: thin neon seams between tiles
  eg.fillStyle = '#000'; eg.fillRect(0, 0, N, N);
  eg.strokeStyle = '#0aa8ff'; eg.lineWidth = 2;
  eg.strokeRect(1, 1, N - 2, N - 2);
  const tex = (c, srgb, rep) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rep, rep);
    t.anisotropy = maxAniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { map: tex(cc, true, 4), roughnessMap: tex(rc, false, 4), alphaMap: tex(ac, false, 4), emissiveMap: tex(ec, false, 8) };
}

// ------------------------------------------------------------------ final grade
// Runs after tone mapping: chromatic aberration at the edges, shadow tint, saturation,
// vignette and film grain.
export function makeGradePass() {
  return new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTime, uRes: { value: new THREE.Vector2(1, 1) } },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tDiffuse;
      uniform float uTime;
      uniform vec2 uRes;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        vec2 c = vUv - 0.5;
        float r2 = dot(c, c);
        vec2 off = c * r2 * 0.005;
        vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
        float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col += vec3(0.008, 0.006, 0.016) * (1.0 - smoothstep(0.0, 0.35, l));   // violet shadows
        col = mix(vec3(l), col, 1.05);                                         // a touch more saturation
        col *= 1.0 - smoothstep(0.3, 1.0, length(c) * 1.3) * 0.35;           // vignette
        col += (hash(vUv * uRes + fract(uTime * 7.3) * 100.0) - 0.5) * 0.018;  // grain
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}
