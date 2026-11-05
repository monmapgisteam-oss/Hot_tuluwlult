// Алхам 5–7: CGA маягийн дүрмүүд — тогтмол бус блок дээр (Selbe CE_PROJECT/rules):
//   lot_chat.cga (offset → BuildingRing → Courtyard), building_apartment.cga (давхраар), building_commercial.cga,
//   Pocket_Park.cga, zoning.cga (TreeDistribution), reparking.cga, road/Sidewalk/Bike_road/Lane_with_Crosswalk.
import {
  add, area, bbox, bufMany, bufPath, bufPoly, circle, clipPath, diff, dot, inside, inter, labelPt, lineThrough, mul, norm,
  obb, orientedRect, parts, pathLength, perp, rng, sub, unionAll, along, type Path, type Rings, type XY,
} from "./geom";
import type { Lot, LotUse, Street, StreetCls } from "./layout";
import type { Graph } from "./network";
import { GROUND, TREE, type GroundKind, type MassKind } from "./zoning";
import {coordinateRoadside} from './urbanRoadside';
import {refreshCourtyardAccess,type CourtyardAccess} from './urbanCourtyardAccess';

export type Attrs = {
  acceptFootprint?: (rings:Rings)=>boolean;
  setback: number; depth: number; maxLen: number; gapEnd: number; floorsRes: number; floorH: number; sunK: number;
  bcrRes: number; openSouth: boolean; comGround: boolean;
  floorsCom: number; bcrCom: number; comPodium: number; floorsSchool: number; floorsKinder: number; floorsClinic: number;
  walkW: number; bikeW: number; laneW: number; treeSp: number; parkBays: number; pvShare: number; greenRoof: number;
  stopSp: number;
  // Гудамжны шатлал: магистраль/цуглуулах замын нэг чиглэлийн эгнээ, магистралийн туслах (service) замын хучилтын өргөн (0 = байхгүй).
  // Хуучин хадгалалтад байхгүй бол өмнөх огтлол (2 / 1 / 0) — хадгалсан 2D давхаргатай таарна.
  artLanes?: number; colLanes?: number; serviceW?: number;
  floorGrad: number; hubs?: XY[]; hubR?: number; // төвөөс холдох тусам давхар буурах (0 = жигд)
  bcrMaxRes?: number; farMaxRes?: number; // блок бүрийн нормын дээд хязгаар (%, коэф.) — хэтрүүлэхгүй
  bcrMinRes?: number; // BCR-ийн доод хязгаар (%) — боломжтой бол түүнээс багагүй хувилбарыг сонгоно
  farMaxCom?: number; // худалдаа, үйлчилгээний блокийн FAR-ын дээд хязгаар — хэт төвлөрөл үүсгэхгүй
};

export type GroundF = { rings: Rings; k: GroundKind; lot: number };
export type MarkF = { rings: Rings; k: "cross" | "stall" };
export type LaneF = { path: Path; k: "center" | "lane" | "edge" };
export type MassF = { rings: Rings; z0: number; h: number; k: MassKind; bid: number; fl: number };
export type TreeF = { x: number; y: number; t: number; h: number; r: number };
/** Accepted parking bay, in metres; heading is clockwise from north along the vehicle's length. */
export type ParkingSpace = { x: number; y: number; heading: number; length: number; width: number };
export type BldgF = {
  id: number; lot: number; use: LotUse; kind: MassKind; floors: number; fh: number; h: number; podium: number;
  foot: number; gfa: number; gfaRes: number; gfaCom: number; roof: MassKind; rings: Rings; c: XY;
};
export type Report = Record<string, number>;
export type Scene = {
  streets: GroundF[]; base: GroundF[]; over: GroundF[]; marks: MarkF[]; lanes: LaneF[]; masses: MassF[]; trees: TreeF[];
  bldgs: BldgF[]; stops: XY[]; lights: XY[]; parkingSpaces?: ParkingSpace[]; accesses?:CourtyardAccess[]; rep: Report; lotBcr: Map<number, number>;
};

/** Сарниж тарих модны алхмын үржүүлэгч (2.5 → нягт ~6 дахин бага) — ТААМАГЛАЛ: хээрийн уур амьсгалд усалгаатай
 *  мод арчлах боломж хязгаарлагдмал; хэрэглэгчийн санал (2026-10-28): «замбараагүй их мод — зам дагуу л» */
const SCATTER_THIN = 2.5;

