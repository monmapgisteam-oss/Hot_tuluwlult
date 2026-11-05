// Полигоноос тохиромжийн бэлтгэл өгөгдөл гаргана (Бөөрөлжүүтийн urbanSuit.ts prepare()-ийн дурын газрын хувилбар).
// Оноолт нь клиентэд хийгддэг тул жин, хориг солигдоход дахин татахгүй.
import proj4 from "proj4";
import { FACTORS, LANDCOVER, type Prepared, type SourceStatus, type ZoneInfo } from "../suit.ts";
import {
  MAX_CELLS, SegIndex, chooseCell, chooseFineCell, flowAccumulation, inPoly, medianInCell, paddingFor, reliefAt, slopeAspect, toPoly, tpiAt,
  type Poly, type Seg, type XY,
} from "./grid.ts";
import { sampleDem, sampleLandcover, type BBox } from "./rasters.ts";
import {
  PAVED_WHERE, SERVICE_EXTENT, SERVICE_URL, ZONE_SERVICE_URL, fetchFeatures, intersects, loadCenters, loadInfra, loadSoums,
  toSegs, within, type InfraKind,
} from "./vectors.ts";

export const MAX_AREA_KM2 = 50000;
/** Сонгосон аймаг, сум: хамгийн том аймаг ~165 мянган км² */
const MAX_ADMIN_KM2 = 200000;
const MAX_VERTICES = 5000;
/** Дэд бүтцийн зайг хайх радиус, м — онооны муруйн төгсгөлөөс том */
const INFRA_RADIUS = 20000;
const CENTER_RADIUS = 80000;
const SVC_NAME = "Бөөрөлжүүт FeatureServer", OSM_NAME = "OpenStreetMap";

export class InputError extends Error {}

/** Хүсэлтийг шалгана: GeoJSON Polygon coordinates, lon/lat */
export function parseRings(v: unknown): XY[][] {
  if (!Array.isArray(v) || !v.length) throw new InputError("Полигон хоосон байна.");
  let total = 0;
  const rings = v.map((r) => {
    if (!Array.isArray(r) || r.length < 4) throw new InputError("Полигон дор хаяж 3 оройтой байх ёстой.");
    total += r.length;
    return r.map((p) => {
      if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 84) {
        throw new InputError("Полигоны координат буруу байна.");
      }
      return [p[0], p[1]] as XY;
    });
  });
  if (total > MAX_VERTICES) throw new InputError(`Полигон хэт олон оройтой (${total} > ${MAX_VERTICES}).`);
  return rings;
}

const bboxOf = (lon: ArrayLike<number>, lat: ArrayLike<number>): BBox => {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (let k = 0; k < lon.length; k++) {
    if (lon[k] < w) w = lon[k]; if (lon[k] > e) e = lon[k];
    if (lat[k] < s) s = lat[k]; if (lat[k] > n) n = lat[k];
  }
  return { w, s, e, n };
};
const degPad = (b: BBox, m: number): BBox => {
  const dLat = m / 111320, dLon = m / (111320 * Math.cos((((b.s + b.n) / 2) * Math.PI) / 180));
  return { w: b.w - dLon, s: b.s - dLat, e: b.e + dLon, n: b.n + dLat };
};
const round = (a: ArrayLike<number>, d: number) => {
  const f = 10 ** d;
  return Array.from(a, (v) => (Number.isFinite(v) ? Math.round(v * f) / f : NaN));
};

