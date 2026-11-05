// Полигон/шугамын туслахууд — полигоны UTM бүс (метр). ArcGIS geometry operators дээр.
import Polygon from "@arcgis/core/geometry/Polygon";
import Polyline from "@arcgis/core/geometry/Polyline";
import Point from "@arcgis/core/geometry/Point";
import * as areaOp from "@arcgis/core/geometry/operators/areaOperator";
import * as bufferOp from "@arcgis/core/geometry/operators/bufferOperator";
import * as cutOp from "@arcgis/core/geometry/operators/cutOperator";
import * as diffOp from "@arcgis/core/geometry/operators/differenceOperator";
import * as interOp from "@arcgis/core/geometry/operators/intersectionOperator";
import * as unionOp from "@arcgis/core/geometry/operators/unionOperator";
import * as partsOp from "@arcgis/core/geometry/operators/multiPartToSinglePartOperator";
import * as proxOp from "@arcgis/core/geometry/operators/proximityOperator";
import * as labelOp from "@arcgis/core/geometry/operators/labelPointOperator";
import * as genOp from "@arcgis/core/geometry/operators/generalizeOperator";
import * as simpOp from "@arcgis/core/geometry/operators/simplifyOperator";
import type { XY } from "./geo";

export type { XY };
export type Rings = XY[][];
export type Path = XY[];
const SR = { wkid: 32648 };
/** Төлөвлөлт эхлэхийн өмнө полигоны UTM бүсийг тохируулна (Монгол: 32645–32650) */
export const setPlanWkid = (wkid: number) => { SR.wkid = wkid; };
export const planWkid = () => SR.wkid;

export const P = (rings: Rings) => new Polygon({ rings, spatialReference: SR });
export const L = (paths: Path[]) => new Polyline({ paths, spatialReference: SR });
const rOf = (g: unknown): Rings => ((g as Polygon | null)?.rings as Rings | undefined) ?? [];
const pOf = (g: unknown): Path[] => ((g as Polyline | null)?.paths as Path[] | undefined) ?? [];

export const clipPaths=(paths:Path[],rings:Rings):Path[] => paths.length&&rings.length?pOf(interOp.execute(L(paths),P(rings))):[];

export const area = (r: Rings) => (r.length ? Math.abs(areaOp.execute(P(r))) : 0);
export const bufPoly = (r: Rings, d: number): Rings => (r.length ? rOf(bufferOp.execute(P(r), d)) : []);
export const bufPath = (paths: Path[], d: number): Rings => (paths.length ? rOf(bufferOp.execute(L(paths), d)) : []);
/** Олон шугамыг өөр өөр өргөнөөр буфердээд нэгтгэнэ */
export function bufMany(items: { paths: Path[]; d: number }[]): Rings {
  const ok = items.filter((i) => i.paths.length && i.d > 0.01);
  if (!ok.length) return [];
  const out = bufferOp.executeMany(ok.map((i) => L(i.paths)), ok.map((i) => i.d), { union: true });
  return out.flatMap((g) => rOf(g));
}
export const diff = (a: Rings, b: Rings): Rings => (!a.length ? [] : !b.length ? a : rOf(diffOp.execute(P(a), P(b))));
export const inter = (a: Rings, b: Rings): Rings => (!a.length || !b.length ? [] : rOf(interOp.execute(P(a), P(b))));
export function unionAll(list: Rings[]): Rings {
  const ok = list.filter((r) => r.length);
  if (!ok.length) return [];
  return rOf(unionOp.executeMany(ok.map(P)));
}
/** Олон хэсэгтэй полигоныг тусдаа хэсгүүдэд */
export const parts = (r: Rings): Rings[] => (r.length ? partsOp.executeMany([P(r)]).map(rOf).filter((x) => x.length) : []);
/** Шугамыг полигоноор хайчлах */
export const clipPath = (paths: Path[], r: Rings): Path[] => (paths.length && r.length ? pOf(interOp.execute(L(paths), P(r))) : []);
/** Полигоныг шугамаар хуваах (cutOperator) */
export function cut(r: Rings, path: Path): Rings[] {
  const res = cutOp.execute(P(r), L([path]));
  return res.map(rOf).filter((x) => x.length);
}
export function nearest(r: Rings | Path[], [x, y]: XY, isPoly = true): XY {
  const g = isPoly ? P(r as Rings) : L(r as Path[]);
  const res = proxOp.getNearestCoordinate(g, new Point({ x, y, spatialReference: SR }));
  return [res.coordinate.x, res.coordinate.y];
}
export const labelPt = (r: Rings): XY => { const p = labelOp.execute(P(r)); return [p.x, p.y]; };
export const generalizePath = (path: Path, dev: number): Path => pOf(genOp.execute(L([path]), dev))[0] ?? path;
export const simplify = (r: Rings): Rings => rOf(simpOp.execute(P(r)));