class Gen {
  s: Scene = { streets: [], base: [], over: [], marks: [], lanes: [], masses: [], trees: [], bldgs: [], stops: [], lights: [], parkingSpaces: [], rep: {}, lotBcr: new Map() };
  rnd = rng(1);
  lot = 0;
  a: Attrs;
  constructor(a: Attrs) { this.a = a; }
  report(k: string, v: number) { this.s.rep[k] = (this.s.rep[k] ?? 0) + v; }
  /** Суурь гадаргуу */
  base(k: GroundKind, r: Rings) { if (!r.length) return; this.s.base.push({ rings: r, k, lot: this.lot }); this.report(`g.${k}`, area(r)); }
  /** Дээр давхарласан гадаргуу — доорхоос талбайг хасна */
  over(k: GroundKind, r: Rings, under: GroundKind) {
    if (!r.length) return 0;
    const a = area(r);
    this.s.over.push({ rings: r, k, lot: this.lot }); this.report(`g.${k}`, a); this.report(`g.${under}`, -a);
    return a;
  }
  tree(x: number, y: number, t: number, s = 1) {
    const k = s * (0.8 + 0.4 * this.rnd());
    this.s.trees.push({ x, y, t, h: TREE[t].h * k, r: TREE[t].r * k });
    this.report("trees", 1);
  }
  pick(mix: number[]) { let x = this.rnd() * mix.reduce((s, v) => s + v, 0); for (let i = 0; i < mix.length; i++) { x -= mix[i]; if (x <= 0) return i; } return 0; }
  /** scatter(surface) — jitter тор, avoid-оос зайлсхийнэ. Алхмыг SCATTER_THIN дахин сийрүүлнэ:
   *  хашаа, паркт цөөн мод; гол модлог нь гудамжны ногоон зурвас, салхины хамгаалалтын зурвас */
  scatter(r: Rings, sp: number, mix = [0.35, 0.45, 0.2], avoid: Rings = []) {
    sp *= SCATTER_THIN;
    const b = bbox(r);
    for (let x = b.x0 + sp / 2; x < b.x1; x += sp) for (let y = b.y0 + sp / 2; y < b.y1; y += sp) {
      const px = x + (this.rnd() - 0.5) * sp * 0.7, py = y + (this.rnd() - 0.5) * sp * 0.7;
      if (inside(px, py, r) && !(avoid.length && inside(px, py, avoid))) this.tree(px, py, this.pick(mix));
    }
  }
  /** Гэрэлтүүлгийн шон — шугамын дагуу sp тутамд (ТААМАГЛАЛ: гудамж 30 м, хашаа, парк 20 м) */
  lights(path: Path, sp: number, within: Rings, shift = 0) {
    const L = pathLength(path);
    for (let s = sp / 2 + shift; s < L; s += sp) {
      const { pt } = along(path, s);
      if (inside(pt[0], pt[1], within)) { this.s.lights.push(pt); this.report("lights", 1); }
    }
  }
  /** Шугамын дагуу модны эгнээ */
  row(path: Path, sp: number, t: number, within: Rings, avoid: Rings = []) {
    const L = pathLength(path);
    for (let s = sp / 2; s < L; s += sp) {
      const { pt } = along(path, s);
      if (inside(pt[0], pt[1], within) && !(avoid.length && inside(pt[0], pt[1], avoid))) this.tree(pt[0], pt[1], t);
    }
  }
  /** extrude(Floors × FloorHeight) → split(y){ FloorHeight : Floor }* + парапет */
  building(rings: Rings, o: { use: LotUse; kind: MassKind; floors: number; fh: number; podium?: number; roof?: MassKind; under?: GroundKind }) {
    const foot = area(rings);
    if (foot < 40 || this.a.acceptFootprint && !this.a.acceptFootprint(rings)) return null;
    // Иргэний барилгын суурь: гурвалжин, нарийн зурвас үлдэгдэл барилга болохгүй — 3 м дотогш шахахад ≥ 25 % үлдэх ёстой
    // (14 м гүнтэй секц ≈ 57 %, L булан ≈ 50 %, 50 × 10 м гурвалжин ≈ 11 %). Инженерийн байгууламж (яндан г.м.) хамаарахгүй.
    if (o.use !== "eng" && area(bufPoly(rings, -3)) < 0.25 * foot) { this.report("bldg.rejected", 1); return null; }
    const id = this.s.bldgs.length + 1, podium = Math.min(o.podium ?? 0, o.floors);
    for (let i = 0; i < o.floors; i++) this.s.masses.push({ rings, z0: i * o.fh, h: o.fh, k: i < podium ? "com" : o.kind, bid: id, fl: i + 1 });
    const x = this.rnd();
    const roof: MassKind = o.roof ?? (x < this.a.pvShare ? "pv" : x < this.a.pvShare + this.a.greenRoof ? "groof" : "roof");
    this.s.masses.push({ rings, z0: o.floors * o.fh, h: 0.4, k: roof, bid: id, fl: 0 });
    const gfa = foot * o.floors, gfaCom = foot * podium;
    const b: BldgF = {
      id, lot: this.lot, use: o.use, kind: o.kind, floors: o.floors, fh: o.fh, h: o.floors * o.fh + 0.4, podium,
      foot, gfa, gfaRes: o.kind === "res" ? gfa - gfaCom : 0, gfaCom, roof, rings, c: labelPt(rings),
    };
    this.s.bldgs.push(b);
    this.report("foot", foot); this.report(`roof.${roof}`, foot);
    if (o.under) this.report(`g.${o.under}`, -foot);
    return b;
  }
  /** Ил зогсоол (CityEngine Parking.cga + хэрэглэгчийн жишиг зураг, 2026-10-28): хэсэг бүрийн OBB-ийн урт тэнхлэгийн дагуу.
   *  ≥15.5 м — хоёр эгнээ перпендикуляр (2.5 × 5) + төвд 6 м зорчих зам; 10.5–15.5 — нэг эгнээ + 6 м зам;
   *  5–10.5 — зэрэгцээ (6.5 × 2.5). Хоёр төгсгөлд 6 м орц/эргэлтийн зай.
   *  Хэмжээ — ТААМАГЛАЛ (олон улсын жишиг), БНбД-ийн зогсоолын заалтаар ШАЛГАХ. */
  parking(r: Rings, under: GroundKind) {
    if (!r.length) return 0;
    this.over("parking", r, under);
    const SW = 2.5, SD = 5, AISLE = 6, END = 6;
    let n = 0;
    for (const q of parts(r)) {
      const o = obb(q);
      if (o.wid < 5 || o.len < 2 * END + SW * 2) continue;
      const fits = (c: XY, du: number, dv: number) =>
        [[1, 1], [1, -1], [-1, 1], [-1, -1]].every(([a, b]) => { const p = add(c, add(mul(o.u, a * du / 2), mul(o.v, b * dv / 2))); return inside(p[0], p[1], q); });
      // Эгнээ: [төвийн v-шилжилт, гүн (v), нэг зайн урт (u)]
      const rows: [number, number, number][] = o.wid >= 15.5 ? [[AISLE / 2 + SD / 2, SD, SW], [-(AISLE / 2 + SD / 2), SD, SW]]
        : o.wid >= 10.5 ? [[o.wid / 2 - SD / 2, SD, SW]] : [[0, SW, 6.5]];
      for (const [off, depth, step] of rows) for (let t = -o.len / 2 + END; t + step <= o.len / 2 - END; t += step) {
        const c = add(o.c, add(mul(o.u, t + step / 2), mul(o.v, off)));
        if (!fits(c, step, depth)) continue;
        const perpendicular = o.wid >= 10.5, facing = perpendicular ? mul(o.v, off < 0 ? -1 : 1) : o.u;
        this.s.parkingSpaces!.push({ x: c[0], y: c[1], heading: (Math.atan2(facing[0], facing[1]) * 180 / Math.PI + 360) % 360,
          length: perpendicular ? depth : step, width: perpendicular ? step : depth });
        // зай хоорондын зааглах зураас — эгнээг хөндлөн (v), гүнийн урттай
        this.s.marks.push({ rings: [orientedRect(add(c, mul(o.u, -step / 2)), o.v, depth, 0.12)], k: "stall" });
        n++;
      }
    }
    this.report("stalls", n);
    return n;
  }
}

// ---------- Барилгын цагираг (lot_chat.cga BuildingRing) ----------
/** Preserve ordinary rectangles and L buildings, including redundant collinear buffer vertices. */
function ordinarySection(rings: Rings) {
  if (rings.length !== 1) return false;
  const ring = rings[0], dirs: XY[] = [];
  for (let i = 1; i < ring.length; i++) {
    const d = sub(ring[i], ring[i - 1]);
    if (Math.hypot(...d) > 0.001) dirs.push(norm(d));
  }
  if (dirs.length < 4) return false;
  const axis = dirs[0];
  if (dirs.some((d) => Math.min(Math.abs(dot(axis, d)), Math.abs(dot(perp(axis), d))) > 0.0001)) return false;
  const corners = dirs.filter((d, i) => Math.abs(dot(d, dirs[(i + dirs.length - 1) % dirs.length])) < 0.5).length;
  return corners === 4 || corners === 6;
}

function containedBar(r: Rings, boundary: Rings) {
  const corners = r[0].slice(0, 4), c = mul(corners.reduce((sum, p) => add(sum, p), [0, 0] as XY), 0.25);
  // Nudge the probes inside the rectangle so a facade exactly on the courtyard boundary is valid.
  if (corners.some((p) => { const q = add(p, mul(sub(c, p), 0.00001)); return !inside(...q, boundary); })) return false;
  return area(diff(r, boundary)) < 0.002; // Exact containment also detects holes and concave cut-outs.
}
function barDepths(depth: number, available = depth) {
  const maximum = Math.min(depth, available);
  if (maximum < 10 - 0.001) return [];
  const depths = [maximum];
  for (let d = maximum - 2; d > 10; d -= 2) depths.push(d);
  if (maximum > 10.001) depths.push(10);
  return depths;
}

/** Fit an ordinary bar without clipping its corners. Used only when the requested rectangle fails.
 *  A shallow available plot limits the fallback's aspect ratio, rather than producing a long sliver. */
function fitContainedBar(boundary: Rings, preferred: XY, u: XY, length: number, depth: number): Rings {
  if (!boundary.length) return [];
  const original: Rings = [orientedRect(preferred, u, length, depth)];
  if (containedBar(original, boundary)) return original;
  const v = perp(u), origin = obb(boundary).c, points = boundary.flat().map((p) => sub(p, origin));
  const xs = points.map((p) => dot(p, u)), ys = points.map((p) => dot(p, v));
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const target = sub(preferred, origin), minLength = 18;
  let best: Rings = [], bestArea = 0, bestDistance = Infinity;
  for (const d of barDepths(depth, y1 - y0)) {
    const cap = Math.min(length, x1 - x0, d < depth - 0.01 ? d * 4 : Infinity);
    if (cap < minLength) continue;
    const xa = x0 + minLength / 2, xb = x1 - minLength / 2, ya = y0 + d / 2, yb = y1 - d / 2;
    const sample = (a: number, b: number, preferredValue: number) => [...new Set([Math.max(a, Math.min(b, preferredValue)), (a + b) / 2, ...Array.from({ length: 9 }, (_, i) => a + (b - a) * i / 8)])];
    for (const x of sample(xa, xb, dot(target, u))) for (const y of sample(ya, yb, dot(target, v))) {
      const c = add(origin, add(mul(u, x), mul(v, y))), upper = Math.min(cap, 2 * (x - x0), 2 * (x1 - x));
      if (upper < minLength - 0.001 || upper * d < bestArea - 0.01) continue;
      const shape = (l: number): Rings => [orientedRect(c, u, l, d)];
      if (!containedBar(shape(minLength), boundary)) continue;
      let lo = minLength, hi = upper;
      if (containedBar(shape(hi), boundary)) lo = hi;
      else for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (containedBar(shape(mid), boundary)) lo = mid; else hi = mid; }
      const size = lo * d, distance = Math.hypot(...sub(c, preferred));
      if (size > bestArea + 0.01 || Math.abs(size - bestArea) <= 0.01 && distance < bestDistance) {
        best = shape(lo); bestArea = size; bestDistance = distance;
      }
    }
  }
  return best;
}

