// OpenStreetMap-ийн Монголын файлаас (Geofabrik) хучилттай зам, төмөр зам, цахилгааны шугам, гол мөрнийг ялгаж
// data/infra/<lon>_<lat>.json (1°×1°) болгож хадгална. Сервер зөвхөн хэрэгтэй хэсгийг уншдаг.
// Ажиллуулах: npm run infra  (шинэчлэх бол .cache/mongolia-latest.osm.pbf-г устгаад дахин ажиллуулна)
import { createWriteStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { join } from "node:path";
import { createOSMStream } from "osm-pbf-parser-node";

const PBF_URL = "https://download.geofabrik.de/asia/mongolia-latest.osm.pbf";
const PBF = process.env.OSM_PBF ?? join(".cache", "mongolia-latest.osm.pbf");
const OUT = join("data", "infra");

const ROAD = /^(motorway|trunk|primary|secondary|tertiary)(_link)?$/;
const UNPAVED = /^(unpaved|gravel|fine_gravel|dirt|ground|sand|earth|grass|compacted|mud)$/;
/** Хучилттай зам: гол ангиллын зам, surface шошгоор шороон замыг хасна. ТААМАГЛАЛ: шошгогүй бол хучилттай гэж үзнэ. */
export function kindOf(tags = {}) {
  if (tags.waterway === "river" || tags.waterway === "canal") return "river";
  if (tags.power === "line") return "tl";
  if (tags.railway === "rail" || tags.railway === "construction") return "rail";
  if (ROAD.test(tags.highway ?? "") && !UNPAVED.test(tags.surface ?? "")) return "road";
  return null;
}

if (!existsSync(PBF)) {
  mkdirSync(join(".cache"), { recursive: true });
  console.log(`Татаж байна: ${PBF_URL}`);
  const r = await fetch(PBF_URL);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  await pipeline(Readable.fromWeb(r.body), createWriteStream(PBF));
}

// 1-р алхам: файлын дараалал nodes → ways тул эхлээд way-уудыг ялгаж, хэрэгтэй node-ын дугаарыг цуглуулна
const ways = [];
const needed = new Set();
const counted = { road: 0, rail: 0, tl: 0, river: 0 };
for await (const item of createOSMStream(PBF, { withInfo: false, withTags: { node: [], way: ["highway", "surface", "railway", "power", "waterway"], relation: [] } })) {
  if (item.type !== "way") continue;
  const kind = kindOf(item.tags);
  if (!kind || item.refs.length < 2) continue;
  counted[kind]++;
  ways.push({ kind, refs: item.refs });
  for (const id of item.refs) needed.add(id);
}
console.log("way:", counted, "node:", needed.size);

// 2-р алхам: зөвхөн хэрэгтэй node-ын координат
const coords = new Map();
for await (const item of createOSMStream(PBF, { withInfo: false, withTags: { node: [], way: [], relation: [] } })) {
  if (item.type === "node" && needed.has(item.id)) coords.set(item.id, [item.lon, item.lat]);
  if (item.type === "way") break;
}

// 3-р алхам: хэрчим бүрийг таарах 1° хэсэгт хуваарилна
const tiles = new Map();
const put = (key, kind, line) => {
  let t = tiles.get(key);
  if (!t) tiles.set(key, (t = { road: [], rail: [], tl: [], river: [] }));
  t[kind].push(line);
};
const r5 = (v) => Math.round(v * 1e5) / 1e5;
let missing = 0;
for (const w of ways) {
  const pts = [];
  for (const id of w.refs) {
    const c = coords.get(id);
    if (c) pts.push([r5(c[0]), r5(c[1])]); else missing++;
  }
  if (pts.length < 2) continue;
  // Шугамыг хэсгийн заагаар тасалж, хэсэг бүрт зөвхөн тухайн хэсгийг хамрах хэрчмүүдийг хадгална
  const byTile = new Map();
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    for (let x = Math.floor(Math.min(a[0], b[0])); x <= Math.floor(Math.max(a[0], b[0])); x++) {
      for (let y = Math.floor(Math.min(a[1], b[1])); y <= Math.floor(Math.max(a[1], b[1])); y++) {
        const key = `${x}_${y}`;
        let cur = byTile.get(key);
        if (!cur) byTile.set(key, (cur = []));
        const line = cur[cur.length - 1];
        if (line && line[line.length - 1] === a) line.push(b); else cur.push([a, b]);
      }
    }
  }
  for (const [key, lines] of byTile) for (const line of lines) put(key, w.kind, line);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
let bytes = 0;
for (const [key, t] of tiles) {
  const text = JSON.stringify(t);
  writeFileSync(join(OUT, `${key}.json`), text);
  bytes += text.length;
}
const meta = { source: PBF_URL, license: "© OpenStreetMap contributors, ODbL", fileDate: statSync(PBF).mtime.toISOString().slice(0, 10), ways: counted, tiles: tiles.size };
writeFileSync(join(OUT, "meta.json"), JSON.stringify(meta, null, 1));
console.log(`Болов: ${tiles.size} хэсэг, ${(bytes / 1e6).toFixed(1)} МБ, node дутуу ${missing}`);