export async function prepare(input: { rings: XY[][]; cell?: number; admin?: { anchor: { name: string; lonLat: [number, number] } | null } }, step: (s: string) => void = () => {}): Promise<Prepared> {
  const lonLat = input.rings;
  // Олон хэсэгтэй сум, аймагт бүх цагирагийн хүрээний төв
  const allPts = lonLat.flat();
  const lon0 = (Math.min(...allPts.map((p) => p[0])) + Math.max(...allPts.map((p) => p[0]))) / 2;
  const lat0 = (Math.min(...allPts.map((p) => p[1])) + Math.max(...allPts.map((p) => p[1]))) / 2;
  // Монгол улс 45–51-р UTM бүсэд хуваагдана — полигоны төвийн бүсийг сонгож метрээр тооцно
  const utmZone = Math.max(1, Math.min(60, Math.floor((lon0 + 180) / 6) + 1));
  const epsg = (lat0 >= 0 ? 32600 : 32700) + utmZone;
  const tr = proj4(`+proj=utm +zone=${utmZone}${lat0 < 0 ? " +south" : ""} +datum=WGS84 +units=m +no_defs`);
  const rings = lonLat.map((r) => r.map((p) => tr.forward(p) as XY));
  const poly = toPoly(rings);
  // Нүх нь эсрэг чиглэлтэй тул тэмдэгтэй нийлбэр олон хэсэгтэй полигонд ч зөв
  const signed = (r: XY[]) => r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
  const areaM2 = Math.abs(rings.reduce((s, r) => s + signed(r), 0));
  const maxKm2 = input.admin ? MAX_ADMIN_KM2 : MAX_AREA_KM2;
  if (areaM2 > maxKm2 * 1e6) throw new InputError(`Полигон хэт том: ${Math.round(areaM2 / 1e6).toLocaleString("en-US")} км² (дээд хязгаар ${maxKm2.toLocaleString("en-US")} км²).`);
  if (areaM2 < 1) throw new InputError("Полигоны талбай тэг байна.");

  const warnings: string[] = [];
  const cell = chooseCell(areaM2, poly.xmax - poly.xmin, poly.ymax - poly.ymin, input.cell);
  if (input.cell && cell !== input.cell) warnings.push(`${input.cell} м нүд энэ хэмжээний полигонд хэт олон тул ${cell} м ашиглав.`);
  const pad = paddingFor(cell);

  // Тооцооны тор: полигон + зурвас (TPI, урсац зурвасыг ашиглана). Нүдний төв полигон дотор бол шинжилгээнд орно.
  const x0 = Math.floor((poly.xmin - pad) / cell) * cell, y0 = Math.floor((poly.ymin - pad) / cell) * cell;
  const nx = Math.ceil((poly.xmax + pad - x0) / cell), ny = Math.ceil((poly.ymax + pad - y0) / cell);
  const N = nx * ny;
  const inner: number[] = [];
  for (let j = 0; j < ny; j++) {
    const cy = y0 + (j + 0.5) * cell;
    if (cy < poly.ymin || cy > poly.ymax) continue;
    for (let i = 0; i < nx; i++) if (inPoly(x0 + (i + 0.5) * cell, cy, poly)) inner.push(j * nx + i);
  }
  const n = inner.length;
  if (!n) throw new InputError(`Полигон хэт жижиг: ${cell} м нүдний төв нэг ч багтсангүй.`);
  if (n > MAX_CELLS * 1.2) warnings.push(`Нүдний тоо их (${n}), газрын зураг удаашрах магадлалтай.`);
  const x = Float64Array.from(inner, (k) => x0 + ((k % nx) + 0.5) * cell);
  const y = Float64Array.from(inner, (k) => y0 + (Math.floor(k / nx) + 0.5) * cell);

  step(`Өндрийн загвар уншиж байна (${cell} м нүд, ${n.toLocaleString("en-US")} нүд)…`);
  const gLon = new Float64Array(N), gLat = new Float64Array(N);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const [a, b] = tr.inverse([x0 + (i + 0.5) * cell, y0 + (j + 0.5) * cell]);
    gLon[j * nx + i] = a; gLat[j * nx + i] = b;
  }
  const gridBox = bboxOf(gLon, gLat);
  const z = await sampleDem(gLon, gLat, gridBox, cell);
  const lon = Float64Array.from(inner, (k) => gLon[k]), lat = Float64Array.from(inner, (k) => gLat[k]);
  const boxInner = bboxOf(lon, lat);

  step("Налуу, зүг, урсацын хуримтлал тооцож байна…");
  // Том нүдэд налуу, урсацыг нарийн торонд тооцож нүдний медианаар авна — эс бөгөөс цөөн нүд л 500 га-н хоригийг давна
  const fine = chooseFineCell(cell, poly.xmax - poly.xmin, poly.ymax - poly.ymin);
  let fnx = nx, fny = ny, fx0 = x0, fy0 = y0, fz: ArrayLike<number> = z;
  if (fine !== cell) {
    fx0 = Math.floor((poly.xmin - pad) / fine) * fine; fy0 = Math.floor((poly.ymin - pad) / fine) * fine;
    fnx = Math.ceil((poly.xmax + pad - fx0) / fine); fny = Math.ceil((poly.ymax + pad - fy0) / fine);
    const fLon = new Float64Array(fnx * fny), fLat = new Float64Array(fnx * fny);
    for (let j = 0; j < fny; j++) for (let i = 0; i < fnx; i++) {
      const [a, b] = tr.inverse([fx0 + (i + 0.5) * fine, fy0 + (j + 0.5) * fine]);
      fLon[j * fnx + i] = a; fLat[j * fnx + i] = b;
    }
    fz = await sampleDem(fLon, fLat, bboxOf(fLon, fLat), fine);
  }
  const flowAll = flowAccumulation(fz, fnx, fny, fine);
  let slopeFine: Float64Array | null = null;
  if (fine !== cell) {
    slopeFine = new Float64Array(fnx * fny);
    for (let j = 0; j < fny; j++) for (let i = 0; i < fnx; i++) slopeFine[j * fnx + i] = slopeAspect(fz, fnx, fny, fine, i, j).slope;
  }
  const tpiHalf = Math.max(3, Math.round(300 / cell));
  const reliefHalf = Math.max(3, Math.round(1000 / cell));
  const relief = new Float64Array(n);
  const slope = new Float64Array(n), aspect = new Float64Array(n), tpi = new Float64Array(n), flow = new Float64Array(n), elevM = new Float64Array(n);
  let lo = Infinity, hi = -Infinity, demMissing = 0;
  for (let c = 0; c < n; c++) {
    const k = inner[c], i = k % nx, j = Math.floor(k / nx);
    const sa = slopeAspect(z, nx, ny, cell, i, j);
    slope[c] = slopeFine ? medianInCell(slopeFine, fnx, fny, fx0, fy0, fine, x[c], y[c], cell) : sa.slope;
    aspect[c] = sa.aspect; elevM[c] = z[k];
    if (Number.isFinite(z[k])) {
      tpi[c] = tpiAt(z, nx, ny, i, j, tpiHalf);
      relief[c] = reliefAt(z, nx, ny, i, j, reliefHalf);
      flow[c] = fine !== cell ? medianInCell(flowAll, fnx, fny, fx0, fy0, fine, x[c], y[c], cell) : flowAll[k];
      lo = Math.min(lo, z[k]); hi = Math.max(hi, z[k]);
    } else { tpi[c] = NaN; flow[c] = NaN; relief[c] = NaN; demMissing++; }
  }
  if (demMissing === n) throw new Error("Энэ газарт өндрийн мэдээлэл олдсонгүй (Copernicus GLO-30).");
  if (demMissing) warnings.push(`${demMissing} нүдэд өндрийн мэдээлэл байхгүй.`);
  const elev = elevM.map((v) => (Number.isFinite(v) ? (hi > lo ? ((v - lo) / (hi - lo)) * 100 : 50) : NaN));
  const demSource = "Copernicus DEM GLO-30";
  const sources: Record<string, SourceStatus> = {};
  for (const key of ["slope", "aspect", "elev", "tpi", "flow"]) sources[key] = { status: "loaded", source: demSource };
  sources.flow.note = `Ус хураах талбайг полигоноос ${(pad / 1000).toFixed(0)} км-ийн хүрээнд тооцсон; том голын сав газар дутуу.`;
  if (fine !== cell) {
    const note = `${fine} м торонд тооцож ${cell} м нүдний медианаар авсан; нүдний дотор гарах нарийн гуу жалга хоригт орохгүй.`;
    sources.flow.note += ` ${note}`;
    sources.slope.note = note;
  }

  const num: Record<string, ArrayLike<number>> = { slope: round(slope, 2), aspect: round(aspect, 0), elevM: round(elevM, 1), elev: round(elev, 1), tpi: round(tpi, 2), flow: round(flow, 1), relief: round(relief, 0) };
  const cat: Prepared["cat"] = {};

  step("Газрын бүрхэвч (ESA WorldCover) уншиж байна…");
  try {
    const codes = await sampleLandcover(lon, lat, degPad(boxInner, cell), cell);
    const dict = Object.values(LANDCOVER), byCode = new Map(Object.entries(LANDCOVER).map(([k, v]) => [Number(k), dict.indexOf(v)]));
    const idx = Array.from(codes, (c) => byCode.get(c) ?? -1);
    cat.landcover = { dict, idx };
    sources.landcover = { status: idx.some((v) => v >= 0) ? "loaded" : "missing", source: "ESA WorldCover 2021 v200" };
  } catch (e) {
    sources.landcover = { status: "missing", source: "ESA WorldCover 2021 v200", note: (e as Error).message };
    warnings.push("Газрын бүрхэвч татагдсангүй: ус, намаг, цасны хориг ажиллахгүй, нуур дээр өндөр оноо гарч болно.");
  }

  // ---------- Дэд бүтэц: сервис ба OSM-ийг нэгтгэж хамгийн ойрын зайг авна ----------
  step("Зам, төмөр зам, цахилгааны шугам хүртэлх зай тооцож байна…");
  const infraBox = degPad(boxInner, INFRA_RADIUS);
  const inService = intersects(infraBox, SERVICE_EXTENT), fullyInService = within(infraBox, SERVICE_EXTENT);
  const [osm, svcRoad, svcRail, svcRail2, svcTl] = await Promise.allSettled([
    loadInfra(infraBox),
    inService ? fetchFeatures(SERVICE_URL, 25, infraBox, epsg, { where: PAVED_WHERE, fields: "roadtype" }) : Promise.resolve([]),
    inService ? fetchFeatures(SERVICE_URL, 26, infraBox, epsg) : Promise.resolve([]),
    inService ? fetchFeatures(ZONE_SERVICE_URL, 0, infraBox, epsg) : Promise.resolve([]),
    inService ? fetchFeatures(SERVICE_URL, 24, infraBox, epsg) : Promise.resolve([]),
  ]);
  const osmSegs = (kind: InfraKind): Seg[] => {
    if (osm.status !== "fulfilled") return [];
    const segs: Seg[] = [];
    for (const line of osm.value[kind]) {
      let prev = tr.forward(line[0]);
      for (let i = 1; i < line.length; i++) {
        const cur = tr.forward(line[i]);
        segs.push([prev[0], prev[1], cur[0], cur[1]]);
        prev = cur;
      }
    }
    return segs;
  };
  const infra = {
    road: [svcRoad],
    rail: [svcRail, svcRail2],
    tl: [svcTl],
  } as const;
  for (const key of ["road", "rail", "tl"] as const) {
    const svc = infra[key].filter((r) => r.status === "fulfilled").flatMap((r) => toSegs((r as PromiseFulfilledResult<Awaited<ReturnType<typeof fetchFeatures>>>).value));
    const svcOk = inService && infra[key].every((r) => r.status === "fulfilled");
    const osmOk = osm.status === "fulfilled";
    const names = [...(svcOk ? [SVC_NAME] : []), ...(osmOk ? [OSM_NAME] : [])].join(" + ") || OSM_NAME;
    if (!osmOk && !svcOk) {
      sources[key] = { status: "missing", source: names, note: "Эх сурвалж татагдсангүй." };
      continue;
    }
    sources[key] = osmOk || fullyInService
      ? { status: "loaded", source: names }
      : { status: "partial", source: names, note: "OSM татагдсангүй: сервисийн хүрээнээс гадуурх шугамыг тооцоогүй." };
    if (osmOk) sources[key].note = "OSM бүрэн бус байж болзошгүй. Зай нь шулуун; 20 км-ээс цааш 20 км гэж тооцсон.";
    const si = new SegIndex([...svc, ...osmSegs(key)]);
    num[key] = round(Float64Array.from({ length: n }, (_, i) => Math.min(INFRA_RADIUS, si.nearest(x[i], y[i], INFRA_RADIUS))), 0);
  }

  // Төлөвлөгчид: полигоны ойролцоох хучилттай зам (ойроос нь эхэлж хязгаарлана — цэг бүрт зай тооцдог)
  const cx = (poly.xmin + poly.xmax) / 2, cy = (poly.ymin + poly.ymax) / 2;
  const svcRoadSegs = svcRoad.status === "fulfilled" ? toSegs(svcRoad.value) : [];
  const nearRoads = [...svcRoadSegs, ...osmSegs("road")]
    .filter((s) => s[0] > poly.xmin - 10000 && s[0] < poly.xmax + 10000 && s[1] > poly.ymin - 10000 && s[1] < poly.ymax + 10000)
    .map((s) => ({ s, d: Math.hypot(s[0] - cx, s[1] - cy) })).sort((a, b) => a.d - b.d).slice(0, 1500)
    .map(({ s }): [number, number][] => [[Math.round(s[0] * 10) / 10, Math.round(s[1] * 10) / 10], [Math.round(s[2] * 10) / 10, Math.round(s[3] * 10) / 10]]);

  const nearRivers = osmSegs("river")
    .filter((s) => s[0] > poly.xmin - 2000 && s[0] < poly.xmax + 2000 && s[1] > poly.ymin - 2000 && s[1] < poly.ymax + 2000)
    .slice(0, 4000)
    .map((s): [number, number][] => [[Math.round(s[0]), Math.round(s[1])], [Math.round(s[2]), Math.round(s[3])]]);

  // ---------- Сум, аймгийн төв (EIC) ----------
  step("Сум, аймгийн хил (EIC) тулгаж байна…");
  const centers = await loadCenters();
  let anchor: Prepared["anchor"] = null;
  const centerSegs: Seg[] = centers.map((c) => {
    const [a, b] = tr.forward(c.lonLat);
    const km = Math.hypot(a - cx, b - cy) / 1000;
    if (!anchor || km < anchor.km) anchor = { name: c.name, x: Math.round(a), y: Math.round(b), km: Math.round(km * 10) / 10 };
    return [a, b, a, b];
  });
  // Сонгосон сум, аймагт төв нь тухайн нэгжийн өөрийн төв
  if (input.admin?.anchor) {
    const [a, b] = tr.forward(input.admin.anchor.lonLat);
    anchor = { name: input.admin.anchor.name, x: Math.round(a), y: Math.round(b), km: Math.round((Math.hypot(a - cx, b - cy) / 1000) * 10) / 10 };
  }
  const ci = new SegIndex(centerSegs, 10000);
  num.soum_center = round(Float64Array.from({ length: n }, (_, i) => Math.min(CENTER_RADIUS, ci.nearest(x[i], y[i], CENTER_RADIUS))), 0);
  sources.soum_center = { status: "loaded", source: "EIC · soumcenter, aimagcenter" };

  const soums = (await loadSoums()).map((s) => ({ ...s, poly: toPoly(s.rings) as Poly }))
    .filter((s) => s.poly.xmin <= boxInner.e && s.poly.xmax >= boxInner.w && s.poly.ymin <= boxInner.n && s.poly.ymax >= boxInner.s);
  const zones: ZoneInfo[] = [], zoneOf = new Map<number, number>();
  const zone = new Int32Array(n).fill(-1);
  let hint = -1; // ихэнх нүд өмнөх нүдтэйгээ нэг суманд оршино
  for (let c = 0; c < n; c++) {
    const s = hint >= 0 && inPoly(lon[c], lat[c], soums[hint].poly) ? hint : soums.findIndex((v) => inPoly(lon[c], lat[c], v.poly));
    hint = s;
    if (s < 0) continue;
    if (!zoneOf.has(s)) { zoneOf.set(s, zones.length); zones.push({ aimag: soums[s].aimag, soum: soums[s].soum }); }
    zone[c] = zoneOf.get(s)!;
  }
  const outside = zone.reduce((a, v) => a + (v < 0 ? 1 : 0), 0);
  if (outside === n) warnings.push("Полигон Монгол Улсын сумдын хилийн гадна байна.");
  else if (outside > n * 0.02) warnings.push(`Полигоны ${Math.round((outside / n) * 100)}% нь сумдын хилийн гадна байна.`);

  // ---------- Байгаль орчны давхарга — зөвхөн сервисийн хүрээнд ----------
  const envFactors = FACTORS.filter((f) => f.layer != null);
  const inEnv = intersects(boxInner, SERVICE_EXTENT);
  if (inEnv) step("Хөрс, цэвдэг, ургамлын давхарга уншиж байна…");
  await Promise.all(envFactors.map(async (f) => {
    if (!inEnv) {
      sources[f.key] = { status: "missing", source: SVC_NAME, note: "Давхарга зөвхөн Бөөрөлжүүт орчмыг хамардаг (106.66–109.04°E, 46.41–48.10°N)." };
      return;
    }
    try {
      const feats = await fetchFeatures(SERVICE_URL, f.layer!, boxInner, epsg, { fields: f.field!, simplify: cell / 4 });
      const polys = feats.map((ft) => toPoly((ft.geometry.rings ?? []) as XY[][]));
      const dict = [...new Set(feats.map((ft) => String(ft.attributes[f.field!] ?? "").replace(/\s+/g, " ").trim()))];
      const vals = feats.map((ft) => dict.indexOf(String(ft.attributes[f.field!] ?? "").replace(/\s+/g, " ").trim()));
      const idx = Array.from({ length: n }, (_, i) => {
        const h = polys.findIndex((p) => inPoly(x[i], y[i], p));
        return h >= 0 ? vals[h] : -1;
      });
      cat[f.key] = { dict, idx };
      sources[f.key] = { status: idx.some((v) => v >= 0) ? "loaded" : "missing", source: SVC_NAME };
    } catch (e) {
      sources[f.key] = { status: "missing", source: SVC_NAME, note: (e as Error).message };
    }
  }));

  return {
    cell, epsg, utmZone, n, x: round(x, 1), y: round(y, 1), areaHa: areaM2 / 1e4, centroid: [lon0, lat0],
    zone: Array.from(zone), zones, num, cat, sources, warnings, roads: nearRoads, rivers: nearRivers, anchor,
  };
}