/** A tapered ring fragment becomes one contained rectangular building. Its inner facade remains
 *  exactly on the courtyard edge, so the facade walk and parking still attach to the real building. */
function regularRingSection(section: Rings, courtyard: Rings, depth: number, maxLen: number): Rings {
  if (ordinarySection(section)) return section;
  const fronts: { a: XY; u: XY; inward: XY; length: number }[] = [];
  for (const ring of section) for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1], z = ring[i], delta = sub(z, a), length = Math.hypot(...delta);
    if (length < 18) continue;
    const u = norm(delta);
    for (const n of [perp(u), mul(perp(u), -1)]) {
      if (courtyard.length) {
        const offset = mul(n, 0.3);
        for (const path of clipPath([[add(a, offset), add(z, offset)]], courtyard)) {
          const first = sub(path[0], offset), last = sub(path[path.length - 1], offset), L = Math.hypot(...sub(last, first));
          if (L >= 18) fronts.push({ a: first, u, inward: mul(n, -1), length: L });
        }
      } else {
        const probe = add(mul(add(a, z), 0.5), mul(n, 0.3));
        if (inside(...probe, section)) fronts.push({ a, u, inward: n, length });
      }
    }
  }
  let best: Rings = [], bestArea = 0;
  for (const f of fronts) for (const d of barDepths(depth)) {
    for (let step = 0; step <= 12; step++) {
      const t = 9 + (f.length - 18) * step / 12, upper = Math.min(maxLen, 2 * t, 2 * (f.length - t));
      if (upper < 18 || upper * d < bestArea - 0.01) continue;
      const c = add(f.a, add(mul(f.u, t), mul(f.inward, d / 2)));
      const shape = (l: number): Rings => [orientedRect(c, f.u, l, d)];
      if (!containedBar(shape(18), section)) continue;
      let lo = 18, hi = upper;
      if (containedBar(shape(hi), section)) lo = hi;
      else for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (containedBar(shape(mid), section)) lo = mid; else hi = mid; }
      if (lo * d > bestArea + 0.01) { best = shape(lo); bestArea = lo * d; }
    }
  }
  return best;
}

/** offset(-setback) хүрээнээс гүнээр цагираг гаргаж, блокийн (OBB) тал бүрт maxLen тутамд, дор хаяж (minPerSide − 1)
 *  гарц үлдээн секцэд хуваана — битүү цагираг гаргахгүй: хашаа руу явган, гал унтраах машин нэвтэрнэ.
 *  Талыг хүрээний ирмэгээр биш OBB-ээр тооцно: огтлолоос үүссэн олон жижиг ирмэгтэй үед ч гарц тасрахгүй. */
function ringSections(B0: Rings, B1: Rings, depth: number, maxLen: number, gap: number, minPerSide = 2): Rings[] {
  const ring = B1.length ? diff(B0, B1) : B0;
  const gaps: Rings[] = [], o = obb(B0);
  // [талын чиглэл, талын урт, талын төвийн шилжилт]
  for (const [ax, L, off] of [[o.u, o.len, mul(o.v, o.wid / 2)], [o.v, o.wid, mul(o.u, o.len / 2)]] as [XY, number, XY][]) {
    const n = Math.max(minPerSide, Math.ceil((L + gap) / (maxLen + gap)));
    for (const sgn of [1, -1]) {
      const sc = add(o.c, mul(off, sgn));
      for (let k = 1; k < n; k++) gaps.push([orientedRect(add(sc, mul(ax, -L / 2 + (L * k) / n)), ax, gap, depth * 3)]);
    }
  }
  const cutR = gaps.length ? diff(ring, unionAll(gaps)) : ring;
  return parts(cutR).filter((q) => area(q) > 120).map((q) => regularRingSection(q, B1, depth, maxLen)).filter((q) => area(q) > 120);
}

type CourtyardFront = { bid: number; c: XY; u: XY; n: XY; len: number };
const COURTYARD_WALK = 3, COURTYARD_BAY = 5, COURTYARD_REAR = 2, COURTYARD_GREEN = 3;
const COURTYARD_PARKING = COURTYARD_BAY + COURTYARD_REAR;
const COURTYARD_INNER = COURTYARD_WALK + COURTYARD_PARKING;

/** Actual courtyard-facing facades, including both wings of an L-shaped building.
 *  A small inward probe identifies the shared courtyard edge without assuming north or an OBB side. */
function courtyardFrontages(g: Gen, CY: Rings): CourtyardFront[] {
  const fronts: CourtyardFront[] = [];
  for (const b of g.s.bldgs.filter((b) => b.lot === g.lot)) for (const ring of b.rings) {
    for (let i = 0; i + 1 < ring.length; i++) {
      const a = ring[i], z = ring[i + 1], len = Math.hypot(z[0] - a[0], z[1] - a[1]);
      if (len < 8) continue;
      const u = norm(sub(z, a));
      for (const n of [perp(u), mul(perp(u), -1)]) {
        const offset = mul(n, 0.3);
        for (const p of clipPath([[add(a, offset), add(z, offset)]], CY)) {
          const first = sub(p[0], offset), last = sub(p[p.length - 1], offset), L = Math.hypot(last[0] - first[0], last[1] - first[1]);
          if (L >= 8) fronts.push({ bid: b.id, c: mul(add(first, last), 0.5), u, n, len: L });
        }
      }
    }
  }
  return fronts.sort((a, b) => a.bid - b.bid || b.len - a.len);
}

/** A six-metre driveway through an existing building gap, only on a side facing an actual street.
 *  The public sidewalk/cycleway stays continuous as a crossing at the lot boundary. */
function courtyardDriveway(g: Gen, CY: Rings, parking: Rings, avoid: Rings): Rings {
  const lot = g.s.base.find((s) => s.lot === g.lot && s.k === "grass")?.rings;
  const roads = g.s.streets.filter((s) => s.k === "road");
  if (!lot || !parking.length || !roads.length) return [];
  const buildings = bufPoly(avoid, 0.3);
  let best: Rings = [], bestCrossing: Rings = [], shortest = Infinity;
  for (const ring of CY) for (let i = 0; i + 1 < ring.length; i++) {
    const a = ring[i], z = ring[i + 1], len = Math.hypot(z[0] - a[0], z[1] - a[1]);
    if (len < 7) continue;
    const u = norm(sub(z, a)), middle = mul(add(a, z), 0.5), left = perp(u);
    const probe = add(middle, mul(left, 0.3)), inward = inside(probe[0], probe[1], CY) ? left : mul(left, -1);
    const steps = Math.ceil((len - 6.6) / 3);
    for (let j = 0; j <= steps; j++) {
      const c = add(a, mul(u, 3.3 + (len - 6.6) * j / steps)), start = add(c, mul(inward, COURTYARD_INNER));
      const ray: Path = [start, add(c, mul(inward, -65))];
      const lotEnds = clipPath([ray], lot).flatMap((p) => [p[0], p[p.length - 1]]);
      const outer = lotEnds.map((p) => -dot(sub(p, c), inward)).filter((d) => d > 0.1).sort((x, y) => x - y)[0];
      if (outer === undefined || outer > 32) continue;
      const driveway = inter([orientedRect(add(c, mul(inward, (COURTYARD_INNER - outer) / 2)), inward, COURTYARD_INNER + outer, 6)], lot);
      if (area(inter(driveway, buildings)) > 0.002 || area(inter(driveway, parking)) < 15) continue;
      const distances = roads.flatMap((r) => clipPath([ray], r.rings)).flatMap((p) => [p[0], p[p.length - 1]])
        .map((p) => -dot(sub(p, c), inward)).filter((d) => d >= outer - 0.1 && d <= outer + 24);
      const roadDist = distances.length ? Math.min(...distances) : Infinity;
      if (roadDist >= shortest) continue;
      // Гудамжны хажуугийн зогсоол бараг тасралтгүй — орцыг хасахын оронд зогсоолыг таслана (curb cut, доор)
      const crossing: Rings = [orientedRect(add(c, mul(inward, -(outer + roadDist) / 2)), inward, roadDist - outer + 0.2, 6)];
      shortest = roadDist; best = driveway; bestCrossing = crossing;
    }
  }
  if (best.length) curbCut(g, bestCrossing);
  return best;
}

