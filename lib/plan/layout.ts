// Алхам 1–4: хүн амын хөтөлбөр → органик талбай → гол/туслах тэнхлэг → бүсчлэл → блок хуваалт (recursive subdivision).
// Тор биш: тэнхлэг газрын гадаргыг даган муруйна (DEM A*), блок нь супер блокийг OBB-ээр рекурсив хуваана (CityEngine subdivision).
import { slopeAt, zAt, type Dem } from "./dem";
import {routeTerrain,routePathMetrics} from "./terrainRoute";
import {
  add, area, bbox, bufMany, bufPath, bufPoly, circle, clipPath, cut, densify, diff, dist, dot, generalizePath, inside, inter,
  labelPt, lineThrough, mul, nearest, norm, obb, orientedRect, parts, pathLength, perp, rng, smooth, sub, unionAll, type Path, type Rings, type XY,
} from "./geom";

export type StreetCls = "arterial" | "collector" | "local";
export type Street = { id: number; cls: StreetCls; path: Path; w: number; ext?: boolean };
export type ZoneCls = "res" | "com" | "edu" | "health" | "park" | "protect" | "eng";
export type ZonePiece = { id: number; cls: ZoneCls; rings: Rings; area: number };
export type LotUse = "res" | "com" | "school" | "kinder" | "clinic" | "park" | "protect" | "eng";
export type Lot = { id: number; zone: ZoneCls; use: LotUse; rings: Rings; area: number; c: XY; edge: StreetCls; fac?: number };

// ---------- Алхам 1: хөтөлбөр ----------
export type ProgramIn = {
  pop: number; hhSize: number; m2pp: number; netRatio: number; floorsRes: number; bcrRes: number;
  resShare: number; pubShare: number; greenShare: number; engShare: number; farMaxRes?: number;
  comSplit: number; eduSplit: number; healthSplit: number;
};
export type Program = { hh: number; gfaRes: number; resNet: number; site: number; res: number; com: number; edu: number; health: number; green: number; eng: number };

export function program(i: ProgramIn, scale = 1): Program {
  const gfaRes = (i.pop * i.m2pp) / i.netRatio;
  // Багтаамж: давхар × BCR, гэхдээ FAR-ын нормоос хэтрэхгүй (блокийн дүрэмтэй ижил)
  const resNet = gfaRes / Math.min(i.floorsRes * (i.bcrRes / 100), i.farMaxRes ?? Infinity);
  // Орон сууцны бүс = цэвэр талбай / 0.8 (гудамж, цэцэрлэгийн lot) — ТААМАГЛАЛ, давталтаар засагдана
  const site = (resNet / 0.8 / (i.resShare / 100)) * scale;
  const pub = site * (i.pubShare / 100), sp = i.comSplit + i.eduSplit + i.healthSplit || 1;
  return {
    hh: i.pop / i.hhSize, gfaRes, resNet, site, res: site * (i.resShare / 100),
    com: (pub * i.comSplit) / sp, edu: (pub * i.eduSplit) / sp, health: (pub * i.healthSplit) / sp,
    green: site * (i.greenShare / 100), eng: site * (i.engShare / 100),
  };
}

// ---------- Алхам 1: талбай сонгох ----------
/** Эгц налуу (>max%) бүхий нүднүүдийг нэгтгэсэн полигон */
export function steepArea(dem: Dem, zone: Rings, maxSlope: number): Rings {
  const cells: Rings[] = [];
  const h = dem.cell / 2;
  for (let j = 0; j < dem.ny; j++) for (let i = 0; i < dem.nx; i++) {
    const x = dem.x0 + i * dem.cell, y = dem.y0 + j * dem.cell;
    if (!inside(x, y, zone) || slopeAt(dem, x, y) <= maxSlope) continue;
    cells.push([[[x - h, y - h], [x - h, y + h], [x + h, y + h], [x + h, y - h], [x - h, y - h]]]);
  }
  return cells.length ? bufPoly(bufPoly(unionAll(cells), dem.cell * 0.6), -dem.cell * 0.3) : [];
}

/** Үр — ЦС-д ойр (бүсийн доторх) эсвэл бүсийн төв */
export function seedOf(zone: Rings, anchor: XY | null): XY {
  const c = labelPt(zone);
  if (!anchor) return c;
  const n = nearest(zone, anchor);
  return add(n, mul(sub(c, n), 0.3));
}

