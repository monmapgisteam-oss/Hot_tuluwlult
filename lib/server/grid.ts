// Торны цэвэр тооцоолол: налуу, aspect, TPI, D8 урсац, хамгийн ойрын зай, цэг-полигон.
// Томьёо нь Бөөрөлжүүтийн geo.ts baseGrid, urbanSuit.ts flowAccum-тай ижил; нэмэлтээр 01_surface_suitability.py шиг
// хотгор дүүргэнэ (priority-flood): 30 м DEM-ийн жижиг хотгор урсацыг тасалж хуримтлалыг дутуу гаргадаг.

export type XY = [number, number];
export type Seg = [number, number, number, number];

/** i, j нүдний налуу (%), aspect (уруу чиглэл, хойд = 0, цагийн зүүний дагуу) */
export function slopeAspect(z: ArrayLike<number>, nx: number, ny: number, cell: number, i: number, j: number) {
  const at = (a: number, b: number) => z[Math.min(ny - 1, Math.max(0, b)) * nx + Math.min(nx - 1, Math.max(0, a))];
  const dzdx = (at(i + 1, j) - at(i - 1, j)) / (2 * cell);
  const dzdy = (at(i, j + 1) - at(i, j - 1)) / (2 * cell);
  return { slope: Math.hypot(dzdx, dzdy) * 100, aspect: ((Math.atan2(-dzdx, -dzdy) * 180) / Math.PI + 360) % 360 };
}

/** Нүдний өндрийг ±half нүдний цонхны дундажтай (төвөөс бусад) харьцуулна */
export function tpiAt(z: ArrayLike<number>, nx: number, ny: number, i: number, j: number, half: number) {
  let s = 0, c = 0;
  for (let b = Math.max(0, j - half); b <= Math.min(ny - 1, j + half); b++) {
    for (let a = Math.max(0, i - half); a <= Math.min(nx - 1, i + half); a++) {
      if (a === i && b === j) continue;
      const v = z[b * nx + a];
      if (Number.isFinite(v)) { s += v; c++; }
    }
  }
  return c ? z[j * nx + i] - s / c : NaN;
}

/** ±half нүдний цонх доторх өндрийн зөрүү, м — уул, толгодыг ялгана. Том цонхонд алхмаар дээжилнэ. */
export function reliefAt(z: ArrayLike<number>, nx: number, ny: number, i: number, j: number, half: number) {
  const step = Math.max(1, Math.floor(half / 8));
  let lo = Infinity, hi = -Infinity;
  for (let b = Math.max(0, j - half); b <= Math.min(ny - 1, j + half); b += step) {
    for (let a = Math.max(0, i - half); a <= Math.min(nx - 1, i + half); a += step) {
      const v = z[b * nx + a];
      if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
    }
  }
  return hi >= lo ? hi - lo : NaN;
}

/** Хотгор дүүргэсэн гадарга дээрх D8 хуримтлал, га. NaN нүд нь гадагшлах цэг болно. */
export function flowAccumulation(z: ArrayLike<number>, nx: number, ny: number, cell: number) {
  const N = nx * ny, EPS = 1e-3;
  let lowest = Infinity;
  for (let k = 0; k < N; k++) if (Number.isFinite(z[k]) && z[k] < lowest) lowest = z[k];
  const base = new Float64Array(N);
  for (let k = 0; k < N; k++) base[k] = Number.isFinite(z[k]) ? z[k] : lowest;
  const filled = Float64Array.from(base);

  // Хоёртын овоолго (өндрөөр эрэмбэлсэн)
  const heap = new Int32Array(N);
  let size = 0;
  const push = (k: number) => {
    let i = size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (filled[heap[p]] <= filled[k]) break;
      heap[i] = heap[p]; i = p;
    }
    heap[i] = k;
  };
  const pop = () => {
    const top = heap[0], last = heap[--size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= size) break;
      if (c + 1 < size && filled[heap[c + 1]] < filled[heap[c]]) c++;
      if (filled[last] <= filled[heap[c]]) break;
      heap[i] = heap[c]; i = c;
    }
    if (size > 0) heap[i] = last;
    return top;
  };

  const closed = new Uint8Array(N);
  const seed = (k: number) => { if (!closed[k]) { closed[k] = 1; push(k); } };
  for (let i = 0; i < nx; i++) { seed(i); seed((ny - 1) * nx + i); }
  for (let j = 0; j < ny; j++) { seed(j * nx); seed(j * nx + nx - 1); }

  // Гаргасан дараалал нь өндрөөр өсөх тул эсрэгээр нь явж хуримтлуулна
  const order = new Int32Array(N);
  let done = 0;
  while (size > 0) {
    const c = pop();
    order[done++] = c;
    const i = c % nx, j = (c - i) / nx;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
      const k = b * nx + a;
      if (closed[k]) continue;
      closed[k] = 1;
      filled[k] = Math.max(base[k], filled[c] + EPS);
      push(k);
    }
  }

  const to = new Int32Array(N).fill(-1);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    let best = 0, bk = -1;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
      const kk = b * nx + a;
      const drop = (filled[k] - filled[kk]) / (di && dj ? Math.SQRT2 : 1);
      if (drop > best) { best = drop; bk = kk; }
    }
    to[k] = bk;
  }
  const acc = new Float64Array(N).fill(1);
  for (let o = done - 1; o >= 0; o--) {
    const k = order[o];
    if (to[k] >= 0) acc[to[k]] += acc[k];
  }
  const ha = (cell * cell) / 1e4;
  for (let k = 0; k < N; k++) acc[k] *= ha;
  return acc;
}