/** Орцны өмнө гудамжны хажуугийн зогсоол, зураас, машины байр, цухуйлтын модыг авч, ногоон зурвасыг асфальтаар холбоно.
 *  Явган зам, дугуйн зам тасралтгүй хэвээр (гарц). */
function curbCut(g: Gen, crossing: Rings) {
  const cut = bufPoly(crossing, 1), hit = (p: XY) => inside(p[0], p[1], cut);
  for (let i = g.s.over.length - 1; i >= 0; i--) {
    const o = g.s.over[i];
    if (o.lot !== 0 || o.k !== "parking" || !area(inter(o.rings, cut))) continue;
    const rest = diff(o.rings, cut), removed = area(o.rings) - area(rest);
    g.report("g.parking", -removed); g.report("g.verge", removed);
    if (rest.length) o.rings = rest; else g.s.over.splice(i, 1);
  }
  const spaces = g.s.parkingSpaces ?? [], before = spaces.length;
  g.s.parkingSpaces = spaces.filter((p) => !hit([p.x, p.y]));
  g.report("stalls", g.s.parkingSpaces.length - before);
  g.s.marks = g.s.marks.filter((m) => m.k !== "stall" || !hit(labelPt(m.rings)));
  const treeCount=g.s.trees.length;g.s.trees = g.s.trees.filter((t) => !hit([t.x, t.y]));g.report('trees',g.s.trees.length-treeCount);
  // Зөвхөн ногоон зурвасыг асфальтаар холбоно. Явган/дугуйн зам нь тасралтгүй, түвшин нэг гарц;
  // refreshCourtyardAccess бүтэн зурвас болон огтлолцох замуудыг дүрслэлд тусад нь тэмдэглэнэ.
  const lot = g.lot; g.lot = 0;
  for (const k of ["verge"] as const) {
    const part = inter(unionAll(g.s.streets.filter((x) => x.k === k).map((x) => x.rings)), crossing);
    if (area(part) > 0.5) g.over("parking", part, k);
  }
  g.lot = lot;
}

/** Барилга бүрийн хашаа руу харсан нүүрэнд 3 м явган зам, 5 м зогсоол + ард нь 2 м сул зай.
 *  Дотор талд 3 м ногоон тусгаарлах зурвас, тоглоом, амралт, явган зам; хотхон дотор мод тарихгүй. */
function courtyard(g: Gen, CY: Rings, play: boolean, bays: number, avoid: Rings) {
  if (!CY.length || area(CY) < 300) return;
  const oc = obb(CY), fronts = courtyardFrontages(g, CY), access: Path[] = [];
  const frontageWalk: Rings[] = [], parkingStrips: Rings[] = [], aisles: Rings[] = [];
  const served = new Set<number>(), extension = Math.min(6, g.a.gapEnd / 2);
  for (const f of fronts) {
    frontageWalk.push([orientedRect(add(f.c, mul(f.n, COURTYARD_WALK / 2)), f.u, f.len + 2 * extension, COURTYARD_WALK)]);
    if (bays > 0) {
      parkingStrips.push([orientedRect(add(f.c, mul(f.n, COURTYARD_WALK + COURTYARD_PARKING / 2)), f.u, f.len + 2 * extension, COURTYARD_PARKING)]);
      aisles.push([orientedRect(add(f.c, mul(f.n, COURTYARD_WALK + COURTYARD_BAY + COURTYARD_REAR / 2)), f.u, f.len + 2 * extension, COURTYARD_REAR)]);
    }
    // One unobstructed entrance crossing for each building, connected to the courtyard's cross paths.
    if (!served.has(f.bid)) {
      served.add(f.bid);
      const distances = [oc.u, oc.v].map((axis) => {
        const den = dot(f.n, perp(axis));
        return Math.abs(den) > 0.01 ? dot(sub(oc.c, f.c), perp(axis)) / den : -1;
      }).filter((d) => d > COURTYARD_INNER + COURTYARD_GREEN);
      const reach = distances.length ? Math.min(...distances) : COURTYARD_INNER + COURTYARD_GREEN + 0.5;
      access.push([f.c, add(f.c, mul(f.n, reach))]);
    }
  }
  const strips = inter(unionAll(parkingStrips), CY), driveway = courtyardDriveway(g, CY, strips, avoid);
  const rawParking = unionAll([strips, driveway]);
  if (driveway.length) aisles.push(driveway);
  const yard = parts(diff(CY, bufPoly(rawParking, COURTYARD_GREEN))).filter((q) => area(q) > 200).sort((a, b) => area(b) - area(a))[0] ?? [];
  const yardPaths = yard.length ? [...clipPath([lineThrough(oc.c, oc.u, oc.len)], yard), ...clipPath([lineThrough(oc.c, oc.v, oc.wid)], yard)] : [];
  const paths = [...yardPaths, ...access.flatMap((p) => clipPath([p], CY))];
  const walk = inter(unionAll([...frontageWalk, bufMany(paths.map((p) => ({ paths: [p], d: 1.5 })))]), CY);
  const parking = diff(rawParking, walk);
  // Commercial buildings already have a five-metre forecourt. Replace its shared surface once,
  // so neither a parking bay nor a facade walk is also counted/rendered as a plaza.
  const paving = unionAll([parking, walk]);
  for (let i = g.s.over.length - 1; i >= 0; i--) {
    const surface = g.s.over[i];
    if (surface.lot !== g.lot || surface.k !== "plaza") continue;
    const remaining = diff(surface.rings, paving), removed = area(surface.rings) - area(remaining);
    if (removed > 0) { g.report("g.plaza", -removed); g.report("g.grass", removed); }
    if (remaining.length) surface.rings = remaining; else g.s.over.splice(i, 1);
  }
  if (parking.length) {
    g.over("parking", parking, "grass");
    const bayArea = diff(parking, unionAll(aisles)), accepted: { c: XY; rings: Rings }[] = [];
    for (const f of fronts) {
      // Bays follow the real facade; the compact rear clearance stays clear at corners and along each row.
      const count = Math.floor((f.len - 2) / 2.5), start = -count * 2.5 / 2;
      for (let i = 0; i < count; i++) {
        const c = add(f.c, add(mul(f.u, start + (i + 0.5) * 2.5), mul(f.n, COURTYARD_WALK + COURTYARD_BAY / 2)));
        const rings: Rings = [orientedRect(c, f.u, 2.5, COURTYARD_BAY)];
        if (area(diff(rings, bayArea)) > 0.002 || accepted.some((p) => Math.hypot(p.c[0] - c[0], p.c[1] - c[1]) < 6 && area(inter(rings, p.rings)) > 0.002)) continue;
        accepted.push({ c, rings });
        const facing = mul(f.n, -1);
        g.s.parkingSpaces!.push({ x: c[0], y: c[1], heading: (Math.atan2(facing[0], facing[1]) * 180 / Math.PI + 360) % 360, length: COURTYARD_BAY, width: 2.5 });
        g.s.marks.push({ rings: [orientedRect(add(c, mul(f.u, -1.25)), f.n, COURTYARD_BAY, 0.12)], k: "stall" });
      }
    }
    g.report("stalls", accepted.length);
  }
  if (!yard.length) { g.over("walk", walk, "grass"); return; }
  const o = obb(yard);
  // Тоглоомын талбай (урт тэнхлэгийн нэг талд), амралтын талбай (нөгөө талд) — хоёулаа блокийн тэнхлэгийн дагуу
  const south = dot(o.v, [0, 1]) >= 0 ? -1 : 1;
  const qx = (k: number) => add(o.c, mul(o.u, k * o.len / 4)), side = mul(o.v, south * Math.min(10, o.wid / 4));
  const pw = Math.max(10, Math.min(28, o.len * 0.3)), ph = Math.max(8, Math.min(18, o.wid * 0.35));
  const playG = play ? inter([orientedRect(add(qx(-1), side), o.u, pw, ph)], yard) : [];
  const rest = inter([circle(add(qx(1), side), Math.max(5, Math.min(9, o.wid / 6)))], yard);
  const fac = unionAll([playG, rest]);
  g.over("walk", diff(walk, fac), "grass");
  // Тоглоомын талбай: резин хучилт + голд элсэн хайрцаг (≥ 8 × 8 м бол).
  if (playG.length) {
    const po = obb(playG), pit = po.wid >= 8 && po.len >= 8 ? inter([circle(po.c, Math.min(3, po.wid / 4), 24)], playG) : [];
    g.over("play", pit.length ? diff(playG, pit) : playG, "grass");
    if (pit.length) g.over("sand", pit, "grass");
  }
  g.over("plaza", rest, "grass");
  const lampArea = diff(CY, unionAll([walk, fac, avoid, parking]));
  if (parking.length) for (const f of fronts) {
    const edge = add(f.c, mul(f.n, COURTYARD_INNER + 0.6));
    for (const p of clipPath([lineThrough(edge, f.u, f.len / 2)], CY)) g.lights(p, 25, lampArea);
  }
  for (const p of paths) {
    const edge = p.map((pt, i) => {
      const dir = norm(sub(p[Math.min(i + 1, p.length - 1)], p[Math.max(i - 1, 0)]));
      return add(pt, mul(perp(dir), 1.8));
    });
    g.lights(edge, 20, lampArea);
  }
}

