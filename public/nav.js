// Bot navigation: a 1 m grid over the arena floor and A* pathfinding on it.
// Only obstacles at body height block a cell (things stacked on top don't matter).

export function buildNav(colliders, size, radius = 0.45) {
  const N = Math.round(size), half = size / 2;
  const blocked = new Uint8Array(N * N);
  for (let gz = 0; gz < N; gz++) {
    for (let gx = 0; gx < N; gx++) {
      const x = gx - half + 0.5, z = gz - half + 0.5;
      for (const b of colliders) {
        if (b.minY > 0.5 || b.maxY < 0.3) continue;
        if (x + radius > b.minX && x - radius < b.maxX && z + radius > b.minZ && z - radius < b.maxZ) {
          blocked[gz * N + gx] = 1;
          break;
        }
      }
    }
  }
  return { N, half, blocked };
}

const clampI = (v, n) => (v < 0 ? 0 : v >= n ? n - 1 : v);
function cellOf(nav, x, z) {
  return [clampI(Math.floor(x + nav.half), nav.N), clampI(Math.floor(z + nav.half), nav.N)];
}
const free = (nav, gx, gz) => gx >= 0 && gz >= 0 && gx < nav.N && gz < nav.N && !nav.blocked[gz * nav.N + gx];

// Closest open cell (for goals that sit inside or next to an obstacle).
function nearestFree(nav, gx, gz) {
  if (free(nav, gx, gz)) return [gx, gz];
  for (let r = 1; r < 8; r++) {
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) === r && free(nav, gx + dx, gz + dz)) return [gx + dx, gz + dz];
    }
  }
  return [gx, gz];
}

// Is the straight line between two points walkable? (used to skip unnecessary waypoints)
export function lineFree(nav, ax, az, bx, bz) {
  const len = Math.hypot(bx - ax, bz - az), steps = Math.ceil(len / 0.3);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const [gx, gz] = cellOf(nav, ax + (bx - ax) * t, az + (bz - az) * t);
    if (!free(nav, gx, gz)) return false;
  }
  return true;
}

// A* from (fx,fz) to (tx,tz). Returns a list of {x, z} waypoints (smoothed), or [] if unreachable.
export function findPath(nav, fx, fz, tx, tz) {
  const { N } = nav;
  const [sx, sz] = nearestFree(nav, ...cellOf(nav, fx, fz));
  const [ex, ez] = nearestFree(nav, ...cellOf(nav, tx, tz));
  const start = sz * N + sx, goal = ez * N + ex;
  const g = new Float32Array(N * N).fill(Infinity);
  const came = new Int32Array(N * N).fill(-1);
  const closed = new Uint8Array(N * N);
  const heap = [];
  const push = (i, f) => {
    heap.push([f, i]);
    let k = heap.length - 1;
    while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top[1];
  };
  const h = (i) => { const x = i % N, z = (i / N) | 0; const dx = Math.abs(x - ex), dz = Math.abs(z - ez); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
  g[start] = 0;
  push(start, h(start));
  let found = false;
  while (heap.length) {
    const cur = pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goal) { found = true; break; }
    const cx = cur % N, cz = (cur / N) | 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const nx = cx + dx, nz = cz + dz;
      if (!free(nav, nx, nz)) continue;
      if (dx && dz && (!free(nav, cx + dx, cz) || !free(nav, cx, cz + dz))) continue; // no corner cutting
      const ni = nz * N + nx;
      const ng = g[cur] + (dx && dz ? 1.414 : 1);
      if (ng < g[ni]) { g[ni] = ng; came[ni] = cur; push(ni, ng + h(ni)); }
    }
  }
  if (!found) return [];
  const cells = [];
  for (let i = goal; i !== -1; i = came[i]) cells.push(i);
  cells.reverse();
  const pts = cells.map((i) => ({ x: (i % N) - nav.half + 0.5, z: ((i / N) | 0) - nav.half + 0.5 }));
  pts[pts.length - 1] = { x: tx, z: tz };
  // Smooth: from each point, jump to the farthest point in a straight walkable line.
  const out = [];
  let a = { x: fx, z: fz }, k = 0;
  while (k < pts.length) {
    let far = k;
    for (let j = pts.length - 1; j > k; j--) {
      if (lineFree(nav, a.x, a.z, pts[j].x, pts[j].z)) { far = j; break; }
    }
    out.push(pts[far]);
    a = pts[far];
    k = far + 1;
  }
  return out;
}
