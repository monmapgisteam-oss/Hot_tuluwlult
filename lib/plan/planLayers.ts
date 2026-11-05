// Төлөвлөгөөг газрын зурагт: 3D-д гадаргуу, давхар бүрээрх барилга, цонх, мод, гэрэл; 2D-д ижил гадаргуу, барилгын суурь.
// Бөөрөлжүүтийн components/sections/UrbanPlan.tsx-ийн давхаргуудаас зөөв.
import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import Polyline from "@arcgis/core/geometry/Polyline";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import proj4 from "proj4";
import { fmtN } from "../suit";
import { inter, setPlanWkid, bufPath, type Path, type Rings, type XY } from "./geom";
import { SYS, type Sys } from "./network";
import { urbanFacadeRenderer, urbanFacadeRows, urbanGroundRenderer, urbanGroundRows, urbanMarkRows, urbanMassRenderer, urbanTreeRenderer, urbanTreeRows } from "./urbanAppearance";
import { channelPipes, PIPES } from "./utilityStrategy";
import type { Plan } from "./urban";
import { TREE, ZONE, type ZoneKey } from "./zoning";

export type PlanDim = "2d" | "3d";
export type PlanLayerKey = "site" | "ground" | "streets" | "buildings" | "trees" | "zones" | "water" | "sewer" | "heat" | "power" | "storm";
const BUILDING_LABEL: Record<string, string> = { res: "Орон сууц", com: "Үйлчилгээ", school: "Сургууль", kinder: "Цэцэрлэг", clinic: "Эмнэлэг", eng: "Инженерийн байгууламж", office: "Оффис", park: "Парк" };

const SR = { wkid: 102100 };
const rgba = (hex: string, a = 1) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a]; };
type Row = { g: unknown; tip?: string; a?: Record<string, unknown> };
type Options = { renderer: unknown; fields?: { name: string; type: string }[]; minScale?: number; elevationInfo?: unknown };