// ---------- Дүрмүүд ----------
/** Орон сууцны давхар: төвд floorsRes × (1 + grad/2), захад × (1 − grad/2) */
function resFloors(a: Attrs, c: XY) {
  if (!a.floorGrad || !a.hubs?.length || !a.hubR) return a.floorsRes;
  const d = Math.min(...a.hubs.map((h) => Math.hypot(h[0] - c[0], h[1] - c[1])));
  const t = Math.max(0, 1 - d / a.hubR);
  return Math.max(2, Math.round(a.floorsRes * (1 + a.floorGrad * (t - 0.5))));
}

/** Блокийн норм: давхар бүрээр (fMax → 2) суурийн дээд хэмжээ = min(BCR, FAR / давхар) хүртэл секцийг дарааллаар дүүргэнэ.
 *  later (урд талын секц) — зөвхөн суурь доод хязгаарт (min) хүрээгүй үед нэмнэ. BCR доод хязгаарыг хангасан
 *  хувилбаруудаас хамгийн их GFA-тайг сонгоно (тэнцвэл олон давхар); аль нь ч хангахгүй бол хамгийн их GFA. */
function fitBlock<T>(cand: T[], later: T[], areaOf: (c: T) => number, fMax: number, bcrCap: number, farCap: number, min: number) {
  const score = (fl: number, foot: number) => foot * fl + (foot >= min - 1 ? 1e9 : 0);
  let best = { fl: 0, foot: 0, pick: [] as T[] };
  for (let fl = fMax; fl >= 2; fl--) {
    const cap = Math.min(bcrCap, farCap / fl);
    let foot = 0;
    const pick: T[] = [];
    for (const c of cand) { const fa = areaOf(c); if (foot + fa <= cap) { foot += fa; pick.push(c); } }
    for (const c of later) { const fa = areaOf(c); if (foot < min && foot + fa <= cap) { foot += fa; pick.push(c); } }
    if (score(fl, foot) > score(best.fl, best.foot) + 1) best = { fl, foot, pick };
  }
  return best;
}

function residential(g: Gen, L: Lot) {
  const a = g.a, floors = resFloors(a, L.c);
  g.base("grass", L.rings);
  const B0 = bufPoly(L.rings, -a.setback);
  if (!B0.length) return;
  const cen = labelPt(L.rings);
  // Блок бүрийн хатуу хязгаар: суурь ≤ BCR × талбай, нийт талбай (GFA) ≤ FAR × талбай — хэтрүүлэхгүй
  const bcrCap = (Math.min(a.bcrRes, a.bcrMaxRes ?? a.bcrRes) / 100) * L.area, farCap = (a.farMaxRes ?? Infinity) * L.area;
  // Хүрээлсэн блок: зөвхөн захын цагираг секц. Хашааны дотор барилга тавихгүй — тоглоом, амралт, зогсоолд
  // (дотор эгнээ нь блок эргэсэн үед хазгай, нарны зайг хангахгүй байсан)
  const ok = (q: Rings) => area(q) >= 40 && (!a.acceptFootprint || a.acceptFootprint(q));
  const min = ((a.bcrMinRes ?? 0) / 100) * L.area;
  const fit = (depth: number) => {
    const B1 = bufPoly(L.rings, -(a.setback + depth));
    const secs = ringSections(B0, B1, depth, a.maxLen, a.gapEnd).filter(ok).sort((p, q) => labelPt(q)[1] - labelPt(p)[1]); // хойд талаас
    // Урд тал нээлттэй (U): урд талын секцийг зөвхөн BCR доод хязгаарт хүрэхгүй үед нэмнэ — хашаа хоосон, сул үлдэхгүй
    const isSouth = (q: Rings) => { const d = sub(labelPt(q), cen); return a.openSouth && B1.length > 0 && d[1] < -0.55 * Math.hypot(d[0], d[1]); };
    return { B1, ...fitBlock(secs.filter((q) => !isSouth(q)), secs.filter(isSouth), area, floors, bcrCap, farCap, min) };
  };
  // Том блокт захын цагираг BCR доод хязгаарт хүрэхгүй бол секцийн гүнийг +4 м (ТААМАГЛАЛ: ≤18 м — нийтлэг секцийн гүн, ШАЛГАХ)
  let best = fit(a.depth);
  if (best.foot < min - 1) { const deep = fit(a.depth + 4); if (deep.foot > best.foot) best = deep; }
  const B1 = best.B1;
  const podiumA = a.comGround && L.edge !== "local" ? 1 : 0;
  let foot = 0;
  const built: Rings[] = [];
  for (const q of best.pick)
    if (g.building(q, { use: "res", kind: "res", floors: best.fl, fh: a.floorH, podium: podiumA, under: "grass" })) { foot += area(q); built.push(q); }
  g.s.lotBcr.set(L.id, foot / L.area);
  const bu = unionAll(built);
  courtyard(g, diff(B1.length ? B1 : B0, bu), true, a.parkBays, bu);
}

function commercial(g: Gen, L: Lot) {
  const a = g.a;
  // Хатуу хучилттай бүтэн блок биш: ногоон суурь, зөвхөн барилгын өмнө 5 м талбай (доор)
  g.base("grass", L.rings);
  const B0 = bufPoly(L.rings, -Math.max(3, a.setback * 0.5)), B1 = bufPoly(L.rings, -(Math.max(3, a.setback * 0.5) + 16));
  if (!B0.length) return;
  // Тал бүрт гарц (≥15 м) — хашаа руу явган, үйлчилгээний машин нэвтэрнэ
  const ok = (q: Rings) => area(q) >= 40 && (!a.acceptFootprint || a.acceptFootprint(q));
  const secs = ringSections(B0, B1, 16, a.maxLen * 1.5, Math.max(15, a.gapEnd)).filter(ok).sort((p, q2) => area(q2) - area(p));
  // BCR ≤ min(bcrCom, орон сууцны дээд BCR), FAR ≤ farMaxCom — хөрш блокуудаас нягт болж төвлөрөл үүсгэхгүй
  const best = fitBlock(secs, [], area, a.floorsCom, (Math.min(a.bcrCom, a.bcrRes, a.bcrMaxRes ?? a.bcrRes) / 100) * L.area, (a.farMaxCom ?? Infinity) * L.area, ((a.bcrMinRes ?? 0) / 100) * L.area);
  let foot = 0;
  const built: Rings[] = [];
  for (const q of best.pick) {
    const upper: MassKind = g.rnd() < 0.5 ? "res" : "office";
    if (g.building(q, { use: "com", kind: upper, floors: best.fl, fh: 3.3, podium: a.comPodium, under: "grass" })) { foot += area(q); built.push(q); }
  }
  if (built.length) g.over("plaza", diff(inter(bufPoly(unionAll(built), 5), L.rings), unionAll(built)), "grass");
  g.s.lotBcr.set(L.id, foot / L.area);
  const bu = unionAll(built);
  const CY = diff(B1.length ? B1 : [], bu);
  if (CY.length) { courtyard(g, CY, false, a.parkBays, bu); }
}

