// Adapted from I:/Bayandun/web/lib/plan.ts and its ParcelHouses 7,000 m² preset.
// Нэгж талбар хуваах хөдөлгүүр. Сонгосон UTM бүсийн метр координат дээр ажиллана — UI, газрын зургаас хамааралгүй.
// Алхам: хил → (хүрээний гудамж) → гол/туслах гудамжны тор → блок → 2 эгнээ нэгж талбар → нийтийн талбай → ногоон үлдэгдэл.
import pc from "polygon-clipping";
import { GER_PARCEL_AREA } from "./gerConfig.ts";
export { GER_PARCEL_AREA } from "./gerConfig.ts";

export type XY = [number, number];
export type Ring = XY[];
export type Poly = Ring[];
export type Multi = Poly[];

export type Params = {
  angle: number;        // гудамж/эгнээний чиглэл, градус (зүүн зүгээс цагийн зүүний эсрэг)
  lotW: number;         // нэгж талбарын нүүр (гудамж дагуу), м
  lotD: number;         // нэгж талбарын гүн, м
  lotsPerBlock: number; // блокийн нэг эгнээнд — дараа нь хөндлөн гудамж
  mainW: number;        // гол гудамжны улаан шугамын өргөн, м
  localW: number;       // туслах/хөндлөн гудамжны өргөн, м
  perimW: number;       // хилийн дагуух хүрээний гудамж, м (0 = байхгүй)
  minLotRatio: number;  // хил тайрсан талбарыг хүлээн авах доод хувь (0–1); 1 = зөвхөн бүтэн талбар, тайрсан хэсэг ногоон
  publicLots: number;   // гол гудамжинд ойр нийтийн зориулалтад нөөцлөх талбарын тоо
  ox: number; oy: number; // торын шилжилт, м (search=true үед автоматаар олно)
  search: boolean;
  // Хөрш нэгж талбарын эгнээтэй зэрэгцүүлэх: p = хөршийн эгнээний (гудамжны эсрэг) ирмэг дээрх цэг (UTM), pitch = эгнээний давтамж, м.
  // Өгвөл хамгийн доод блокийн эгнээ хөршийн эгнээний шугамын үргэлжлэл болно (oy тогтоно, зөвхөн ox-ыг хайна).
  anchor: { p: XY; pitch: number } | null;
  // Холимог хэмжээ: size = нэрлэсэн талбай (м²), share = талбайн зорилтот хувь. Нүүр = size / lotD; null бол бүгд lotW × lotD.
  mix: { size: number; share: number }[] | null;
  // Төвийн цэцэрлэгт хүрээлэн: хоосон үлдэх зурвасыг хилийн захаас гол гудамжны оронд (гудамж | ногоон | гудамж) шилжүүлнэ.
  // park = зурвасын өргөн, м (runPlan автоматаар олно); centerPark = false бол унтраана.
  park?: number; centerPark?: boolean;
  // Ижил тооны талбар өгөх торын байрлалуудаас талбаруудыг локал x-ийн аль зах руу шахах: −1 = бага, 1 = их (нөгөө захад чөлөөт зурвас үлдэнэ)
  alignX?: number;
  // "double" = хоёр эгнээ ар араасаа (блок 2×гүн); "single" = эгнээ бүр өөрийн гудамжтай (хөрш Сансар гудамжны 50 м + 14 м шиг)
  rows: "double" | "single";
};

export const MIX_DEFAULT: NonNullable<Params["mix"]> = [
  { size: 2000, share: 40 }, { size: 4000, share: 20 }, { size: 5000, share: 20 }, { size: 7000, share: 20 },
];

export const DEFAULT_PARAMS: Params = {
  angle: 37.5, lotW: 40, lotD: 50, lotsPerBlock: 4, mainW: 20, localW: 12, perimW: 0,
  minLotRatio: 1, publicLots: 0, ox: 0, oy: 0, search: true, anchor: null, mix: null, rows: "double",
};

