// Вектор эх сурвалж: Бөөрөлжүүтийн FeatureServer (бүс нутгаар хязгаарлагдсан), OpenStreetMap-ийн бэлтгэсэн хэсгүүд (улс даяар), EIC-ийн хил.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { BBox } from "./rasters.ts";
import type { Seg, XY } from "./grid.ts";

export const SERVICE_URL = "https://services-ap1.arcgis.com/ACqsMOmNLi5wIdIh/arcgis/rest/services/booroljuulelt/FeatureServer";
export const ZONE_SERVICE_URL = "https://services-ap1.arcgis.com/ACqsMOmNLi5wIdIh/arcgis/rest/services/booroljuulelt2/FeatureServer";
/** Сервисийн давхаргууд зөвхөн энэ хүрээнд байна (2026-11-05 returnExtentOnly-оор шалгасан) */
export const SERVICE_EXTENT: BBox = { w: 106.66, s: 46.41, e: 109.04, n: 48.1 };
// Хучилттай зам — Бөөрөлжүүт config/config.yaml road_filters.road_paved-тай ижил (ТААМАГЛАЛ)
export const PAVED_WHERE =
  "roadtype IN ('Хурдны зам','Олон улсын чанартай авто зам','Улсын чанартай авто зам','Хоёрдогч авто зам','Гуравдагч зам','Авто зам','Үйлчилгээний зам','Замын холбоос')";

export const intersects = (a: BBox, b: BBox) => a.w < b.e && a.e > b.w && a.s < b.n && a.n > b.s;
export const within = (a: BBox, b: BBox) => a.w >= b.w && a.e <= b.e && a.s >= b.s && a.n <= b.n;

export type Feat = { attributes: Record<string, unknown>; geometry: { paths?: XY[][]; rings?: XY[][] } };

/** FeatureServer-ээс bbox-оор, тухайн UTM бүсийн координатаар татна */
export async function fetchFeatures(
  base: string, n: number, b: BBox, epsg: number, o: { where?: string; fields?: string; simplify?: number } = {},
): Promise<Feat[]> {
  const out: Feat[] = [];
  for (let offset = 0; ; offset += 2000) {
    const q = new URLSearchParams({
      where: o.where ?? "1=1", geometry: [b.w, b.s, b.e, b.n].join(","), geometryType: "esriGeometryEnvelope", inSR: "4326",
      outSR: String(epsg), spatialRel: "esriSpatialRelIntersects", outFields: o.fields ?? "OBJECTID", returnGeometry: "true",
      resultOffset: String(offset), resultRecordCount: "2000", f: "json",
      ...(o.simplify ? { maxAllowableOffset: String(o.simplify) } : {}),
    });
    const r = await fetch(`${base}/${n}/query`, { method: "POST", body: q, signal: AbortSignal.timeout(60000) });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message);
    out.push(...d.features);
    if (!d.exceededTransferLimit && d.features.length < 2000) break;
  }
  return out;
}

export function toSegs(feats: Feat[]): Seg[] {
  const segs: Seg[] = [];
  for (const f of feats) for (const p of f.geometry.paths ?? f.geometry.rings ?? []) {
    for (let i = 1; i < p.length; i++) segs.push([p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]]);
  }
  return segs;
}

// ---------- OpenStreetMap (data/infra — scripts/build-infra.mjs) ----------
export type InfraKind = "road" | "rail" | "tl" | "river";
export type InfraLines = Record<InfraKind, [number, number][][]>; // lon, lat
const tileCache = new Map<string, Promise<InfraLines | null>>();

function loadTile(key: string) {
  let t = tileCache.get(key);
  if (!t) {
    t = readFile(join(process.cwd(), "data", "infra", `${key}.json`), "utf8").then((v) => JSON.parse(v) as InfraLines).catch((e) => {
      if (e.code === "ENOENT") return null; // тухайн 1° хэсэгт шугам байхгүй
      throw e;
    });
    tileCache.set(key, t);
  }
  return t;
}

/** bbox-ыг хамрах 1° хэсгүүдийн шугам. Өгөгдлийг бэлтгээгүй бол алдаа шиднэ. */
export async function loadInfra(b: BBox): Promise<InfraLines> {
  await readFile(join(process.cwd(), "data", "infra", "meta.json"), "utf8").catch(() => {
    throw new Error("data/infra бэлтгэгдээгүй байна — npm run infra");
  });
  const jobs: Promise<InfraLines | null>[] = [];
  for (let x = Math.floor(b.w); x <= Math.floor(b.e); x++) for (let y = Math.floor(b.s); y <= Math.floor(b.n); y++) jobs.push(loadTile(`${x}_${y}`));
  const out: InfraLines = { road: [], rail: [], tl: [], river: [] };
  for (const t of await Promise.all(jobs)) {
    if (t) for (const k of ["road", "rail", "tl", "river"] as const) for (const l of t[k] ?? []) out[k].push(l);
  }
  return out;
}

// ---------- EIC-ийн хил (public/data, scripts/build-boundaries.mjs) ----------
type GeoFeature = { properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } };
const files = new Map<string, Promise<GeoFeature[]>>();
function loadGeojson(name: string) {
  let p = files.get(name);
  if (!p) {
    p = readFile(join(process.cwd(), "public", "data", `${name}.geojson`), "utf8").then((t) => JSON.parse(t).features);
    files.set(name, p);
  }
  return p;
}

/** Сум бүр: нэр, бүх цагираг (MultiPolygon-ыг even-odd-оор нэгтгэнэ) */
export async function loadSoums() {
  const feats = await loadGeojson("soum");
  return feats.map((f) => {
    const c = f.geometry.coordinates as XY[][] | XY[][][];
    const rings = f.geometry.type === "MultiPolygon" ? (c as XY[][][]).flat() : (c as XY[][]);
    return { aimag: String(f.properties.aimag_name), soum: String(f.properties.soum_name), rings };
  });
}

/** Сум, аймгийн төвүүд, lon/lat */
export async function loadCenters(): Promise<{ name: string; lonLat: [number, number] }[]> {
  const [s, a] = await Promise.all([loadGeojson("soumcenter"), loadGeojson("aimagcenter")]);
  return [...s, ...a].map((f) => ({ name: String(f.properties.center_nam ?? ""), lonLat: f.geometry.coordinates as [number, number] }));
}