/** OBB-ийн хойд талд байрлах тэгш өнцөгт барилга */
function northBar(L: Lot, B0: Rings, len: number, depth: number, offset = 0): Rings {
  const o = obb(B0.length ? B0 : L.rings);
  const nv = dot(o.v, [0, 1]) >= 0 ? o.v : mul(o.v, -1);
  const c = add(o.c, mul(nv, o.wid / 2 - depth / 2 - offset));
  return fitContainedBar(B0, c, o.u, Math.min(len, o.len * 0.8), depth);
}

function school(g: Gen, L: Lot) {
  const a = g.a;
  g.base("grass", L.rings);
  const B0 = bufPoly(L.rings, -a.setback);
  if (!B0.length) return;
  const main = northBar(L, B0, 90, 16);
  const blds: Rings[] = [];
  if (g.building(main, { use: "school", kind: "school", floors: a.floorsSchool, fh: 3.6, under: "grass" })) blds.push(main);
  const o = obb(B0), nv = dot(o.v, [0, 1]) >= 0 ? o.v : mul(o.v, -1);
  // Спорт талбай + гүйлтийн зам (урд тал)
  const fc = add(o.c, mul(nv, -o.wid / 4));
  for (const [fl, fw] of [[80, 50], [60, 38], [40, 26]]) {
    const f: Rings = [orientedRect(fc, o.u, fl, fw)];
    if (area(inter(f, B0)) > 0.97 * fl * fw) {
      g.over("track", diff(f, bufPoly(f, -4)), "grass");
      g.over("sport", bufPoly(f, -4), "grass");
      blds.push(f);
      break;
    }
  }
  const front = inter([orientedRect(add(o.c, mul(nv, o.wid / 2 - 22)), o.u, 30, 10)], B0);
  g.over("plaza", diff(front, unionAll(blds)), "grass");
  g.scatter(B0, 11, [0.3, 0.5, 0.2], bufPoly(unionAll([...blds, front]), 3));
}

function kinder(g: Gen, L: Lot) {
  const a = g.a;
  g.base("grass", L.rings);
  const B0 = bufPoly(L.rings, -4);
  if (!B0.length) return;
  const bar = northBar(L, B0, 45, 14);
  g.building(bar, { use: "kinder", kind: "kinder", floors: a.floorsKinder, fh: 3.3, under: "grass" });
  const o = obb(B0), nv = dot(o.v, [0, 1]) >= 0 ? o.v : mul(o.v, -1);
  const pc = add(o.c, mul(nv, -o.wid / 5));
  const plays: Rings[] = [];
  for (const k of [-1, 0, 1]) {
    const p = inter([orientedRect(add(pc, mul(o.u, k * Math.min(22, o.len / 3.5))), o.u, 16, 12)], B0);
    if (area(p) > 60) { g.over("play", p, "grass"); plays.push(p); }
  }
  g.scatter(B0, 8, [0.2, 0.5, 0.3], bufPoly(unionAll([bar, ...plays]), 2));
}

function clinic(g: Gen, L: Lot) {
  const a = g.a;
  g.base("grass", L.rings);
  const B0 = bufPoly(L.rings, -a.setback);
  if (!B0.length) return;
  const bar = northBar(L, B0, 70, 18);
  g.building(bar, { use: "clinic", kind: "clinic", floors: a.floorsClinic, fh: 3.6, under: "grass" });
  // Зогсоол — урд талд, талбайн тэнхлэгийн дагуу 11 м зурвас
  const o = obb(B0), nv = dot(o.v, [0, 1]) >= 0 ? o.v : mul(o.v, -1);
  const pk = inter(B0, [orientedRect(add(o.c, mul(nv, -(o.wid / 2 - 5.5))), o.u, o.len + 10, 11)]);
  g.parking(diff(pk, bar), "grass");
  g.scatter(B0, 9, [0.3, 0.5, 0.2], bufPoly(unionAll([bar, pk]), 2));
}

/** Pocket_Park.cga + хорооллын спорт: захын ногоон, гүйлт/алхалтын тойрог зам, загалмай зам, төв талбай,
 *  мини хөл бөмбөг (60×40 / 40×25), сагс, волейболын талбай (28×15), хүүхдийн тоглоом, гэрэлтүүлэг.
 *  Хэмжээ — ТААМАГЛАЛ (олон улсын жишиг талбайн хэмжээ), БНбД-ийн спорт байгууламжийн нормоор ШАЛГАХ. */
function park(g: Gen, L: Lot) {
  g.base("grass", L.rings);
  const inner = bufPoly(L.rings, -10);
  const o = obb(L.rings);
  const loop = inner.length ? bufPath(inner.map((r) => r), 1.8) : [];
  const fac: Rings[] = [];
  // Байгууламж: inner-т бүтэн багтаж, бусадтай 6 м-ээс ойртохгүй бол тавина
  const put = (k: GroundKind, c: XY, len: number, wid: number) => {
    const r: Rings = [orientedRect(c, o.u, len, wid)];
    if (!inner.length || area(inter(r, bufPoly(inner, -3))) < 0.98 * len * wid || fac.some((f) => area(inter(f, bufPoly(r, 6))) > 1)) return false;
    g.over(k, r, "grass"); fac.push(r); return true;
  };
  const at = (fu: number, fv = 0) => add(o.c, add(mul(o.u, fu * o.len), mul(o.v, fv * o.wid)));
  if (L.area > 9000) { if (!put("sport", at(-0.25), 60, 40)) put("sport", at(-0.25), 40, 25); }
  if (L.area > 5000) { put("court", at(0.22, -0.18), 28, 15); put("court", at(0.22, 0.18), 28, 15); }
  put("play", at(0.4), 20, 14);
  const cross = bufMany([...clipPath([lineThrough(o.c, o.u, o.len)], L.rings), ...clipPath([lineThrough(o.c, o.v, o.wid)], L.rings)].map((p) => ({ paths: [p], d: 2 })));
  const plaza = inter([circle(labelPt(L.rings), Math.min(22, Math.sqrt(L.area) / 8))], L.rings);
  const fu = unionAll(fac);
  g.over("track", diff(loop, unionAll([plaza, fu])), "grass"); // гүйлт, алхалтын тойрог
  g.over("walk", diff(cross, unionAll([loop, plaza, bufPoly(fu, 2)])), "grass");
  g.over("plaza", diff(plaza, fu), "grass");
  for (const r of inner) g.lights(r, 25, L.rings);
  g.scatter(L.rings, 13, [0.4, 0.45, 0.15], bufPoly(unionAll([loop, cross, plaza, fu]), 2));
}

/** zoning.cga ProtectiveGreenSpace — TreeDistribution(Tree_Count × 2): шилмүүст модны эгнээ */
function protect(g: Gen, L: Lot) {
  g.base("protect", L.rings);
  const o = obb(L.rings);
  // Эгнээ 12 м, мод 8 м зайтай (өмнө нь 6 × 5 м — 5,000 хүний загварт 2,700+ 3D мод, SceneView 15 с гацдаг байв).
  // Зай — дүрслэлийн ТААМАГЛАЛ; хамгаалалтын зурвасын бодит тарилтын нягтыг БНбД / ойжуулалтын заалтаар ШАЛГАХ
  for (let t = -o.wid / 2 + 3; t < o.wid / 2; t += 12) {
    const p = clipPath([lineThrough(add(o.c, mul(o.v, t)), o.u, o.len)], L.rings);
    for (const q of p) g.row(q, 8, 0, L.rings);
  }
}