/** Нэг өрхийн хашаа: хэрэглэгчийн хүссэн 0.7 га = 7,000 м². */
export const GER_DEFAULT_PARAMS: Params = {
  ...DEFAULT_PARAMS,
  angle: 0,
  lotW: GER_PARCEL_AREA / 86.9,
  lotD: 86.9,
  lotsPerBlock: 5,
  mainW: 10,
  localW: 12,
  minLotRatio: 1,
  publicLots: 0,
  mix: null,
  centerPark: false,
};

export type Use = "res" | "public";
export type Lot = {
  id: string; no: number; use: Use; block: string; poly: Multi; area: number;
  front: number; depth: number; size: number; trimmed: boolean; access: "street" | "perimeter"; c: XY;
};
export type Metrics = {
  site: number; streets: number; main: number; green: number; res: number; pub: number;
  resCount: number; avgLot: number; minLot: number; maxLot: number; closure: number;
  bySize: { size: number; count: number; area: number }[]; // нэрлэсэн хэмжээгээр (орон сууцны)
};
export type Plan = {
  site: Multi; streets: Multi; main: Multi; green: Multi; lots: Lot[]; blocks: { id: string; poly: Multi }[];
  centerlines: XY[][]; // гудамжны тэнхлэг (инженерийн шугам, урт, төсөвт)
  metrics: Metrics; params: Params; warnings: string[];
};

// ---------- геометр ----------
const ringArea = (r: Ring) => { let s = 0; for (let i = 0, n = r.length; i < n; i++) { const a = r[i], b = r[(i + 1) % n]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
export const area = (m: Multi) => m.reduce((s, p) => s + p.reduce((t, r, i) => t + (i ? -1 : 1) * Math.abs(ringArea(r)), 0), 0);
const rot = ([x, y]: XY, [cx, cy]: XY, a: number): XY => { const c = Math.cos(a), s = Math.sin(a), dx = x - cx, dy = y - cy; return [cx + dx * c - dy * s, cy + dx * s + dy * c]; };
const rotM = (m: Multi, c: XY, a: number): Multi => m.map((p) => p.map((r) => r.map((q) => rot(q, c, a))));
const rect = (x0: number, y0: number, x1: number, y1: number): Poly => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]];
const clean = (m: Multi, min = 0.5): Multi => m.filter((p) => area([p]) >= min);
// polygon-clipping нь бараг давхцсан ирмэг дээр хөвөгч таслалын алдаагаар унадаг тул оролтыг 0.1 мм торонд бэхэлж,
// унавал 1 мм, 1 см тороор дахин оролдоно.
const snap = (m: Multi, g: number): Multi => m.map((p) => p.map((r) => r.map(([x, y]) => [Math.round(x / g) * g, Math.round(y / g) * g] as XY)));
function robust(op: (ms: Multi[]) => unknown, ms: Multi[]): Multi {
  for (const g of [1e-4, 1e-3, 1e-2]) { try { return clean(op(ms.map((m) => snap(m, g))) as Multi); } catch (e) { if (g === 1e-2) throw e; } }
  return [];
}
export const inter = (a: Multi, b: Multi): Multi => (a.length && b.length ? robust(([x, y]) => pc.intersection(x, y), [a, b]) : []);
export const diff = (a: Multi, b: Multi): Multi => (!a.length ? [] : !b.length ? a : robust(([x, y]) => pc.difference(x, y), [a, b]));
export const union = (list: Multi[]): Multi => { const l = list.filter((m) => m.length); return l.length ? robust((ms) => pc.union(ms[0], ...ms.slice(1)), l) : []; };
const centroid = (m: Multi): XY => {
  // ArcGIS and polygon-clipping use opposite outer-ring orientations. Weight
  // holes by their position, independent of winding, in a local metre frame.
  const origin = m[0]?.[0]?.[0] ?? [0, 0];
  let A = 0, X = 0, Y = 0;
  for (const p of m) p.forEach((r, k) => {
    let cross = 0, x = 0, y = 0;
    for (let i = 0; i < r.length; i++) {
      const a: XY = [r[i][0] - origin[0], r[i][1] - origin[1]], q = r[(i + 1) % r.length];
      const b: XY = [q[0] - origin[0], q[1] - origin[1]], f = a[0] * b[1] - b[0] * a[1];
      cross += f; x += (a[0] + b[0]) * f; y += (a[1] + b[1]) * f;
    }
    if (Math.abs(cross) < 1e-8) return;
    const weight = (k ? -1 : 1) * Math.abs(cross) / 2;
    A += weight; X += weight * x / (3 * cross); Y += weight * y / (3 * cross);
  });
  return A ? [origin[0] + X / A, origin[1] + Y / A] : [...origin];
};
function inRing([x, y]: XY, r: Ring) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
export const inside = (q: XY, m: Multi) => m.some((p) => inRing(q, p[0]) && !p.slice(1).some((h) => inRing(q, h)));
const segX = (a: XY, b: XY, c: XY, d: XY) => {
  const o = (p: XY, q: XY, r: XY) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
};