/** Налуу, урсацын тор: урсацын босго (га), налуугийн муруй нь ~100 м нүдэд тааруулагдсан тул том нүдэд
 *  нарийн торонд тооцно. Хязгаарт багтах хамгийн нарийн нүд, шинжилгээний нүднээс томрохгүй. */
export function chooseFineCell(cell: number, widthM: number, heightM: number) {
  if (cell <= 100) return cell;
  const pad = paddingFor(cell);
  for (const c of NICE_CELLS) {
    if (c < 100) continue;
    if (c >= cell) return cell;
    if (((widthM + 2 * pad) / c) * ((heightM + 2 * pad) / c) <= MAX_GRID) return c;
  }
  return cell;
}

/** Шинжилгээний нүдэнд багтах нарийн торны утгын медиан (NaN-ийг үл тооно). Гуу жалга нүдээр гарч
 *  байгаа ч ихэнх хэсэг нь хуурай бол нүдийг бүхэлд нь сувагт тооцохгүй. */
export function medianInCell(
  values: ArrayLike<number>, nx: number, ny: number, x0: number, y0: number, fine: number, x: number, y: number, cell: number,
) {
  const h = cell / 2;
  const i0 = Math.max(0, Math.ceil((x - h - x0) / fine - 0.5)), i1 = Math.min(nx - 1, Math.floor((x + h - x0) / fine - 0.5));
  const j0 = Math.max(0, Math.ceil((y - h - y0) / fine - 0.5)), j1 = Math.min(ny - 1, Math.floor((y + h - y0) / fine - 0.5));
  const v: number[] = [];
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const a = values[j * nx + i];
    if (Number.isFinite(a)) v.push(a);
  }
  if (!v.length) return NaN;
  v.sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function segDist(px: number, py: number, s: Seg) {
  const [x1, y1, x2, y2] = s;
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Хэрчмийн орон зайн индекс — хамгийн ойрын зайг хурдан олох */
export class SegIndex {
  private b = new Map<string, Seg[]>();
  private size: number;
  private count: number;
  constructor(segs: Seg[], size = 1000) {
    this.size = size; this.count = segs.length;
    for (const s of segs) {
      const x0 = Math.floor(Math.min(s[0], s[2]) / size), x1 = Math.floor(Math.max(s[0], s[2]) / size);
      const y0 = Math.floor(Math.min(s[1], s[3]) / size), y1 = Math.floor(Math.max(s[1], s[3]) / size);
      for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) {
        const k = `${i},${j}`;
        (this.b.get(k) ?? this.b.set(k, []).get(k)!).push(s);
      }
    }
  }
  nearest(x: number, y: number, maxR = 30000) {
    if (!this.count) return Infinity;
    const ci = Math.floor(x / this.size), cj = Math.floor(y / this.size);
    let best = Infinity;
    const maxRing = Math.ceil(maxR / this.size);
    for (let r = 0; r <= maxRing; r++) {
      if (best < (r - 1) * this.size) break;
      for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
        const arr = this.b.get(`${i},${j}`);
        if (arr) for (const s of arr) best = Math.min(best, segDist(x, y, s));
      }
    }
    return best;
  }
}

export type Poly = { rings: XY[][]; xmin: number; ymin: number; xmax: number; ymax: number };

export function toPoly(rings: XY[][]): Poly {
  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
  for (const r of rings) for (const [x, y] of r) {
    if (x < xmin) xmin = x; if (x > xmax) xmax = x;
    if (y < ymin) ymin = y; if (y > ymax) ymax = y;
  }
  return { rings, xmin, ymin, xmax, ymax };
}

/** Олон цагирагтай полигон (нүх орсон) — even-odd дүрэм */
export function inPoly(x: number, y: number, p: Poly) {
  if (x < p.xmin || x > p.xmax || y < p.ymin || y > p.ymax) return false;
  let c = false;
  for (const ring of p.rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
  }
  return c;
}

export function ringArea(ring: XY[]) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

const NICE_CELLS = [30, 50, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000];
export const MAX_CELLS = 25000, MAX_GRID = 1_200_000;
export const paddingFor = (cell: number) => Math.max(5000, cell * 20);

/** Нүдний тоо, тооцооны торны хэмжээ хязгаарт багтах хамгийн нарийн нүд. requested нь доод хязгаар. */
export function chooseCell(areaM2: number, widthM: number, heightM: number, requested?: number) {
  for (const cell of NICE_CELLS) {
    if (requested && cell < requested) continue;
    const pad = paddingFor(cell);
    const grid = ((widthM + 2 * pad) / cell) * ((heightM + 2 * pad) / cell);
    if (areaM2 / (cell * cell) <= MAX_CELLS && grid <= MAX_GRID) return cell;
  }
  return NICE_CELLS[NICE_CELLS.length - 1];
}