/** Инженерийн байгууламж: 0 цэвэрлэх байгууламж, 1 усан сан, 2 дулааны станц, 3 дэд станц */
function eng(g: Gen, L: Lot) {
  g.base("yard", L.rings);
  const c = labelPt(L.rings), f = (L.fac ?? 0) % 4, o = obb(L.rings);
  const put = (r: Rings, h: number, roof: MassKind = "roof") => g.building(inter(r, L.rings), { use: "eng", kind: "eng", floors: 1, fh: h, roof, under: "yard" });
  if (f === 0) {
    for (const k of [-1, 1]) put([circle(add(c, mul(o.u, k * 18)), 12)], 4);
    const tanks = unionAll(g.s.bldgs.filter((b) => b.lot === L.id).map((b) => b.rings));
    const control = fitContainedBar(diff(L.rings, bufPoly(tanks, 2)), add(c, mul(o.v, 25)), o.u, 24, 12);
    if (control.length) put(control, 6);
  } else if (f === 1) {
    put([circle(c, 16)], 6);
  } else if (f === 2) {
    put([orientedRect(c, o.u, 36, 22)], 12);
    put([circle(add(c, mul(o.u, 26)), 2.5, 12)], 45);
  } else {
    put([orientedRect(c, o.u, 22, 12)], 6);
  }
  g.row(L.rings[0] ?? [], 7, 0, L.rings);
}

const RULES: Record<LotUse, (g: Gen, l: Lot) => void> = { res: residential, com: commercial, school, kinder, clinic, park, protect, eng };

// ---------- Гудамж (road.cga, Sidewalk_ob.cga, Bike_road.cga, Lane_with_Crosswalk.cga) ----------
/** Гудамжны хөндлөн огтлол (тэнхлэгээс гадагш): median/2 | lanes × laneW | sep | service | verge | bike | walk.
 * Магистраль: чиглэл бүрт artLanes эгнээ + голын зурвас + туслах зам (тусгаарлах ногоон зурвастай); өргөн хүрэхгүй бол
 * эхлээд туслах зам, дараа нь эгнээ хасна. ТААМАГЛАЛ: тусгаарлах зурвас 3 м, ногоон зурвас ≥ 1.5 м. ШАЛГАХ: БНбД 30-01-04 магистраль гудамжны огтлол. */
export function section(cls: StreetCls, W: number, a: Attrs) {
  const preferredWalk = cls === "local" ? Math.max(2, a.walkW - 0.5) : a.walkW;
  // 18 м дотоод зам: 7 м зорчих хэсэг + тал бүрт 1 м ногоон, 2 м дугуй, 2.5 м явган зам.
  // Хуучин 10–12 м коридорыг lot руу тэлэхгүй; тусдаа дугуйн зурвас бүтэн багтвал гаргана.
  const requestedBike = cls === "local" && W < 2 * (preferredWalk + a.bikeW + a.laneW) ? 0 : a.bikeW;
  const median = cls === "arterial" ? 4 : 0;
  let lanes = Math.max(1, Math.round(cls === "arterial" ? a.artLanes ?? 2 : cls === "collector" ? a.colLanes ?? 1 : 1)); // нэг чиглэлд
  let service = cls === "arterial" ? Math.max(0, a.serviceW ?? 0) : 0, sep = service ? 3 : 0;
  const need = () => 2 * (preferredWalk + requestedBike + lanes * a.laneW + service + sep) + median;
  const MIN_VERGE = 1.5;
  if (service && W - need() < 2 * MIN_VERGE) { service = 0; sep = 0; }
  while (lanes > 1 && W < need()) lanes--;
  const road = lanes * a.laneW + median / 2; // тэнхлэгээс үндсэн хучилтын ирмэг хүртэл
  const carriage = road + sep + service; // тэнхлэгээс туслах замын гадна ирмэг хүртэл (бүх хучилт)
  const walk = Math.min(preferredWalk, Math.max(0, W / 2 - carriage));
  const bike = Math.min(requestedBike, Math.max(0, W / 2 - carriage - walk));
  const verge = Math.max(0, W / 2 - carriage - walk - bike);
  return { walk, bike, verge, median, lanes, road, sep, service, carriage, half: W / 2 };
}