/** Тэгш өнцөгт ба олон өнцөгтийн огтлолцлын талбай. Бүрэн дотор/гадна үед polygon-clipping дуудахгүй. */
function rectInter(x0: number, y0: number, x1: number, y1: number, m: Multi): { a: number; g: Multi | null } {
  const full = (x1 - x0) * (y1 - y0), cs: XY[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const inn = cs.map((q) => inside(q, m));
  let cross = false, vin = false;
  for (const p of m) for (const r of p) for (let i = 0; i < r.length - 1 && !cross; i++) {
    const a = r[i], b = r[i + 1];
    if (a[0] > x0 && a[0] < x1 && a[1] > y0 && a[1] < y1) vin = true;
    for (let k = 0; k < 4; k++) if (segX(a, b, cs[k], cs[(k + 1) % 4])) { cross = true; break; }
  }
  if (!cross && !vin) {
    if (inn.every(Boolean)) return { a: full, g: [rect(x0, y0, x1, y1)] };
    if (!inn.some(Boolean)) return { a: 0, g: null };
  }
  const g = inter([rect(x0, y0, x1, y1)], m);
  return { a: area(g), g };
}

/** Хилийн дагуух w өргөнтэй зурвас (хилийн ирмэг бүрийн тэгш өнцөгт + оройн найман өнцөгт). */
export function edgeBand(m: Multi, w: number): Multi {
  const parts: Multi[] = [];
  for (const p of m) for (const r of p) for (let i = 0; i < r.length - 1; i++) {
    const a = r[i], b = r[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-6) continue;
    const nx = (-(b[1] - a[1]) / L) * w, ny = ((b[0] - a[0]) / L) * w;
    parts.push([[[[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny], [a[0] + nx, a[1] + ny]]]]);
    const oct: Ring = Array.from({ length: 8 }, (_, k) => [a[0] + w * Math.cos((k * Math.PI) / 4 + Math.PI / 8), a[1] + w * Math.sin((k * Math.PI) / 4 + Math.PI / 8)] as XY);
    parts.push([[[...oct, oct[0]]]]);
  }
  return union(parts);
}

// ---------- тор ----------
type Grid = { rows: { y0: number; y1: number; r: number }[]; cols: { x0: number; x1: number; c: number }[]; mainY: [number, number] };

const blockDepth = (p: Params) => (p.rows === "single" ? 1 : 2) * p.lotD;
/** Төвийн зурвасын хагас өргөн: гол гудамж, эсвэл (төвд цэцэрлэгт хүрээлэнтэй бол) туслах гудамж + хүрээлэнгийн хагас. */
const halfBand = (p: Params) => ((p.park ?? 0) > 0 ? p.localW + p.park! / 2 : p.mainW / 2);

function grid(bb: number[], c: XY, p: Params): Grid {
  const D2 = blockDepth(p), L = p.lotsPerBlock * p.lotW, yc = c[1] + p.oy;
  const rows: Grid["rows"] = [];
  // гол гудамжнаас дээш/доош блокийн эгнээ: [блок 2×гүн][туслах гудамж]...
  for (let y = yc + halfBand(p), r = 0; y < bb[3]; y += D2 + p.localW, r++) rows.push({ y0: y, y1: y + D2, r });
  for (let y = yc - halfBand(p), r = -1; y > bb[1]; y -= D2 + p.localW, r--) rows.push({ y0: y - D2, y1: y, r });
  const step = L + p.localW, x0 = c[0] + p.ox - Math.ceil((c[0] + p.ox - bb[0]) / step + 1) * step;
  const cols: Grid["cols"] = [];
  for (let x = x0, k = 0; x < bb[2]; x += step, k++) if (x + L > bb[0]) cols.push({ x0: x, x1: x + L, c: k });
  return { rows, cols, mainY: [yc - halfBand(p), yc + halfBand(p)] };
}

type Cand = { x0: number; y0: number; x1: number; y1: number; a: number; g: Multi | null; row: number; col: number; i: number; top: boolean; access: Lot["access"]; trimmed: boolean };

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** Холимог хэмжээ: эгнээний ашиглах боломжтой нэгжүүдийг (нүүрний ХИЕ-ээр) талбайн зорилтот хувиар хамгийн их дутагдалтай хэмжээгээр дүүргэнэ. */
function mixSpans(row: { x0: number; x1: number }, y0: number, y1: number, inner: Multi, p: Params, got: Map<number, number>): [number, number][] {
  const ws = p.mix!.map((m) => Math.round((m.size / p.lotD) * 10) / 10).filter((w) => w > 0);
  const share = new Map(p.mix!.map((m, i) => [ws[i], m.share]));
  const shareSum = [...share.values()].reduce((s, v) => s + v, 0) || 1;
  const unit = ws.map((w) => Math.round(w * 10)).reduce(gcd) / 10, n = Math.floor((row.x1 - row.x0) / unit + 1e-6);
  const ok = Array.from({ length: n }, (_, k) => rectInter(row.x0 + k * unit, y0, row.x0 + (k + 1) * unit, y1, inner).a >= p.minLotRatio * unit * (y1 - y0) - 0.5);
  const spans: [number, number][] = [];
  for (let k = 0; k < n;) {
    if (!ok[k]) { k++; continue; }
    let e = k; while (e < n && ok[e]) e++;
    for (let x = row.x0 + k * unit, end = row.x0 + e * unit; end - x >= Math.min(...ws) - 1e-6;) {
      const total = [...got.values()].reduce((s, v) => s + v, 0);
      const fit = ws.filter((w) => w <= end - x + 1e-6 && (share.get(w) ?? 0) > 0);
      if (!fit.length) break;
      const w = fit.reduce((a, b) => {
        const d = (q: number) => (share.get(q)! / shareSum) - ((got.get(q) ?? 0) + q * p.lotD) / (total + q * p.lotD);
        return d(b) > d(a) + 1e-9 || (Math.abs(d(b) - d(a)) <= 1e-9 && b > a) ? b : a;
      });
      spans.push([x, x + w]); got.set(w, (got.get(w) ?? 0) + w * p.lotD); x += w;
    }
    k = e;
  }
  return spans;
}

function layLots(S: Multi, inner: Multi, bb: number[], c: XY, p: Params, withGeom: boolean) {
  const G = grid(bb, c, p), out: Cand[] = [], got = new Map<number, number>();
  // Нэг эгнээт блок: гол гудамжнаас дээших эгнээ доод (гол тал руу), доошихь нь дээд гудамж руу нүүрлэнэ
  for (const row of G.rows) for (const col of G.cols) for (const top of p.rows === "single" ? [row.r < 0] : [false, true]) {
    const y0 = top && p.rows !== "single" ? row.y0 + p.lotD : row.y0, y1 = y0 + p.lotD;
    const spans: [number, number][] = p.mix?.length ? mixSpans(col, y0, y1, inner, p, got) : Array.from({ length: p.lotsPerBlock }, (_, i) => [col.x0 + i * p.lotW, col.x0 + (i + 1) * p.lotW]);
    spans.forEach(([x0, x1], i) => {
    const full = (x1 - x0) * p.lotD;
    const { a, g } = rectInter(x0, y0, x1, y1, inner);
    if (a < p.minLotRatio * full - 0.5) return; // 100% үед зөвхөн бүтэн талбар (0.5 м² хөвөгч таслалын хүлцэл)
    const trimmed = a < full - 0.5, xm = (x0 + x1) / 2;
    // Нүүрний гудамж (эсвэл блокийн төгсгөлийн хөндлөн гудамж) бүтэн өргөнөөрөө хилийн дотор байх ёстой —
    // хилийн нарийн үлдэгдэл зурвасыг гудамж гэж тооцохгүй. Гудамжны 1 м ба (өргөн − 1) м цэгийг шалгана.
    const ds = [1, p.localW - 1], ym = (y0 + y1) / 2;
    const frontOk = ds.every((d) => inside(top ? [xm, y1 + d] : [xm, y0 - d], S));
    const sideOk = (Math.abs(x0 - col.x0) < 0.01 && ds.every((d) => inside([x0 - d, ym], S))) || (Math.abs(x1 - col.x1) < 0.01 && ds.every((d) => inside([x1 + d, ym], S)));
    let access: Lot["access"] | null = frontOk || sideOk ? "street" : null;
    if (!access && p.perimW > 0 && trimmed) access = "perimeter";
    if (!access) return;
    out.push({ x0, y0, x1, y1, a, g: withGeom ? g : null, row: row.r, col: col.c, i, top, access, trimmed });
    });
  }
  return { G, cands: out };
}

/** Хилийг локал (тор) координат руу эргүүлж, хүрээний гудамжийг хасна. */
const closeM = (m: Multi): Multi => m.map((p) => p.map((r) => (r.length && (r[0][0] !== r.at(-1)![0] || r[0][1] !== r.at(-1)![1]) ? [...r, r[0]] : r)));

function frame(site: Multi, p: Params) {
  const siteUtm = closeM(site), c0 = centroid(siteUtm), th = (p.angle * Math.PI) / 180;
  const S = rotM(siteUtm, c0, -th);
  const band = p.perimW > 0 ? edgeBand(S, p.perimW) : [];
  const inner = band.length ? diff(S, band) : S;
  const xs = S.flatMap((q) => q[0].map((v) => v[0])), ys = S.flatMap((q) => q[0].map((v) => v[1]));
  return { c0, th, S, inner, bb: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
}

/** Зангуу (хөршийн эгнээ)-аас oy: хилийн доод хэсгээс дээших хамгийн ойрын хөршийн эгнээний шугамд хамгийн доод блокийг тавина. */
function anchoredOy(F: ReturnType<typeof frame>, p: Params): number | null {
  if (!p.anchor) return null;
  const a = rot(p.anchor.p, F.c0, -F.th), pitch = p.anchor.pitch, ymin = F.bb[1];
  const target = pitch > 0 ? a[1] + pitch * Math.ceil((ymin - a[1]) / pitch) : a[1];
  const D2 = blockDepth(p), P = D2 + p.localW;
  const K = Math.max(0, Math.round((F.c0[1] - target - p.mainW / 2 - D2) / P));
  return target + p.mainW / 2 + D2 + K * P - F.c0[1];
}

/** Торын шилжилтийг (ox, oy) хайж хамгийн олон бүтэн нэгж талбар өгөх хувилбарыг сонгоно. Зангуутай бол oy тогтмол. */
export function optimise(siteUtm: Multi, p: Params, n = 10) {
  const F = frame(siteUtm, p), mx = p.lotsPerBlock * p.lotW + p.localW, my = blockDepth(p) + p.localW, fixedOy = anchoredOy(F, p);
  let best = { ox: p.ox, oy: fixedOy ?? p.oy, score: -1 };
  // Зангуутай (oy тогтмол) үед ox-ыг ≤2 м алхамаар: том талбар (жишээ нь 7,000 м²) хилд хэдхэн метрийн зайтай л багтана
  const na = fixedOy == null ? n : Math.max(2 * n, Math.ceil(mx / 2));
  for (let a = 0; a < na; a++) for (let b = 0; b < (fixedOy == null ? n : 1); b++) {
    const q = { ...p, ox: fixedOy == null ? (a / n - 0.5) * mx : (a / na - 0.5) * mx, oy: fixedOy ?? (b / n - 0.5) * my };
    const { cands } = layLots(F.S, F.inner, F.bb, F.c0, q, false);
    const sumA = cands.reduce((s, k) => s + k.a, 0), trimN = cands.filter((k) => k.trimmed).length;
    const meanX = cands.length ? cands.reduce((t, k) => t + (k.x0 + k.x1) / 2, 0) / cands.length - F.c0[0] : 0;
    const score = (p.mix?.length ? sumA * 10 - trimN * 1000 : cands.length * 1e7 + sumA - trimN * 100) + (p.alignX ?? 0) * meanX * 1e-2;
    if (score > best.score) best = { ox: q.ox, oy: q.oy, score };
  }
  return { ox: best.ox, oy: best.oy };
}

export function runPlan(siteUtm: Multi, input: Params): Plan {
  const p0 = input.search ? { ...input, ...optimise(siteUtm, input) } : input;
  const p1 = !input.search && input.anchor ? { ...p0, oy: anchoredOy(frame(siteUtm, p0), p0) ?? p0.oy } : p0;
  const F0 = frame(siteUtm, p1);
  // Хилийн захад үлдэх хоосон зурвасыг (T дээд, B доод) төв рүү: доод эгнээг доод хил рүү, дээдийг дээд хил рүү түлхэнэ.
  // Талбарын тоо, талбай буурахгүй бол л хэрэглэнэ.
  let p = p1;
  if (p1.centerPark !== false && !(p1.park ?? 0)) {
    const base = layLots(F0.S, F0.inner, F0.bb, F0.c0, p1, false).cands;
    if (base.length) {
      const B = Math.min(...base.map((k) => k.y0)) - F0.bb[1], T = F0.bb[3] - Math.max(...base.map((k) => k.y1));
      // 5 см нөөц: эргүүлсэн хилийн хөвөгч таслалаас болж захын талбар хилээс гарч «бүтэн биш» болохоос сэргийлнэ
      const down = B > 0.5 ? B - 0.05 : 0, park = Math.floor(p1.mainW - 2 * p1.localW + T - 0.05 + down);
      if (park >= 12) {
        const q = { ...p1, park, oy: p1.oy - p1.mainW / 2 - down + p1.localW + park / 2 };
        const alt = layLots(F0.S, F0.inner, F0.bb, F0.c0, q, false).cands, sum = (c: Cand[]) => c.reduce((t, k) => t + k.a, 0);
        if (alt.length >= base.length && sum(alt) >= sum(base) - 1) p = q;
      }
    }
  }
  const F = frame(siteUtm, p), { S, inner, bb, c0, th } = F;
  const { G, cands } = layLots(S, inner, bb, c0, p, true);
  const warnings: string[] = [];

  // Блок (локал) — гудамжаар хүрээлэгдсэн тэгш өнцөгт; хилээр тайрна
  const rowsSorted = [...G.rows].sort((a, b) => b.y0 - a.y0), rowName = new Map(rowsSorted.map((r, k) => [r.r, String.fromCharCode(65 + k)]));
  const blocks = G.rows.flatMap((r) => G.cols.map((c) => ({ id: `${rowName.get(r.r)}${c.c - Math.min(...G.cols.map((k) => k.c)) + 1}`, poly: inter([rect(c.x0, r.y0, c.x1, r.y1)], inner) }))).filter((b) => b.poly.length);
  // Төвийн цэцэрлэгт хүрээлэн: багана бүрд (хөндлөн гудамж дундуур нь үргэлжилнэ) — блокт тооцож ногоон болно
  const yPark = (G.mainY[0] + G.mainY[1]) / 2, parkW = p.park ?? 0;
  if (parkW > 0) blocks.push(...G.cols.map((c) => ({ id: `П${c.c - Math.min(...G.cols.map((k) => k.c)) + 1}`, poly: inter([rect(c.x0, yPark - parkW / 2, c.x1, yPark + parkW / 2)], inner) })).filter((b) => b.poly.length));
  const blockU = union(blocks.map((b) => b.poly));

  // Дугаарлалт: дээрээс доош, баруунаас зүүн (локал тор)
  const sorted = [...cands].sort((a, b) => b.y0 - a.y0 || a.x0 - b.x0);
  const blockOf = (k: Cand) => { const r = G.rows.find((q) => q.r === k.row)!; return `${rowName.get(r.r)}${k.col - Math.min(...G.cols.map((q) => q.c)) + 1}`; };

  // Нийтийн зориулалт: гол гудамжинд нүүрээрээ залгасан, төвд хамгийн ойр талбарууд
  const yc = (G.mainY[0] + G.mainY[1]) / 2, cx = c0[0];
  const onMain = (k: Cand) => (!k.top && Math.abs(k.y0 - G.mainY[1]) < 0.01) || (k.top && Math.abs(k.y1 - G.mainY[0]) < 0.01);
  const mid = (k: Cand): XY => [(k.x0 + k.x1) / 2, (k.y0 + k.y1) / 2];
  const pool = sorted.filter((k) => !k.trimmed), pubSet = new Set<Cand>();
  const first = [...pool].sort((a, b) => Number(onMain(b)) - Number(onMain(a)) || Math.hypot(mid(a)[0] - cx, mid(a)[1] - yc) - Math.hypot(mid(b)[0] - cx, mid(b)[1] - yc))[0];
  // Дараагийнхыг эхнийхтэй нэг эгнээнд зэрэгцүүлж нэг нэгдмэл талбай болгоно
  if (first && p.publicLots > 0) {
    pubSet.add(first);
    const rest = pool.filter((k) => k !== first).sort((a, b) => {
      const same = (k: Cand) => Number(k.row === first.row && k.top === first.top);
      return same(b) - same(a) || Math.hypot(mid(a)[0] - mid(first)[0], mid(a)[1] - mid(first)[1]) - Math.hypot(mid(b)[0] - mid(first)[0], mid(b)[1] - mid(first)[1]);
    });
    rest.slice(0, p.publicLots - 1).forEach((k) => pubSet.add(k));
  }
  if (p.publicLots > 0 && pubSet.size < p.publicLots) warnings.push(`Нийтийн зориулалтад ${p.publicLots} бүтэн талбар хүссэн ч ${pubSet.size} олдсон.`);

  const back = (m: Multi) => rotM(m, c0, th);
  const lots: Lot[] = [];
  let no = 0;
  for (const k of sorted) {
    if (pubSet.has(k)) continue;
    no++;
    const poly = back(k.g!);
    lots.push({ id: `Б-${String(no).padStart(3, "0")}`, no, use: "res", block: blockOf(k), poly, area: k.a, front: k.x1 - k.x0, depth: p.lotD, size: Math.round((k.x1 - k.x0) * p.lotD), trimmed: k.trimmed, access: k.access, c: centroid(poly) });
  }
  // Зэргэлдээ нийтийн талбаруудыг нэгтгэнэ
  if (pubSet.size) {
    const merged = union([...pubSet].map((k) => k.g!));
    merged.forEach((poly, j) => {
      const pm = back([poly]);
      lots.push({ id: `Н-${String(j + 1).padStart(2, "0")}`, no: 0, use: "public", block: blockOf([...pubSet][0]), poly: pm, area: area(pm), front: p.lotW, depth: p.lotD, size: Math.round(area(pm)), trimmed: false, access: "street", c: centroid(pm) });
    });
  }

  const lotU = union(cands.map((k) => k.g!));
  const streetsL = diff(S, blockU);
  const mainL = inter(streetsL, [rect(bb[0] - 10, G.mainY[0], bb[2] + 10, G.mainY[1])]);
  const greenL = diff(blockU, lotU);

  // Гудамжны тэнхлэг: эгнээ хоорондын (ба захын) хэвтээ, блок хоорондын босоо зурвасын голоор; гудамжны полигон дотор 2 м алхамаар
  const ys = [...G.rows].sort((a, b) => a.y0 - b.y0), xs = [...G.cols].sort((a, b) => a.x0 - b.x0);
  const hY = [ys[0] && ys[0].y0 - p.localW / 2, ...ys.slice(1).flatMap((r, i) => parkW > 0 && r.r === 0 ? [ys[i].y1 + p.localW / 2, r.y0 - p.localW / 2] : [(ys[i].y1 + r.y0) / 2]), ys.at(-1) && ys.at(-1)!.y1 + p.localW / 2].filter((v): v is number => v != null);
  const vX = [xs[0] && xs[0].x0 - p.localW / 2, ...xs.slice(1).map((c, i) => (xs[i].x1 + c.x0) / 2), xs.at(-1) && xs.at(-1)!.x1 + p.localW / 2].filter((v): v is number => v != null);
  const runs = (pt: (t: number) => XY, t0: number, t1: number) => {
    const out: XY[][] = [];
    let cur: XY[] = [];
    for (let t = t0; t <= t1; t += 2) { const q = pt(t); if (inside(q, streetsL)) cur.push(q); else { if (cur.length > 5) out.push(cur); cur = []; } }
    if (cur.length > 5) out.push(cur);
    return out.map((r) => [r[0], r.at(-1)!] as XY[]);
  };
  const centerL = [...hY.flatMap((y) => runs((t) => [t, y], bb[0], bb[2])), ...vX.flatMap((x) => runs((t) => [x, t], bb[1], bb[3]))];

  const siteA = area(S), stA = area(streetsL), grA = area(greenL);
  const res = lots.filter((l) => l.use === "res"), resA = res.reduce((s, l) => s + l.area, 0), pubA = lots.filter((l) => l.use === "public").reduce((s, l) => s + l.area, 0);
  const metrics: Metrics = {
    site: siteA, streets: stA, main: area(mainL), green: grA, res: resA, pub: pubA, resCount: res.length,
    avgLot: res.length ? resA / res.length : 0, minLot: res.length ? Math.min(...res.map((l) => l.area)) : 0, maxLot: res.length ? Math.max(...res.map((l) => l.area)) : 0,
    closure: siteA - (stA + grA + resA + pubA),
    bySize: [...new Set(res.map((l) => l.size))].sort((a, b) => a - b).map((size) => ({ size, count: res.filter((l) => l.size === size).length, area: res.filter((l) => l.size === size).reduce((t, l) => t + l.area, 0) })),
  };
  const trimmedN = res.filter((l) => l.trimmed).length;
  if (trimmedN) warnings.push(`${trimmedN} талбар хилээр тайрагдсан (≥ ${Math.round(p.minLotRatio * 100)}% талбайтай) — хэмжээ стандартаас бага.`);
  const perimN = res.filter((l) => l.access === "perimeter").length;
  if (perimN) warnings.push(`${perimN} талбар зөвхөн хүрээний гудамжаар нэвтэрнэ.`);
  if (Math.abs(metrics.closure) > 1) warnings.push(`Талбайн балансын зөрүү ${metrics.closure.toFixed(1)} м².`);

  return { site: back(S), streets: back(streetsL), main: back(mainL), green: back(greenL), lots, centerlines: centerL.map((l) => l.map((q) => rot(q, c0, th))), blocks: blocks.map((b) => ({ id: b.id, poly: back(b.poly) })), metrics, params: p, warnings };
}

/** Нэгж талбарын гадна хүрээний оройнууд (давхардсан төгсгөл, шулуун дээрх цэггүй). */
export function corners(m: Multi): XY[] {
  const r = m[0]?.[0] ?? [];
  const pts = r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r.slice(0, -1) : r.slice();
  return pts.filter((q, i) => {
    const a = pts[(i - 1 + pts.length) % pts.length], b = pts[(i + 1) % pts.length];
    return Math.abs((q[0] - a[0]) * (b[1] - a[1]) - (q[1] - a[1]) * (b[0] - a[0])) > 0.01 * Math.hypot(b[0] - a[0], b[1] - a[1]);
  });
}

/** Хөршийн нэгж талбарын ирмэгийн давамгай чиглэл (0–90°), урт-жинтэй дундаж (4θ дээр). */
export function dominantAngle(polys: Multi[]): number {
  let sx = 0, sy = 0;
  for (const m of polys) for (const p of m) for (const r of p) for (let i = 0; i < r.length - 1; i++) {
    const dx = r[i + 1][0] - r[i][0], dy = r[i + 1][1] - r[i][1], L = Math.hypot(dx, dy), a = Math.atan2(dy, dx) * 4;
    sx += L * Math.cos(a); sy += L * Math.sin(a);
  }
  const deg = ((Math.atan2(sy, sx) / 4) * 180) / Math.PI;
  return ((deg % 90) + 90) % 90;
}
