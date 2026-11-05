// Улсын хэмжээний нээлттэй растерыг COG хэлбэрээр хэсэгчлэн (HTTP range) уншина:
//   Өндөр — Copernicus DEM GLO-30 (1°×1°), газрын бүрхэвч — ESA WorldCover 2021 v200 (3°×3°).
import { fromUrl } from "geotiff";

export type BBox = { w: number; s: number; e: number; n: number };
type Win = { lon0: number; lat0: number; dLon: number; dLat: number; w: number; h: number; data: ArrayLike<number> };

type Tiff = Awaited<ReturnType<typeof fromUrl>>;
const tiffs = new Map<string, Promise<Tiff | null>>();
const MAX_OPEN = 12; // кэшийн нийлбэр ≤360 МБ — cloud серверийн санах ойд багтана

/** Тайл байхгүй бол null (S3 нь байхгүй түлхүүрт 403/404 буцаана); сүлжээний алдаа дээшээ шидэгдэнэ */
function open(url: string) {
  let t = tiffs.get(url);
  if (!t) {
    t = (async () => {
      const head = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(30000) });
      if (head.status === 403 || head.status === 404) return null;
      if (!head.ok) throw new Error(`${url}: HTTP ${head.status}`);
      // Анхдагч кэш (100 × 64 КБ) том цонхонд блокуудыг дахин дахин татдаг
      return fromUrl(url, { blockSize: 256 * 1024, cacheSize: 120 }); // нэг файлд ≤30 МБ
    })();
    t.catch(() => tiffs.delete(url));
    tiffs.set(url, t);
    // Удаан ажиллах серверийн санах ойг хязгаарлана
    if (tiffs.size > MAX_OPEN) tiffs.delete(tiffs.keys().next().value!);
  }
  return t;
}

/** Сүлжээний түр тасалдлыг дахин оролдоно; файлыг шинээр нээнэ */
async function readWindow(url: string, b: BBox, targetRes: number): Promise<Win | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await readWindowOnce(url, b, targetRes);
    } catch (e) {
      if (attempt >= 2) throw e;
      tiffs.delete(url);
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
}

/** bbox-ыг хамрах цонхыг хэрэгцээт нарийвчлалд хамгийн ойр overview-ээс уншина (бага зэрэг бүдүүнийг зөвшөөрнө: ~4 дахин хурдан) */
async function readWindowOnce(url: string, b: BBox, targetRes: number): Promise<Win | null> {
  const tiff = await open(url);
  if (!tiff) return null;
  const base = await tiff.getImage(0);
  const [minX, minY, maxX, maxY] = base.getBoundingBox();
  let img = base;
  const count = await tiff.getImageCount();
  for (let i = 1; i < count; i++) {
    const o = await tiff.getImage(i);
    if ((maxX - minX) / o.getWidth() > targetRes * 1.3) break;
    img = o;
  }
  const W = img.getWidth(), H = img.getHeight(), dLon = (maxX - minX) / W, dLat = (maxY - minY) / H;
  const x0 = Math.max(0, Math.floor((b.w - minX) / dLon) - 1), x1 = Math.min(W, Math.ceil((b.e - minX) / dLon) + 1);
  const y0 = Math.max(0, Math.floor((maxY - b.n) / dLat) - 1), y1 = Math.min(H, Math.ceil((maxY - b.s) / dLat) + 1);
  if (x1 <= x0 || y1 <= y0) return null;
  const r = await img.readRasters({ window: [x0, y0, x1, y1], interleave: false });
  return { lon0: minX + x0 * dLon, lat0: maxY - y0 * dLat, dLon, dLat, w: x1 - x0, h: y1 - y0, data: (r as unknown as ArrayLike<number>[])[0] };
}

const contains = (w: Win, lon: number, lat: number) => {
  const fx = (lon - w.lon0) / w.dLon, fy = (w.lat0 - lat) / w.dLat;
  return fx >= 0 && fy >= 0 && fx <= w.w && fy <= w.h;
};

function bilinear(w: Win, lon: number, lat: number) {
  const fx = Math.max(0, Math.min(w.w - 1.000001, (lon - w.lon0) / w.dLon - 0.5));
  const fy = Math.max(0, Math.min(w.h - 1.000001, (w.lat0 - lat) / w.dLat - 0.5));
  const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
  if (w.w < 2 || w.h < 2) return w.data[j * w.w + i];
  const a = w.data[j * w.w + i], b = w.data[j * w.w + i + 1], c = w.data[(j + 1) * w.w + i], d = w.data[(j + 1) * w.w + i + 1];
  return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
}

function nearest(w: Win, lon: number, lat: number) {
  const i = Math.min(w.w - 1, Math.max(0, Math.floor((lon - w.lon0) / w.dLon)));
  const j = Math.min(w.h - 1, Math.max(0, Math.floor((w.lat0 - lat) / w.dLat)));
  return w.data[j * w.w + i];
}

const pad2 = (v: number, n: number) => String(Math.abs(v)).padStart(n, "0");

export const demTile = (lat: number, lon: number) => {
  const name = `Copernicus_DSM_COG_10_${lat >= 0 ? "N" : "S"}${pad2(lat, 2)}_00_${lon >= 0 ? "E" : "W"}${pad2(lon, 3)}_00_DEM`;
  return `https://copernicus-dem-30m.s3.amazonaws.com/${name}/${name}.tif`;
};
export const landcoverTile = (lat: number, lon: number) =>
  `https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_${lat >= 0 ? "N" : "S"}${pad2(lat, 2)}${lon >= 0 ? "E" : "W"}${pad2(lon, 3)}_Map.tif`;

async function loadWindows(b: BBox, step: number, tile: (lat: number, lon: number) => string, targetRes: number) {
  const jobs: Promise<Win | null>[] = [];
  for (let lat = Math.floor(b.s / step) * step; lat < b.n; lat += step) {
    for (let lon = Math.floor(b.w / step) * step; lon < b.e; lon += step) {
      jobs.push(readWindow(tile(lat, lon), b, targetRes));
    }
  }
  return (await Promise.all(jobs)).filter((w): w is Win => !!w);
}

/** Цэг бүрийн өндөр, м (bilinear). Хамрагдаагүй цэг NaN — зохиож нөхөхгүй. */
export async function sampleDem(lon: ArrayLike<number>, lat: ArrayLike<number>, b: BBox, cellM: number) {
  const wins = await loadWindows(b, 1, demTile, cellM / 111320);
  const out = new Float64Array(lon.length).fill(NaN);
  let w = wins[0];
  for (let k = 0; k < lon.length; k++) {
    if (!w || !contains(w, lon[k], lat[k])) w = wins.find((c) => contains(c, lon[k], lat[k])) ?? w;
    if (w && contains(w, lon[k], lat[k])) out[k] = bilinear(w, lon[k], lat[k]);
  }
  return out;
}

/** Цэг бүрийн WorldCover код; 0 = мэдээлэлгүй */
export async function sampleLandcover(lon: ArrayLike<number>, lat: ArrayLike<number>, b: BBox, cellM: number) {
  const wins = await loadWindows(b, 3, landcoverTile, cellM / 111320);
  const out = new Int32Array(lon.length);
  let w = wins[0];
  for (let k = 0; k < lon.length; k++) {
    if (!w || !contains(w, lon[k], lat[k])) w = wins.find((c) => contains(c, lon[k], lat[k])) ?? w;
    if (w && contains(w, lon[k], lat[k])) out[k] = nearest(w, lon[k], lat[k]);
  }
  return out;
}