function streets(g: Gen, list: Street[], graph: Graph, site: Rings) {
  const a = g.a;
  const S = list.map((s) => ({ s, x: section(s.cls, s.w, a) }));
  const inSite = (r: Rings, ext?: boolean) => (ext ? r : inter(r, site));
  const jn = graph.nodes.filter((n) => n.deg >= 3);
  const discs = unionAll(jn.map((n) => [circle([n.x, n.y], n.r + 1, 16)]));
  // Уулзварын булан чөлөөтэй (CityEngine Complete_Street): явган гарц (~4 м) + 2.4 м + 1.5 м дотор мод, гэрэл, зогсоол тавихгүй —
  // явган зорчигч, жолоочийн харагдах орчин нээлттэй
  const clear = bufPoly(discs, 8);
  // Гудамж бүрийн тал бүрт дахин тооцохгүй — том полигоны diff нэг удаа (generate-ийн гол удаашрал байсан)
  const siteND = diff(site, discs), free = diff(site, clear);
  for (const ext of [false, true]) {
    const T = S.filter((q) => !!q.s.ext === ext);
    if (!T.length) continue;
    const U = (f: (q: (typeof S)[number]) => number) => inSite(bufMany(T.map((q) => ({ paths: [q.s.path], d: f(q) }))), ext);
    const u1 = U((q) => q.x.half), u2 = U((q) => (q.x.bike ? q.x.half - q.x.walk : 0));
    const u3 = U((q) => q.x.half - q.x.walk - q.x.bike), u4 = U((q) => q.x.carriage), u5 = diff(U((q) => q.x.median / 2), discs);
    // Туслах замын тусгаарлах зурвас: үндсэн хучилтын ирмэгээс sep өргөнтэй, уулзвар дээр тасарна (хөндлөн гудамж туслах замд залгана).
    const sv = T.some((q) => q.x.service) ? diff(diff(U((q) => q.x.road + q.x.sep), U((q) => q.x.road)), discs) : [];
    const put = (k: GroundKind, r: Rings) => { if (r.length) { g.s.streets.push({ rings: r, k, lot: 0 }); g.report(`${ext ? "x" : "g"}.${k}`, area(r)); } };
    put("sidewalk", diff(u1, unionAll([u2, u3])));
    put("bike", diff(u2, u3));
    put("verge", diff(u3, u4));
    put("road", diff(u4, unionAll([u5, sv])));
    put("verge", unionAll([u5, sv]));
  }
  // Уулзвар дотор ногоон тусгаарлах зурвас ба эгнээний зураас үргэлжлэхгүй.
  for (const { s, x } of S) {
    if (s.ext) continue;
    // Эгнээний зураас — offset шугам (тэнхлэгээс ±k × laneW)
    const offs: [number, LaneF["k"]][] = s.cls === "arterial"
      ? [...Array.from({ length: x.lanes - 1 }, (_, k) => [x.median / 2 + (k + 1) * a.laneW, "lane"] as [number, LaneF["k"]])]
      : [[0, "center"]];
    offs.push([x.road - .2, "edge"]);
    if(x.median)offs.push([x.median/2+.2,"edge"]);
    if(x.service)offs.push([x.road + x.sep + .2, "edge"], [x.carriage - .2, "edge"]);
    for (const [d, k] of offs) for (const sign of d ? [1, -1] : [1]) {
      const p = s.path.map((pt, i) => {
        const dir = norm(sub(s.path[Math.min(i + 1, s.path.length - 1)], s.path[Math.max(i - 1, 0)]));
        return add(pt, mul(perp(dir), sign * d));
      });
      for (const q of clipPath([p], siteND)) g.s.lanes.push({ path: q, k });
    }
    const side = (sign: number, d: number) => s.path.map((pt, i) => {
      const dir = norm(sub(s.path[Math.min(i + 1, s.path.length - 1)], s.path[Math.max(i - 1, 0)]));
      return add(pt, mul(perp(dir), sign * d));
    });
    // Автобусны буудал (магистраль, цуглуулах) — зогсоолоос өмнө: буудлын орчинд зогсоол тавихгүй
    const stopsHere: XY[] = [];
    if (s.cls !== "local") for (let t = 150; t < pathLength(s.path); t += a.stopSp) {
      const { pt, dir } = along(s.path, t);
      // Туслах замтай бол буудал тусгаарлах зурвас дээр (үндсэн замд зогсоно), үгүй бол замын захад.
      const q = add(pt, mul(perp(dir), x.service ? x.road + x.sep / 2 : x.road + 1));
      if (inside(q[0], q[1], site) && !inside(q[0], q[1], clear)) { g.s.stops.push(q); stopsHere.push(q); }
    }
    // Буудлын 15 м дотор зогсоол тавихгүй — полигоноор хасахгүй (гудамж бүрт талбайн diff хэт удаан), цэгээр шалгана
    const nearStop = (p: XY) => stopsHere.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 15);
    // Гудамжны дагуух зогсоол (CityEngine Parking.cga санаа): цуглуулах, орон нутгийн гудамжны ногоон зурваст
    // 5 зай (6.5 × 2.5) + 5 м мод суулгах цухуйлт (bulb-out) давтагдана. Мод зогсоолын хэмнэлээр. ТААМАГЛАЛ.
    const curbPark = s.cls !== "arterial" && x.verge >= 3;
    if (curbPark) for (const sign of [1, -1]) {
      for (const q of clipPath([side(sign, x.carriage + 1.25)], free)) {
        const Lq = pathLength(q), stalls: Rings[] = [];
        for (let t = 0; t + 6.5 <= Lq;) {
          for (let k = 0; k < 5 && t + 6.5 <= Lq; k++, t += 6.5) {
            const { pt, dir } = along(q, t + 3.25);
            if (nearStop(pt)) continue;
            stalls.push([orientedRect(pt, dir, 6.5, 2.5)]);
            // Right-hand traffic: cars on the right face along the street, those on the left face back.
            const facing = mul(dir, -sign);
            g.s.parkingSpaces!.push({ x: pt[0], y: pt[1], heading: (Math.atan2(facing[0], facing[1]) * 180 / Math.PI + 360) % 360, length: 6.5, width: 2.5 });
            const e = along(q, t).pt;
            g.s.marks.push({ rings: [orientedRect(e, perp(dir), 2.5, 0.12)], k: "stall" });
            g.report("stalls", 1);
          }
          t += 5;
        }
        if (stalls.length) g.over("parking", unionAll(stalls), "verge");
      }
    }
    // Native roadside trees and lights are coordinated after lot paths and
    // entrances exist, so their shared placement pass can keep access clear.
  }
  const carriageways=unionAll(g.s.streets.filter(s=>s.k==="road").map(s=>s.rings));
  // Явган гарц: уулзвар бүрийн ирмэг тус бүрт
  for (let ni = 0; ni < graph.nodes.length; ni++) {
    const n = graph.nodes[ni];
    if (n.deg < 3 || n.cls === "local") continue;
    for (const ek of graph.adj[ni]) {
      const e = graph.edges[ek], m = graph.nodes[e.a === ni ? e.b : e.a];
      const d = norm(sub([m.x, m.y], [n.x, n.y]));
      const x = section(e.cls, e.w, a);
      const c = add([n.x, n.y], mul(d, n.r + 4));
      let k = 0;
      for (let t = -x.carriage + 0.5; t < x.carriage; t += 1.0) {
        const stripe=inter([orientedRect(add(c, mul(perp(d), t)), d, 4, 0.5)],carriageways);
        if(stripe.length){g.s.marks.push({ rings:stripe, k:"cross" });k++;}
      }
      if (k) g.report("crosswalks", 1);
    }
  }
  g.report("junctions", jn.length);
  for (const s of list) if (!s.ext) g.report(`len.${s.cls}`, pathLength(s.path));
}

/** Бүх lot, гудамжинд дүрэм ажиллуулна */
/** Алхам алхмаар (гудамж, дараа нь lot бүр) — yield бүрийн дараа зогсож болно */
function* generateSteps(lots: Lot[], streetList: Street[], graph: Graph, site: Rings, a: Attrs, walkCuts: Path[]): Generator<void, Scene> {
  const g = new Gen(a);
  streets(g, streetList, graph, site);
  yield;
  // Lot хоорондын явган зам (сургууль, инженерийн lot, цэцэрлэгийн хэсэг)
  const wk = inter(bufMany(walkCuts.map((p) => ({ paths: [p], d: 3 }))), site);
  if (wk.length) { g.s.base.push({ rings: wk, k: "walk", lot: 0 }); g.report("g.walk", area(wk)); }
  for (const l of lots) {
    g.lot = l.id; g.rnd = rng(l.id);
    if ((l.use === "res" || l.use === "com") && sliver(l)) pocket(g, l);
    else RULES[l.use](g, l);
    yield;
  }
  const access=refreshCourtyardAccess(g.s,streetList.map(street=>({...street,...section(street.cls,street.w,a)})));
  return coordinateRoadside(access,streetList.map(street=>({street,...section(street.cls,street.w,a)})));
}
export function generate(lots: Lot[], streetList: Street[], graph: Graph, site: Rings, a: Attrs, walkCuts: Path[]): Scene {
  const it = generateSteps(lots, streetList, graph, site, a, walkCuts);
  for (;;) { const r = it.next(); if (r.done) return r.value; }
}
/** generate()-тай ижил үр дүн; ~40 мс тутамд хөтчид чөлөө өгнө (UI, 3D гацахгүй) */
export async function generateAsync(lots: Lot[], streetList: Street[], graph: Graph, site: Rings, a: Attrs, walkCuts: Path[]): Promise<Scene> {
  const it = generateSteps(lots, streetList, graph, site, a, walkCuts);
  let t = performance.now();
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
    if (performance.now() - t > 40) { await new Promise((ok) => setTimeout(ok, 0)); t = performance.now(); }
  }
}

/** Гурвалжин, нарийн блок (OBB-ийн 62%-иас бага дүүргэлт эсвэл 45 м-ээс нарийн) — барилга тавихад тохиромжгүй.
 *  ТААМАГЛАЛ: босго нь 14 м гүнтэй секц + 6 м ухралт хоёр талаас багтах хамгийн бага өргөн */
function sliver(L: Lot) {
  const o = obb(L.rings);
  return L.area < 0.62 * o.len * o.wid || o.wid < 45;
}

/** Нарийн, гурвалжин блок → жижиг ногоон байгууламж: урт тэнхлэгийн дагуу явган зам, гэрэлтүүлэг, мод */
function pocket(g: Gen, L: Lot) {
  g.base("grass", L.rings);
  const o = obb(L.rings);
  const path = clipPath([lineThrough(o.c, o.u, o.len)], L.rings);
  const walk = bufMany(path.map((p) => ({ paths: [p], d: 1.5 })));
  g.over("walk", walk, "grass");
  for (const p of path) g.lights(p, 20, L.rings);
  g.scatter(L.rings, 9, [0.35, 0.45, 0.2], bufPoly(walk, 2));
}

/** Урсацын жигнэсэн коэффициент (дээвэр 0.9) — rational method жишиг, ТААМАГЛАЛ */
export function runoffC(rep: Report) {
  let s = 0, A = 0;
  for (const [k, v] of Object.entries(GROUND)) { const x = rep[`g.${k}`] ?? 0; s += x * v.C; A += x; }
  s += (rep.foot ?? 0) * 0.9; A += rep.foot ?? 0;
  return A ? s / A : 0;
}

