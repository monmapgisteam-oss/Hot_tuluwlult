// Алхам 9: ИБАХ — инженерийн бэлтгэл арга хэмжээ (босоо төлөвлөлт, шороон ажил, гадаргын ус зайлуулалт, үерийн эрсдэл).
import { d8, slopeAt, zAt, type Dem } from "./dem";
import { bbox, bufMany, bufPoly, clipPath, inside, inter, unionAll, type Path, type Rings } from "./geom";
import type { Lot, StreetCls } from "./layout";
import { nearestNode, network, type Graph, type NetOut } from "./network";

export const SLOPE_CLS = [
  { max: 3, label: "0–3% хавтгай", color: "#E8F1D4" },
  { max: 8, label: "3–8% бага налуу", color: "#B9D98A" },
  { max: 15, label: "8–15% дунд налуу", color: "#E9B949" },
  { max: 999, label: ">15% эгц", color: "#C8553D" },
];

// Lot-ын урсацын коэффициент — rational method жишиг (ТААМАГЛАЛ)
const C_LOT: Record<Lot["use"], number> = { res: 0.55, com: 0.8, school: 0.45, kinder: 0.45, clinic: 0.6, park: 0.15, protect: 0.1, eng: 0.8 };
const BUILD: Lot["use"][] = ["res", "com", "school", "kinder", "clinic", "eng"];

export type IbahIn = { rain: number | ""; minSlope: number; drainHa: number; maxGrade: Record<StreetCls, number> };
export type IbahOut = {
  slope: { rings: Rings; cls: number; area: number }[];
  earth: Map<number, { cut: number; fill: number; pad: number; slope: number }>; cut: number; fill: number;
  drains: Path[]; flood: Rings; floodLots: number[];
  grade: { over: number; max: Record<StreetCls, number> };
  storm: NetOut; outletZ: number;
};

export function analyze(dem: Dem, site: Rings, lots: Lot[], g: Graph, p: IbahIn): IbahOut {
  // 1. Налуугийн ангилал (DEM нүд → ангилал бүрээр нэгтгэнэ)
  const cellsBy: Rings[][] = SLOPE_CLS.map(() => []);
  const h = dem.cell / 2, b = bbox(site);
  for (let j = 0; j < dem.ny; j++) for (let i = 0; i < dem.nx; i++) {
    const x = dem.x0 + i * dem.cell, y = dem.y0 + j * dem.cell;
    if (x < b.x0 - h || x > b.x1 + h || y < b.y0 - h || y > b.y1 + h || !inside(x, y, site)) continue;
    const s = slopeAt(dem, x, y), c = SLOPE_CLS.findIndex((q) => s <= q.max);
    cellsBy[c].push([[[x - h, y - h], [x - h, y + h], [x + h, y + h], [x + h, y - h], [x - h, y - h]]]);
  }
  const slope = cellsBy.map((cs, cls) => {
    const r = inter(unionAll(cs), site);
    return { rings: r, cls, area: cs.length * dem.cell * dem.cell };
  });

  // 2. Шороон ажил: барилгажих lot бүрийг тэнцвэржүүлсэн тэвшинд (pad = дундаж өндөр) — 10 м тор
  const earth = new Map<number, { cut: number; fill: number; pad: number; slope: number }>();
  let cut = 0, fill = 0;
  for (const l of lots) {
    if (!BUILD.includes(l.use)) continue;
    const bb = bbox(l.rings), zs: number[] = [];
    for (let x = bb.x0 + 5; x < bb.x1; x += 10) for (let y = bb.y0 + 5; y < bb.y1; y += 10) if (inside(x, y, l.rings)) zs.push(zAt(dem, x, y));
    if (!zs.length) continue;
    const pad = zs.reduce((s, z) => s + z, 0) / zs.length;
    let c = 0, f = 0;
    for (const z of zs) { if (z > pad) c += (z - pad) * 100; else f += (pad - z) * 100; }
    earth.set(l.id, { cut: c, fill: f, pad, slope: slopeAt(dem, ...l.c) });
    cut += c; fill += f;
  }

  // 3. Гадаргын урсац (D8) — хуримтлал ≥ drainHa бол суваг/жалга
  const mask = new Uint8Array(dem.nx * dem.ny), sb = bufPoly(site, 300), bb = bbox(sb);
  for (let k = 0; k < mask.length; k++) {
    const x = dem.x0 + (k % dem.nx) * dem.cell, y = dem.y0 + Math.floor(k / dem.nx) * dem.cell;
    if (x >= bb.x0 && x <= bb.x1 && y >= bb.y0 && y <= bb.y1) mask[k] = 1;
  }
  const { to, acc } = d8(dem, mask);
  const thr = (p.drainHa * 1e4) / (dem.cell * dem.cell);
  const segs: Path[] = [];
  for (let k = 0; k < acc.length; k++) {
    if (acc[k] < thr || to[k] < 0) continue;
    segs.push([[dem.x0 + (k % dem.nx) * dem.cell, dem.y0 + Math.floor(k / dem.nx) * dem.cell],
      [dem.x0 + (to[k] % dem.nx) * dem.cell, dem.y0 + Math.floor(to[k] / dem.nx) * dem.cell]]);
  }
  const drains = clipPath(segs, site);
  const flood = inter(bufMany(drains.map((q) => ({ paths: [q], d: 20 }))), site);
  const floodLots = flood.length ? lots.filter((l) => BUILD.includes(l.use) && inter(l.rings, flood).length).map((l) => l.id) : [];

  // 4. Гудамжны уртын налуу
  const max: Record<StreetCls, number> = { arterial: 0, collector: 0, local: 0 };
  let over = 0;
  for (const e of g.edges) {
    const gr = (Math.abs(g.nodes[e.a].z - g.nodes[e.b].z) / e.len) * 100;
    max[e.cls] = Math.max(max[e.cls], gr);
    if (gr > p.maxGrade[e.cls]) over++;
  }

  // 5. Борооны ус зайлуулах сүлжээ: хамгийн нам зангилаа руу өөрийн урсгалаар; ачаалал = C × A (га)
  let outlet = 0;
  g.nodes.forEach((n, k) => { if (n.z < g.nodes[outlet].z) outlet = k; });
  const load = new Float64Array(g.nodes.length);
  for (const l of lots) load[nearestNode(g, l.c)] += (C_LOT[l.use] * l.area) / 1e4;
  const rain = p.rain === "" ? null : Number(p.rain);
  const storm = network(g, "storm", outlet, load, {
    gravity: true, minSlope: p.minSlope,
    ...(rain ? { toQ: (cA: number) => (cA * rain * 2.78) / 1000, v: 1.0, minDn: 300 } : {}),
  });
  return { slope, earth, cut, fill, drains, flood, floodLots, grade: { over, max }, storm, outletZ: g.nodes[outlet]?.z ?? 0 };
}