// ---------- Вектор ----------
export const dist = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const sub = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]];
export const add = (a: XY, b: XY): XY => [a[0] + b[0], a[1] + b[1]];
export const mul = (a: XY, k: number): XY => [a[0] * k, a[1] * k];
export const norm = (a: XY): XY => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; };
export const perp = (a: XY): XY => [-a[1], a[0]];
export const dot = (a: XY, b: XY) => a[0] * b[0] + a[1] * b[1];

export function pathLength(p: Path) {
  let s = 0;
  for (let i = 1; i < p.length; i++) s += dist(p[i - 1], p[i]);
  return s;
}
/** Шугамыг тэнцүү алхмаар нягтруулна */
export function densify(p: Path, step: number): Path {
  const out: Path = [p[0]];
  for (let i = 1; i < p.length; i++) {
    const n = Math.max(1, Math.ceil(dist(p[i - 1], p[i]) / step));
    for (let k = 1; k <= n; k++) out.push([p[i - 1][0] + ((p[i][0] - p[i - 1][0]) * k) / n, p[i - 1][1] + ((p[i][1] - p[i - 1][1]) * k) / n]);
  }
  return out;
}
/** Chaikin зөөлрүүлэлт — төгсгөлийн цэгийг хадгална */
export function smooth(p: Path, iter = 2): Path {
  let q = p;
  for (let k = 0; k < iter; k++) {
    if (q.length < 3) return q;
    const o: Path = [q[0]];
    for (let i = 0; i + 1 < q.length; i++) {
      const a = q[i], b = q[i + 1];
      o.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    o.push(q[q.length - 1]);
    q = o;
  }
  return q;
}
/** Шугамын дагуух s зайд байх цэг ба чиглэл */
export function along(p: Path, s: number): { pt: XY; dir: XY } {
  for (let i = 1; i < p.length; i++) {
    const L0 = dist(p[i - 1], p[i]);
    if (s <= L0 || i === p.length - 1) {
      const t = L0 ? Math.min(1, s / L0) : 0;
      return { pt: [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * t, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t], dir: norm(sub(p[i], p[i - 1])) };
    }
    s -= L0;
  }
  return { pt: p[p.length - 1], dir: [1, 0] };
}

// ---------- Эргэлттэй тэгш өнцөгт (OBB) — recursive subdivision-ийн тэнхлэг ----------
function hull(pts: XY[]): XY[] {
  const s = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o: XY, a: XY, b: XY) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: XY[] = [], up: XY[] = [];
  for (const p of s) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = s.length - 1; i >= 0; i--) { const p = s[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
export type OBB = { c: XY; u: XY; v: XY; len: number; wid: number };
export function obb(r: Rings): OBB {
  const h = hull(r[0] ?? []);
  let best: OBB = { c: [0, 0], u: [1, 0], v: [0, 1], len: 0, wid: 0 };
  let bestA = Infinity;
  for (let i = 0; i < h.length; i++) {
    const u = norm(sub(h[(i + 1) % h.length], h[i])), v = perp(u);
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const p of h) { const a = dot(p, u), b = dot(p, v); a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
    const A = (a1 - a0) * (b1 - b0);
    if (A < bestA) {
      bestA = A;
      const c = add(mul(u, (a0 + a1) / 2), mul(v, (b0 + b1) / 2));
      best = a1 - a0 >= b1 - b0 ? { c, u, v, len: a1 - a0, wid: b1 - b0 } : { c, u: v, v: mul(u, -1), len: b1 - b0, wid: a1 - a0 };
    }
  }
  return best;
}
/** c цэгээр d чиглэлд урт шулуун */
export const lineThrough = (c: XY, d: XY, half = 20000): Path => [sub(c, mul(d, half)), add(c, mul(d, half))];
/** Тэгш өнцөгтийг төв, тэнхлэг, хэмжээгээр */
export function orientedRect(c: XY, u: XY, len: number, wid: number): XY[] {
  const v = perp(u), a = mul(u, len / 2), b = mul(v, wid / 2);
  const q: XY[] = [add(add(c, a), b), add(sub(c, a), b), sub(sub(c, a), b), sub(add(c, a), b)];
  return [q[0], q[3], q[2], q[1], q[0]]; // цагийн зүүний дагуу
}
export const circle = (c: XY, r: number, n = 24): XY[] => {
  const o: XY[] = [];
  for (let i = n; i >= 0; i--) { const t = (i / n) * Math.PI * 2; o.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]); }
  return o;
};

/** Олон цагирагтай полигон дотор эсэх — even-odd */
export function inside(x: number, y: number, rings: Rings) {
  let c = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
  }
  return c;
}
export function bbox(r: Rings) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const ring of r) for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1 };
}

// Тогтвортой санамсаргүй тоо — дахин ажиллуулахад ижил үр дүн
export function rng(seed: number) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
