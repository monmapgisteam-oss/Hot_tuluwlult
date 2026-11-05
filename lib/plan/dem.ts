// Өндрийн тор — Copernicus GLO-30, сервер /api/dem-ээр полигоны UTM бүсэд.
// Тэнхлэгийн A* зам, инженерийн шугамын налуу, ИБАХ (налуу, шороон ажил, урсац)-д ашиглана.
import { planWkid, type XY } from "./geom";

export type Dem = { x0: number; y0: number; cell: number; nx: number; ny: number; z: Float64Array };

const cache = new Map<string, Promise<Dem>>();

export function loadDem(b: { x0: number; y0: number; x1: number; y1: number }, cell: number): Promise<Dem> {
  const x0 = Math.floor(b.x0 / cell) * cell, y0 = Math.floor(b.y0 / cell) * cell;
  const nx = Math.ceil((b.x1 - x0) / cell) + 1, ny = Math.ceil((b.y1 - y0) / cell) + 1;
  const wkid = planWkid(), key = `${wkid}|${x0}|${y0}|${nx}|${ny}|${cell}`;
  if (!cache.has(key)) {
    const pr = (async () => {
      const r = await fetch("/api/dem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wkid, x0, y0, nx, ny, cell }) });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `Өндөр уншигдсангүй (${r.status}).`);
      const z = Float64Array.from(new Float32Array(await r.arrayBuffer()));
      // Өндөр дутуу бол 0/хөрш утгаар зохиомлоор нөхөхгүй.
      const missing = z.reduce((s, v) => s + (!Number.isFinite(v) ? 1 : 0), 0);
      if (missing) throw new Error(`DEM өндөр дутуу: ${missing}/${z.length} цэг.`);
      return { x0, y0, cell, nx, ny, z };
    })();
    pr.catch(() => cache.delete(key));
    cache.set(key, pr);
  }
  return cache.get(key)!;
}

/** Билинеар өндөр */
export function zAt(d: Dem, x: number, y: number) {
  const fx = Math.min(d.nx - 1.001, Math.max(0, (x - d.x0) / d.cell)), fy = Math.min(d.ny - 1.001, Math.max(0, (y - d.y0) / d.cell));
  const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
  const a = d.z[j * d.nx + i], b = d.z[j * d.nx + i + 1], c = d.z[(j + 1) * d.nx + i], e = d.z[(j + 1) * d.nx + i + 1];
  return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + e * tx * ty;
}

/** Налуу, % */
export function slopeAt(d: Dem, x: number, y: number) {
  const h = d.cell;
  const gx = (zAt(d, x + h, y) - zAt(d, x - h, y)) / (2 * h), gy = (zAt(d, x, y + h) - zAt(d, x, y - h)) / (2 * h);
  return Math.hypot(gx, gy) * 100;
}

export const cellXY = (d: Dem, k: number): XY => [d.x0 + (k % d.nx) * d.cell, d.y0 + Math.floor(k / d.nx) * d.cell];
export const cellOf = (d: Dem, x: number, y: number) => {
  const i = Math.round((x - d.x0) / d.cell), j = Math.round((y - d.y0) / d.cell);
  return i < 0 || j < 0 || i >= d.nx || j >= d.ny ? -1 : j * d.nx + i;
};

/** D8 урсацын чиглэл ба хуримтлал (нүдний тоо) */
export function d8(d: Dem, mask?: Uint8Array) {
  const N = d.nx * d.ny, to = new Int32Array(N).fill(-1), acc = new Float64Array(N);
  const nb = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (let k = 0; k < N; k++) {
    if (mask && !mask[k]) continue;
    const i = k % d.nx, j = Math.floor(k / d.nx);
    let best = 0, bk = -1;
    for (const [di, dj] of nb) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= d.nx || b >= d.ny) continue;
      const kk = b * d.nx + a;
      const g = (d.z[k] - d.z[kk]) / (Math.hypot(di, dj) * d.cell);
      if (g > best) { best = g; bk = kk; }
    }
    to[k] = bk;
  }
  // өндрөөс нам руу эрэмбэлж хуримтлуулна
  const order = Array.from({ length: N }, (_, k) => k).filter((k) => !mask || mask[k]).sort((a, b) => d.z[b] - d.z[a]);
  for (const k of order) { acc[k] += 1; if (to[k] >= 0) acc[to[k]] += acc[k]; }
  return { to, acc };
}