export function buildPlanLayers(pl: Plan, wkid: number, dim: PlanDim): Map<PlanLayerKey, FeatureLayer[]> {
  setPlanWkid(wkid); // төлөвлөгч Worker-т ажилладаг тул энд дахин тохируулна
  const tr = proj4(`+proj=utm +zone=${wkid % 100}${wkid >= 32700 ? " +south" : ""} +datum=WGS84 +units=m +no_defs`);
  const R = 6378137;
  const m = (p: XY | number[]): [number, number] => {
    const [lon, lat] = tr.inverse([p[0], p[1]]);
    return [(R * lon * Math.PI) / 180, R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))];
  };
  const poly = (rings: Rings) => new Polygon({ rings: rings.map((r) => r.map(m)), spatialReference: SR });
  const line = (paths: Path[]) => new Polyline({ paths: paths.map((r) => r.map(m)), spatialReference: SR });
  const point = (p: XY) => { const [x, y] = m(p); return new Point({ x, y, spatialReference: SR }); };

  let seq = 0;
  const layer = (geometryType: "polygon" | "polyline" | "point", rows: Row[], o: Options) => new FeatureLayer({
    id: `plan-${seq++}`, geometryType, spatialReference: SR, objectIdField: "oid",
    fields: [{ name: "oid", type: "oid" }, { name: "tip", type: "string" }, ...(o.fields ?? [])] as never,
    source: rows.map((r, i) => new Graphic({ geometry: r.g as never, attributes: { oid: i + 1, tip: r.tip ?? null, ...r.a } })),
    outFields: ["*"], popupEnabled: false, renderer: o.renderer as never, minScale: o.minScale ?? 0,
    ...(o.elevationInfo ? { elevationInfo: o.elevationInfo as never } : {}),
  });
  const tipOf = (t: string, c: string, r: [string, string][]) => JSON.stringify({ t, c, r });
  const fill = (c: string, a: number, w = 0, oc?: string, oa = 1) => ({ type: "simple-fill", color: rgba(c, a), outline: { color: rgba(oc ?? c, oa), width: w } });
  const groundFields = [{ name: "k", type: "string" }, { name: "surface", type: "string" }, { name: "lot", type: "integer" }];
  const groundLayer = (list: Plan["scene"]["base"]) => layer("polygon", urbanGroundRows(list).map((r) => ({ g: poly(r.g), a: r.a })), { renderer: urbanGroundRenderer(), fields: groundFields });
  const on3d = dim === "3d";
  const out = new Map<PlanLayerKey, FeatureLayer[]>();

  out.set("site", [layer("polygon", [{ g: poly(pl.site) }], { renderer: { type: "simple", symbol: fill("#f97316", 0, 2, "#f97316") } })]);
  out.set("ground", [groundLayer(pl.scene.base), groundLayer(pl.scene.over)]);

  // Зам: тооцсон гудамжны гадаргуу + гарц, зогсоолын будаг, эгнээний шугам
  const roads = [groundLayer(pl.scene.streets)];
  const marks = urbanMarkRows(pl.scene.marks);
  if (marks.length) roads.push(layer("polygon", marks.map((r) => ({ g: poly(r.g) })), { renderer: { type: "simple", symbol: fill("#f5f5f2", 1) }, minScale: 6000 }));
  const lanes = pl.scene.lanes.map((l) => l.path).filter((p) => p.length > 1);
  if (lanes.length) roads.push(layer("polyline", [{ g: line(lanes) }], { renderer: { type: "simple", symbol: { type: "simple-line", color: rgba("#f5f5f2", 0.9), width: 0.75 } }, minScale: 6000 }));
  // Улаан шугам: гудамжны хамрах хүрээ ба тайлбар
  const streetTips: Row[] = pl.streets.filter((s) => !s.ext).flatMap((s) => {
    const g = inter(bufPath([s.path], s.w / 2), pl.site);
    if (!g.length) return [];
    const len = s.path.reduce((a, p, i) => a + (i ? Math.hypot(p[0] - s.path[i - 1][0], p[1] - s.path[i - 1][1]) : 0), 0);
    return [{ g: poly(g), tip: tipOf(s.cls === "arterial" ? "Гол зам" : s.cls === "collector" ? "Туслах зам" : "Гудамж", "#6b7280", [["Улаан шугамын өргөн", `${s.w} м`], ["Урт", `${fmtN(len)} м`]]) }];
  });
  // Зөвхөн хулганы тайлбарт: харагдахгүй дүүргэлт, хүрээгүй
  if (streetTips.length) roads.push(layer("polygon", streetTips, { renderer: { type: "simple", symbol: { type: "simple-fill", color: [0, 0, 0, 0.01], outline: { width: 0 } } } }));
  out.set("streets", roads);

  const buildingTip = (b: Plan["bldgs"][number]) => tipOf(BUILDING_LABEL[b.use] ?? b.use, "#c9a77e", [
    ["Давхар / өндөр", `${fmtN(b.floors)} · ${fmtN(b.h, 1)} м`], ["Суурь / нийт", `${fmtN(b.foot)} / ${fmtN(b.gfa)} м²`],
    ...(b.pop >= 1 ? [["Хүн ам", fmtN(b.pop)] as [string, string]] : []),
    ...(b.jobs >= 1 ? [["Ажлын байр", fmtN(b.jobs)] as [string, string]] : []),
    ...(b.waterM3 ? [["Ус", `${fmtN(b.waterM3, 1)} м³/хон`] as [string, string]] : []),
  ]);
  if (on3d) {
    const tips = new Map(pl.bldgs.map((b) => [b.id, buildingTip(b)]));
    const elevation = { mode: "relative-to-ground", featureExpressionInfo: { expression: "$feature.z0" }, unit: "meters" };
    const masses = layer("polygon", pl.scene.masses.map((b) => ({ g: poly(b.rings), tip: tips.get(b.bid), a: { k: b.k, z0: b.z0, h: b.h } })), {
      renderer: urbanMassRenderer(), elevationInfo: elevation,
      fields: [{ name: "k", type: "string" }, { name: "z0", type: "double" }, { name: "h", type: "double" }],
    });
    const windows = urbanFacadeRows(pl.scene.masses);
    out.set("buildings", windows.length ? [masses, layer("polygon", windows.map((r) => ({ g: poly(r.g), a: r.a })), {
      renderer: urbanFacadeRenderer(), elevationInfo: elevation, minScale: 8000,
      fields: [{ name: "bid", type: "integer" }, { name: "z0", type: "double" }, { name: "h", type: "double" }, { name: "tone", type: "integer" }],
    })] : [masses]);
  } else {
    out.set("buildings", [layer("polygon", pl.bldgs.map((b) => ({ g: poly(b.rings), tip: buildingTip(b) })), { renderer: { type: "simple", symbol: fill("#e2c9a8", 1, 0.6, "#5a4a36") } })]);
  }

  const treeRows = urbanTreeRows(pl.scene.trees);
  const trees: FeatureLayer[] = [];
  if (treeRows.length) trees.push(layer("point", treeRows.map((r) => ({ g: point(r.g), a: r.a })), {
    minScale: 15000,
    fields: [{ name: "t", type: "integer" }, { name: "h", type: "double" }, { name: "d", type: "double" }, { name: "heading", type: "double" }],
    renderer: on3d ? urbanTreeRenderer() : { type: "unique-value", field: "t", uniqueValueInfos: TREE.map((t, i) => ({ value: i, label: t.label, symbol: { type: "simple-marker", size: i === 2 ? 3 : 5, color: t.color, outline: { color: [30, 60, 30, 0.6], width: 0.4 } } })) },
  }));
  if (on3d && pl.scene.lights.length) trees.push(layer("point", pl.scene.lights.map((p) => ({ g: point(p) })), {
    minScale: 8000,
    renderer: { type: "simple", symbol: { type: "point-3d", symbolLayers: [{ type: "object", resource: { primitive: "cylinder" }, width: 0.25, depth: 0.25, height: 7, anchor: "bottom", material: { color: "#4b5563" } }] } },
  }));
  out.set("trees", trees);

  const zoneKeys = Object.keys(ZONE) as ZoneKey[];
  out.set("zones", [layer("polygon", pl.zones.map((z) => ({
    g: poly(z.rings), a: { cls: z.cls }, tip: tipOf(ZONE[z.cls].label, ZONE[z.cls].color, [["Талбай", `${fmtN(z.area / 1e4, 2)} га`]]),
  })), {
    fields: [{ name: "cls", type: "string" }],
    renderer: { type: "unique-value", field: "cls", uniqueValueInfos: zoneKeys.map((k) => ({ value: k, label: ZONE[k].label, symbol: fill(ZONE[k].color, 0.6, 0.5, "#ffffff", 0.7) })) },
  })]);

  const lines = (Object.keys(SYS) as Sys[]).flatMap((s) => (pl.nets[s]?.lines ?? []));
  const pipes = channelPipes(lines);
  const width = (dn: number | null) => (dn == null ? 1.2 : dn >= 500 ? 3.5 : dn >= 300 ? 2.8 : dn >= 200 ? 2.2 : 1.5);
  for (const sys of ["water", "sewer", "heat", "power", "storm"] as Sys[]) {
    const rows: Row[] = pipes.filter((p) => p.sys === sys).map((p) => ({
      g: line([p.path]), a: { w: width(p.dn) },
      tip: tipOf(PIPES[p.pipe as keyof typeof PIPES]?.label ?? SYS[sys].label, SYS[sys].color, [
        ...(p.dn ? [["Диаметр", `DN ${p.dn}`] as [string, string]] : []),
        ...(p.slope ? [["Налуу", `${fmtN(p.slope * 100, 2)}%`] as [string, string]] : []),
        ...(p.depth ? [["Гүн", `${fmtN(p.depth, 1)} м`] as [string, string]] : []),
      ]),
    }));
    out.set(sys as PlanLayerKey, [layer("polyline", rows, {
      fields: [{ name: "w", type: "double" }],
      renderer: { type: "simple", symbol: { type: "simple-line", color: rgba(SYS[sys].color, 1), width: 1.5 }, visualVariables: [{ type: "size", field: "w", minDataValue: 1.2, maxDataValue: 3.5, minSize: 1.2, maxSize: 3.5 }] },
    })]);
  }
  return out;
}