/** Налуугийн эсрэг (хэвтээ шугам) чиглэл — талбайг хөндлөн биш, налуугийн дагуу сунгана */
function contourDir(dem: Dem, c: XY): XY {
  const h = dem.cell * 3;
  const gx = zAt(dem, c[0] + h, c[1]) - zAt(dem, c[0] - h, c[1]), gy = zAt(dem, c[0], c[1] + h) - zAt(dem, c[0], c[1] - h);
  return Math.hypot(gx, gy) < 0.5 ? [1, 0] : norm(perp([gx, gy]));
}

// Төлөвлөлтийн загварын горим: хэлбэр, тэнхлэгийн бүтэц нь горимоор өөрчлөгдөнө (алхмын дараалал ижил)
export type PlanMode = "organic" | "grid" | "ring" | "linear" | "terrain";
export const PLAN_MODES: { k: PlanMode; label: string; hint: string }[] = [
  { k: "organic", label: "Органик", hint: "Гадаргыг даган муруйсан тэнхлэг, чөлөөт хэлбэрийн талбай" },
  { k: "grid", label: "Сүлжээ", hint: "Тэгш өнцөгт талбай, налуугийн дагуу чиглэсэн шулуун гудамжны сүлжээ" },
  { k: "ring", label: "Цагираг-радиал", hint: "Дугуй талбай, төвөөс тарсан радиал ба хоёр цагираг зам" },
  { k: "terrain", label: "Газарт тулгуурласан (суперблок)", hint: "Хил нь гудамжны торын суперблокоор тодорхойлогдоно: эхлэх цэгээс налуугийн дагуу сунасан тэгш өнцөгтөөр тохиромжтой блокуудыг нэмнэ — тохиромжгүй газар, бүсийн хилээр огтлогдоно" },
  { k: "linear", label: "Шугаман", hint: "Сунасан талбай, нэг нуруу тэнхлэг ба хөндлөн хавирга гудамж. Нуруу урт тул бохирын өөрийн урсгал гүнзийрч, насос станц шаардаж болзошгүй" },
];
// Хэлбэр: rect = тэгш өнцөгт, e = суналтын харьцаа (налуугийн шугамын дагуу)
const SHAPE: Record<PlanMode, { rect: boolean; e: number }> = {
  organic: { rect: false, e: 1.35 }, grid: { rect: true, e: 1.3 }, ring: { rect: false, e: 1 }, linear: { rect: false, e: 2.8 },
  terrain: { rect: true, e: 1.5 }, // pickBlocks ашиглана; энэ нь нөөц
};

/** Суперблок (terrain горим): origin-оос налуугийн дагуу (u) чиглэсэн step/2 хэмжээний торны нүдийг нэмж need талбайд хүргэнэ.
 *  Эрэмбэ — налуугийн дагуу e дахин сунасан тэгш өнцөгт (Chebyshev) зай: тэгш газарт тэгш өнцөгт, хязгаарлалттай газарт огтлогдоно.
 *  Хоригоос гадуурх хэсэг нь minFrac-аас бага нүдийг алгасна. Торны шугам нь axes()-ийн grid гудамжтай давхцана.
 *  ТААМАГЛАЛ: e = 1.5 (гудамж, бохирын шугамыг налуугийн дагуу уртасгах), minFrac = 0.6. */
export function pickBlocks(zone: Rings, avoid: Rings, origin: XY, need: number, dem: Dem, step: number, e = 1.5, minFrac = 0.6): Rings {
  const avail = diff(zone, avoid);
  if (area(avail) <= need * 1.02) return avail;
  const u = contourDir(dem, origin), v = perp(u), h = Math.max(60, step / 2), full = h * h;
  const at = (i: number, j: number): XY => add(origin, add(mul(u, i * h), mul(v, j * h)));
  const rank = (i: number, j: number) => { const x = i + 0.5, y = j + 0.5; return Math.max(Math.abs(x) / e, Math.abs(y)) + Math.hypot(x / e, y) * 1e-3; };
  const seen = new Set<string>(), picked: Rings[] = [];
  let frontier: [number, number][] = [[-1, -1], [0, -1], [-1, 0], [0, 0]], total = 0;
  for (const [i, j] of frontier) seen.add(`${i},${j}`);
  for (let guard = 0; total < need && frontier.length && guard < 5000; guard++) {
    frontier.sort((a, b) => rank(...a) - rank(...b));
    const [i, j] = frontier.shift()!;
    const g = inter(avail, [[at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1), at(i, j)]]), a = area(g);
    if (a < full * minFrac) continue; // хориг, бүсийн хилээс гадуур — хөршүүдийг нь ч нэмэхгүй
    picked.push(g); total += a;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${i + di},${j + dj}`;
      if (!seen.has(k)) { seen.add(k); frontier.push([i + di, j + dj]); }
    }
  }
  return parts(unionAll(picked)).sort((a, b) => area(b) - area(a))[0] ?? [];
}

/** Бүсийн дотор үрээс эхлэн шаардлагатай талбайтай хэлбэр (горимын дагуу) ∩ бүс − эгц налуу */
export function pickSite(zone: Rings, avoid: Rings, seed: XY, need: number, dem: Dem, mode: PlanMode = "organic"): Rings {
  const avail = diff(zone, avoid);
  if (area(avail) <= need * 1.02) return avail;
  const u = contourDir(dem, seed), v = perp(u);
  const sh = SHAPE[mode] ?? SHAPE.organic;
  // Хамгийн том хэсэг: opening нь талбайг хэсэглэж болох тул гол биеийг л авна
  const biggest = (g: Rings): Rings => parts(g).sort((a, b) => area(b) - area(a))[0] ?? [];
  const shape = (r: number): Rings => {
    const e: XY[] = sh.rect
      ? orientedRect(seed, u, 2 * r * sh.e, (2 * r) / sh.e)
      : circle([0, 0], 1, 40).map(([x, y]) => add(seed, add(mul(u, x * r * sh.e), mul(v, (y * r) / sh.e))));
    const s = biggest(inter(avail, [e]));
    if (!s.length) return [];
    // Нарийн хэсгийг арилгаж ирмэгийг зөөлрүүлнэ (opening) — хоёртын хайлт эцсийн талбайг хэмжихийн тулд энд хийнэ
    const sm = biggest(bufPoly(bufPoly(s, -30), 30));
    return sm.length ? sm : s;
  };
  let lo = Math.sqrt(need / Math.PI) * 0.6, hi = Math.sqrt(need / Math.PI) * 4;
  let best: Rings = [];
  for (let k = 0; k < 16; k++) {
    const r = (lo + hi) / 2, s = shape(r), a = area(s);
    best = s;
    if (Math.abs(a - need) / need < 0.015) break;
    if (a < need) lo = r; else hi = r;
  }
  return best; // opening, хамгийн том хэсэг нь shape() дотор аль хэдийн хийгдсэн
}

// ---------- Алхам 2: тэнхлэг (A* — налуу багатай зам) ----------
class Heap {
  k: number[] = []; f: number[] = [];
  push(k: number, f: number) {
    this.k.push(k); this.f.push(f);
    let i = this.k.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (this.f[p] <= this.f[i]) break; this.sw(i, p); i = p; }
  }
  pop() {
    const top = this.k[0], lk = this.k.pop()!, lf = this.f.pop()!;
    if (this.k.length) {
      this.k[0] = lk; this.f[0] = lf;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < this.k.length && this.f[l] < this.f[m]) m = l;
        if (r < this.k.length && this.f[r] < this.f[m]) m = r;
        if (m === i) break; this.sw(i, m); i = m;
      }
    }
    return top;
  }
  sw(a: number, b: number) { [this.k[a], this.k[b]] = [this.k[b], this.k[a]]; [this.f[a], this.f[b]] = [this.f[b], this.f[a]]; }
  get size() { return this.k.length; }
}

export function maskOf(dem: Dem, r: Rings) {
  const m = new Uint8Array(dem.nx * dem.ny);
  const b = bbox(r);
  for (let j = 0; j < dem.ny; j++) for (let i = 0; i < dem.nx; i++) {
    const x = dem.x0 + i * dem.cell, y = dem.y0 + j * dem.cell;
    if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && inside(x, y, r)) m[j * dem.nx + i] = 1;
  }
  return m;
}

/** Тохиромжийн өртөг, налуу, хоригт тулгуурлана; боломжгүй трассыг шулуунаар нөхөхгүй. */
export function terrainPath(dem:Dem,mask:Uint8Array,a:XY,b:XY,costSurface?:Float64Array,maxGrade=8):Path {
 const result=routeTerrain(dem,mask,a,b,{maxGrade,costSurface,smooth:true,exactEndpoints:true});
 return result.status==='ok'?result.path:[];
}

/** Хилийн цэгүүдээс d чиглэлд хамгийн алсын цэг */
function farBoundary(site: Rings, c: XY, d: XY): XY {
  let best = c, bv = -Infinity;
  for (const r of site) for (const p of densify(r, 15)) { const v = dot(sub(p, c), d); if (v > bv) { bv = v; best = p; } }
  return best;
}

export type AxesIn = { arterialW: number; collectorW: number; ringOn: boolean; radials: number; mode: PlanMode; gridStep: number;maxGrade?:Partial<Record<StreetCls,number>> };
export function axes(site: Rings, center: XY, entry: XY | null, dem: Dem, p: AxesIn, costSurface?:Float64Array) {
  const mask = maskOf(dem, bufPoly(site, dem.cell * 2));
  if(costSurface)for(let k=0;k<mask.length;k++)if(!Number.isFinite(costSurface[k]))mask[k]=0;
  const A = area(site), R = Math.sqrt(A / Math.PI);
  let E = entry ?? farBoundary(site, center, [-1, 0]);
  const d = norm(sub(center, E));
  const X = farBoundary(site, center, d);
  const streets: Street[] = [];
  let id = 1;
  const clipIn = (path: Path) => clipPath([path], bufPoly(site, -2)).filter((q) => pathLength(q) > 30);
  // Байгаа гудамжтай нэг тэнхлэгээр давхцсан эхлэл/төгсгөлийг тайрна (радиал нь магистралийн эхний хэсгийг давхар зурахгүй):
  // салаалах цэгээс эхэлнэ. Давхар зам санхүү, хөдөлгөөн, гудамжны загварт хоёр удаа тоологддог байсан.
  const onExisting = (pt: XY) => streets.some((s) => { for (let i = 1; i < s.path.length; i++) { const a = s.path[i - 1], b = s.path[i], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy; if (!l2) continue; const t = Math.max(0, Math.min(1, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / l2)); if (Math.hypot(pt[0] - a[0] - t * dx, pt[1] - a[1] - t * dy) < 1) return true; } return false; });
  const trimShared = (q: Path): Path => { const dense: Path = []; for (let i = 1; i < q.length; i++) { const a = q[i - 1], b = q[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 5)); for (let k = 0; k < n; k++) dense.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); } dense.push(q[q.length - 1]);
    let i0 = 0; while (i0 < dense.length - 1 && onExisting(dense[i0 + 1])) i0++;
    let i1 = dense.length - 1; while (i1 > i0 && onExisting(dense[i1 - 1])) i1--;
    if (i0 === 0 && i1 === dense.length - 1) return q;
    // Тайрсан хэсгийн оронд эх оройнуудыг хадгална (5 м-ийн нягтралыг зөвхөн шалгалтад).
    const at = (pt: XY) => { let best = 0, bd = Infinity; q.forEach((v, k) => { const d = Math.hypot(v[0] - pt[0], v[1] - pt[1]); if (d < bd) { bd = d; best = k; } }); return best; };
    const k0 = at(dense[i0]), k1 = at(dense[i1]);
    return [dense[i0], ...q.slice(k0 + 1, k1).filter((v) => Math.hypot(v[0] - dense[i0][0], v[1] - dense[i0][1]) > .5 && Math.hypot(v[0] - dense[i1][0], v[1] - dense[i1][1]) > .5), dense[i1]];
  };
  const addS = (cls: StreetCls, path: Path, w: number) => { for (const q0 of clipIn(path)) {const q = trimShared(q0);if (pathLength(q) <= 30) continue;if(!Number.isFinite(routePathMetrics(dem,mask,q,{maxGrade:p.maxGrade?.[cls]??8,costSurface}).cost))continue;streets.push({ id: id++, cls, path: q, w });} };
  const mode: PlanMode = p.mode ?? "organic";
  const stepG = Math.max(120, p.gridStep || 240);
  const ringAt = (f: number) => {
    const inner = parts(bufPoly(site, -R * f)).sort((a, b) => area(b) - area(a))[0];
    if (!inner || area(inner) < A * 0.08) return;
    const ring = smooth(densify(inner[0], 25), 2);
    addS("collector", [...ring, ring[0]], p.collectorW);
  };

  if (mode === "grid" || mode === "terrain") {
    // Сүлжээ: налуугийн шугамын дагуу хоёр багц шулуун гудамж; гурав дахь нь магистраль.
    // terrain: center = pickBlocks-ийн origin тул гудамж суперблокийн хилтэй давхцана
    const u = contourDir(dem, center), v = perp(u);
    const half = R * 1.6 + stepG;
    const nk = Math.ceil(half / stepG);
    for (const [dir, off] of [[u, v], [v, u]] as [XY, XY][]) {
      for (let k = -nk; k <= nk; k++) {
        const art = k === 0; // зөвхөн төвийн тэнхлэг магистраль, бусад нь цуглуулах
        addS(art ? "arterial" : "collector", lineThrough(add(center, mul(off, k * stepG)), dir, R * 2 + 600),
          art ? p.arterialW : p.collectorW);
      }
    }
    if (mode === "terrain") {
      // Орох цэгийг торын гол тэнхлэг (k = 0) хилтэй огтлолцох 4 цэгээс одоогийн замд хамгийн ойрыг сонгоно —
      // диагональ магистраль блокуудыг огтолж гурвалжин үүсгэхгүй; гаднах холбох зам (ext) энэ цэгт ирнэ
      const exits = [u, mul(u, -1), v, mul(v, -1)].map((dd) => { const q = clipPath([[center, add(center, mul(dd, 5000))]], site)[0]; return q?.[q.length - 1]; })
        .filter((q): q is XY => !!q);
      if (exits.length) E = exits.sort((a, b) => dist(a, E) - dist(b, E))[0];
    } else {
      // Орох зам: одоо байгаа замаас төв хүртэл гадаргыг даган
      addS("arterial", terrainPath(dem,mask,E,center,costSurface,p.maxGrade?.arterial??8), p.arterialW);
    }
  } else if (mode === "linear") {
    // Шугаман: нэг нуруу тэнхлэг, түүний дагуу хөндлөн хавирга гудамж
    const spine = [...terrainPath(dem,mask,E,center,costSurface,p.maxGrade?.arterial??8), ...terrainPath(dem,mask,center,X,costSurface,p.maxGrade?.arterial??8).slice(1)];
    addS("arterial", spine, p.arterialW);
    const L = pathLength(spine);
    const dense = densify(spine, 10);
    let acc = 0;
    for (let i = 1; i < dense.length; i++) {
      acc += dist(dense[i - 1], dense[i]);
      if (acc < stepG) continue;
      acc = 0;
      const t = norm(sub(dense[i], dense[i - 1]));
      addS("collector", lineThrough(dense[i], perp(t), R * 2 + 400), p.collectorW);
    }
    // Нурууны хоёр талд зэрэгцээ цуглуулах зам
    if (L > 600) for (const s of [-1, 1]) {
      addS("collector", dense.map((q) => add(q, mul(perp(norm(sub(X, E))), s * stepG * 1.4))), p.collectorW);
    }
  } else {
    // Органик ба цагираг-радиал: төвөөс гарсан радиал тэнхлэгүүд
    const pd = perp(d);
    const big = 2 * R > 1600;
    const nRad = mode === "ring" ? Math.max(6, p.radials) : Math.max(2, p.radials);
    const dirs: XY[] = mode === "ring"
      ? Array.from({ length: nRad }, (_, k) => {
        const a = (2 * Math.PI * k) / nRad;
        return norm(add(mul(d, Math.cos(a)), mul(pd, Math.sin(a))));
      })
      : [pd, mul(pd, -1), norm(add(d, pd)), norm(sub(pd, d)), norm(sub(mul(pd, -1), d)), norm(add(mul(pd, -1), d))];
    if (mode !== "ring") addS("arterial", [...terrainPath(dem,mask,E,center,costSurface,p.maxGrade?.arterial??8), ...terrainPath(dem,mask,center,X,costSurface,p.maxGrade?.arterial??8).slice(1)], p.arterialW);
    else addS("arterial", terrainPath(dem,mask,E,center,costSurface,p.maxGrade?.arterial??8), p.arterialW);
    dirs.slice(0, nRad).forEach((dir, k) => {
      const B = farBoundary(site, center, dir);
      if (dist(B, center) < 120) return;
      const art = big && k < 2 && mode !== "ring";
      addS(art ? "arterial" : "collector", terrainPath(dem,mask,center,B,costSurface,p.maxGrade?.[art?'arterial':'collector']??8), art ? p.arterialW : p.collectorW);
    });
    if (mode === "ring" && A > 20e4) { ringAt(0.62); ringAt(0.3); }
    else if (p.ringOn && A > 40e4) ringAt(0.42);
  }
  return { streets, E, X };
}

// ---------- Алхам 3: бүсчлэл ----------
/** Хойд, баруун хойд зүгийн хилээр салхи хаалтын зурвас (гадна нормаль N/NW) */
export function windbreak(site: Rings, w: number): Rings {
  if (w <= 0) return [];
  const paths: Path[] = [];
  const dirs: XY[] = [[0, 1], [-0.7071, 0.7071]];
  for (const r of site) {
    let s = 0;
    for (let i = 0; i + 1 < r.length; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
    if (s > 0) continue; // нүх (цагийн зүүний эсрэг)
    let cur: Path = [];
    for (let i = 0; i + 1 < r.length; i++) {
      const e = sub(r[i + 1], r[i]), n = norm([-e[1], e[0]]);
      if (dirs.some((dd) => dot(n, dd) > 0.55)) { if (!cur.length) cur.push(r[i]); cur.push(r[i + 1]); }
      else if (cur.length) { paths.push(cur); cur = []; }
    }
    if (cur.length) paths.push(cur);
  }
  return inter(bufPath(paths.filter((q) => pathLength(q) > 60), w), site);
}

/** Полигоноос anchor талын хэсгийг need талбайтайгаар хөвчөөр тасална */
export function takeFrom(r: Rings, anchor: XY, need: number): { piece: Rings; rest: Rings; chord: Path | null } {
  const A = area(r);
  if (A <= need * 1.15) return { piece: r, rest: [], chord: null };
  const c = labelPt(r);
  const a0 = dist(anchor, c) < 1 ? [1, 0] as XY : norm(sub(anchor, c));
  // Огтлолыг хэсгийн OBB тэнхлэгт (anchor-ийн чиглэлд ойр нь) тааруулна — хөвч гудамж блокийн ирмэгтэй зэрэгцэж,
  // налуу гудамж, гурвалжин блок үүсэхгүй
  const ob = obb(r), au = dot(a0, ob.u), av = dot(a0, ob.v);
  const d: XY = Math.abs(au) >= Math.abs(av) ? mul(ob.u, Math.sign(au) || 1) : mul(ob.v, Math.sign(av) || 1);
  let s0 = Infinity, s1 = -Infinity;
  for (const ring of r) for (const p of ring) { const s = dot(sub(p, c), d); s0 = Math.min(s0, s); s1 = Math.max(s1, s); }
  let lo = s0, hi = s1, best: { piece: Rings; rest: Rings; chord: Path | null } = { piece: r, rest: [], chord: null };
  for (let k = 0; k < 14; k++) {
    const s = (lo + hi) / 2;
    const line = lineThrough(add(c, mul(d, s)), perp(d), 30000);
    const ps = cut(r, line);
    if (ps.length < 2) { hi = s; continue; }
    const near = ps.filter((q) => dot(sub(labelPt(q), c), d) > s), far = ps.filter((q) => dot(sub(labelPt(q), c), d) <= s);
    const piece = unionAll(near), a = area(piece);
    best = { piece, rest: unionAll(far), chord: line };
    if (Math.abs(a - need) / need < 0.04) break;
    if (a > need) lo = s; else hi = s;
  }
  return best;
}

// parkSpread (м): ногоон байгууламжийг нэг том паркийн оронд энэ алхамтай торын цэг бүрт хорооллын парк болгон тараана
export type ZoningIn = { windbreak: number; sanitary: { rings: Rings; m: number }[]; localW: number; parkFirst?: boolean; parkSpread?: number };
/** centers[0] — гол төв; олон төвт/дагуул загварт нийтийн үйлчилгээ төв бүрт тэнцүү хуваагдана */
export type ZoneAnchors = { centers: XY[]; park: XY; eng: XY };

export function zoning(site: Rings, streets: Street[], prog: Program, anchors: ZoneAnchors, p: ZoningIn) {
  const axisU = bufMany(streets.map((s) => ({ paths: [s.path], d: s.w / 2 })));
  let protect = windbreak(site, p.windbreak);
  for (const s of p.sanitary) protect = unionAll([protect, inter(bufPoly(s.rings, s.m), site)]);
  protect = diff(protect, axisU);
  let free = parts(diff(diff(site, axisU), protect)).filter((q) => area(q) > 2500);
  const zones: ZonePiece[] = [];
  const chords: Path[] = [];
  let id = 1;
  for (const q of parts(protect)) if (area(q) > 1500) zones.push({ id: id++, cls: "protect", rings: q, area: area(q) });
  const protectA = zones.reduce((s, z) => s + z.area, 0);
  const C = anchors.centers.length ? anchors.centers : [anchors.park];
  const pub: [ZoneCls, number, XY][] = (["com", "edu", "health"] as const).flatMap((cls) => C.map((c) => [cls, prog[cls] / C.length, c] as [ZoneCls, number, XY]));
  // Ногоон байгууламж: parkSpread-ийн тороор хорооллын паркууд (хүртээмж ≈ parkSpread/2) — нэг том парк зүүн/нэг талд
  // бөөгнөрч, барилгажилт нөгөө талд нягтрахаас сэргийлнэ. Цэцэрлэгт хот (parkFirst) — нэг төв цэцэрлэгт хүрээлэн.
  const parkNeed = Math.max(0, prog.green - protectA);
  const sb = bbox(site), sp = p.parkSpread ?? 0;
  const grid: XY[] = [];
  if (sp > 0 && !p.parkFirst) for (let x = sb.x0 + sp / 2; x < sb.x1; x += sp) for (let y = sb.y0 + sp / 2; y < sb.y1; y += sp) if (inside(x, y, site)) grid.push([x, y]);
  const parkAnchors = grid.length > 1 && parkNeed / grid.length > 3000 ? grid : [anchors.park];
  const parks = parkAnchors.map((a): [ZoneCls, number, XY] => ["park", parkNeed / parkAnchors.length, a]);
  // Цэцэрлэгт хот: төвийн цэцэрлэгт хүрээлэнг эхэлж, үйлчилгээ түүнийг хүрээлнэ
  const plan: [ZoneCls, number, XY][] = p.parkFirst ? [...parks, ...pub, ["eng", prog.eng, anchors.eng]] : [...pub, ...parks, ["eng", prog.eng, anchors.eng]];
  for (const [cls, total, anchor] of plan) {
    let need = total;
    while (need > 1500 && free.length) {
      free.sort((a, b) => dist(labelPt(a), anchor) - dist(labelPt(b), anchor));
      const sb = free.shift()!;
      const t = takeFrom(sb, anchor, need);
      for (const q of parts(t.piece)) { const a = area(q); zones.push({ id: id++, cls, rings: q, area: a }); need -= a; }
      if (t.chord) chords.push(...clipPath([t.chord], sb));
      free.push(...parts(t.rest).filter((q) => area(q) > 2500));
    }
  }
  for (const q of free) zones.push({ id: id++, cls: "res", rings: q, area: area(q) });
  // Бүс хоорондын хөвч дээр орон нутгийн гудамж
  const chordStreets: Street[] = chords.filter((c) => pathLength(c) > 40).map((c, k) => ({ id: 1000 + k, cls: "local", path: c, w: p.localW }));
  if (chordStreets.length) {
    const cu = bufMany(chordStreets.map((s) => ({ paths: [s.path], d: s.w / 2 })));
    for (const z of zones) { z.rings = diff(z.rings, cu); z.area = area(z.rings); }
  }
  return { zones: zones.filter((z) => z.area > 800), chordStreets, protect };
}

// ---------- Алхам 4: блок хуваалт (recursive OBB subdivision) ----------
export type SubdivIn = {
  localW: number; resBlock: number; comBlock: number; schoolLot: number; clinicLot: number; kinderLot: number; minW: number;
  rKinder: number; rPark: number;
};

function recurse(r: Rings, target: number, minW: number, rnd: () => number, cuts: Path[], out: Rings[], depth = 0) {
  const A = area(r), o = obb(r);
  if (depth > 12 || A <= target * 1.35 || o.wid < minW * 0.9 || o.len < 2 * minW) { out.push(r); return; }
  const shift = (rnd() - 0.5) * 0.2 * o.len;
  const line = lineThrough(add(o.c, mul(o.u, shift)), o.v, 5000);
  const ps = cut(r, line);
  if (ps.length < 2) { out.push(r); return; }
  cuts.push(...clipPath([line], r));
  for (const q of ps) recurse(q, target, minW, rnd, cuts, out, depth + 1);
}

export function subdivide(zones: ZonePiece[], streets: Street[], p: SubdivIn) {
  const rnd = rng(11);
  const local: Street[] = [];
  const walkCuts: Path[] = [];
  const raw: { rings: Rings; zone: ZoneCls; fac?: number }[] = [];
  let sid = 2000;
  for (const z of zones) {
    if (z.cls === "res" || z.cls === "com") {
      const cuts: Path[] = [], out: Rings[] = [];
      recurse(z.rings, z.cls === "res" ? p.resBlock : p.comBlock, p.minW, rnd, cuts, out);
      for (const c of cuts) if (pathLength(c) > 25) local.push({ id: sid++, cls: "local", path: c, w: p.localW });
      const cu = bufMany(cuts.map((c) => ({ paths: [c], d: p.localW / 2 })));
      for (const q of out) for (const b of parts(diff(q, cu))) raw.push({ rings: b, zone: z.cls });
    } else if (z.cls === "edu" || z.cls === "health" || z.cls === "eng") {
      const target = z.cls === "edu" ? p.schoolLot : z.cls === "health" ? p.clinicLot : Math.max(4000, z.area / 4);
      const cuts: Path[] = [], out: Rings[] = [];
      recurse(z.rings, target, 40, rnd, cuts, out);
      walkCuts.push(...cuts);
      const cu = bufMany(cuts.map((c) => ({ paths: [c], d: 3 })));
      out.forEach((q, k) => { for (const b of parts(diff(q, cu))) raw.push({ rings: b, zone: z.cls, fac: k }); });
    } else raw.push({ rings: z.rings, zone: z.cls });
  }
  const arterialZ = bufMany(streets.filter((s) => s.cls === "arterial").map((s) => ({ paths: [s.path], d: s.w / 2 + 20 })));
  const collectorZ = bufMany(streets.filter((s) => s.cls === "collector").map((s) => ({ paths: [s.path], d: s.w / 2 + 20 })));
  const useOf: Record<ZoneCls, LotUse> = { res: "res", com: "com", edu: "school", health: "clinic", park: "park", protect: "protect", eng: "eng" };
  const lots: Lot[] = raw.filter((q) => area(q.rings) > 600).map((q, k) => ({
    id: k + 1, zone: q.zone, use: useOf[q.zone], rings: q.rings, area: area(q.rings), c: labelPt(q.rings), fac: q.fac,
    edge: inter(q.rings, arterialZ).length ? "arterial" : inter(q.rings, collectorZ).length ? "collector" : "local",
  }));
  // Цэцэрлэг: орон сууцны блокоос радиусаар хамруулж, блокийн нэг хэсгийг lot болгоно
  const res = lots.filter((l) => l.use === "res");
  let left = [...res];
  let next = lots.length + 1;
  while (left.length) {
    let best: Lot | null = null, bn = 0;
    for (const c of res) {
      if (c.area < p.kinderLot * 2.2) continue;
      const n = left.filter((t) => dist(t.c, c.c) <= p.rKinder).length;
      if (n > bn) { bn = n; best = c; }
    }
    if (!best) break;
    const b = best;
    const o = obb(b.rings);
    const t = takeFrom(b.rings, add(o.c, mul(o.u, o.len)), p.kinderLot);
    const kp = parts(t.piece)[0];
    if (kp) {
      lots.push({ id: next++, zone: "res", use: "kinder", rings: kp, area: area(kp), c: labelPt(kp), edge: b.edge });
      b.rings = t.rest; b.area = area(t.rest); b.c = labelPt(t.rest);
      if (t.chord) walkCuts.push(...clipPath([t.chord], unionAll([kp, t.rest])));
    }
    res.splice(res.indexOf(b), 1);
    left = left.filter((q) => dist(q.c, b.c) > p.rKinder);
  }
  // Хорооллын парк (Pocket_Park.cga): ≤rPark зайд ≥0.5 га ногоон байхгүй орон сууцны блокийг хамруулна
  const reach = (l: Lot, c: XY) => dist(l.c, c) <= p.rPark + Math.sqrt(l.area) / 2;
  const parkOk = (c: XY) => lots.some((l) => l.use === "park" && l.area >= 5000 && reach(l, c));
  let need = lots.filter((l) => l.use === "res" && !parkOk(l.c));
  while (need.length) {
    let best: Lot | null = null, bn = 0;
    for (const c of lots) {
      if (c.use !== "res" || c.area < 5000) continue;
      const n = need.filter((t) => reach(c, t.c)).length;
      if (n > bn) { bn = n; best = c; }
    }
    if (!best) break;
    best.use = "park"; best.zone = "park";
    const b = best;
    need = need.filter((t) => t !== b && !reach(b, t.c));
  }
  return { lots: lots.filter((l) => l.area > 600), local, walkCuts };
}
