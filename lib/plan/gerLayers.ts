// Bayandun parcel presentation: retain the same yard surfaces and native metre-scale house models.
import type FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import type { Rings, Path, XY } from "./geom";
import { PART, type Surface, type Yard } from "./gerYards";
import { yardBuildingModel, yardCarModel, type YardBuildingKind, type YardModel } from "./gerModels";
import { urbanTreeRenderer, urbanTreeRows } from "./urbanAppearance";

export type GerDistrictDisplay = {
  parcelAreaM2: number;
  parcels: { id: string; rings: Rings; area: number }[];
  yards: Yard[];
};
export type GerLayerRow = { g: unknown; tip?: string; a?: Record<string, unknown> };
export type GerLayerOptions = { renderer: unknown; fields?: { name: string; type: string }[]; minScale?: number; elevationInfo?: unknown; labelingInfo?: unknown };
export type GerLayerContext = {
  layer: (type: "polygon" | "polyline" | "point", rows: GerLayerRow[], options: GerLayerOptions) => FeatureLayer;
  poly: (rings: Rings) => unknown; line: (paths: Path[]) => unknown; point: (p: XY) => unknown;
  lonLat: (point: XY) => number[];
};

const fill = (color: string, outline = color, width = 0) => ({ type: "simple-fill", color, outline: { color: outline, width } });
const tip = (title: string, color: string, rows: [string, string][]) => JSON.stringify({ t: title, c: color, r: rows });
const unique = (field: string, values: Iterable<string>, symbol: (value: string) => unknown) => ({
  type: "unique-value", field, uniqueValueInfos: [...new Set(values)].map(value => ({ value, symbol: symbol(value) })),
});
const round = (value: number) => Math.round(value * 1000) / 1000;
const modelUrls = new WeakMap<YardModel, string>();
function modelSymbol(model: YardModel) {
  // Reuse one blob per model to avoid repeatedly decoding a long data URI in ArcGIS.
  let href = modelUrls.get(model);
  if (!href) {
    const raw = atob(model.href.slice(model.href.indexOf(",") + 1)), bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
    href = URL.createObjectURL(new Blob([bytes], { type: "model/gltf-binary" }));
    modelUrls.set(model, href);
  }
  return { type: "point-3d", symbolLayers: [{ type: "object", resource: { href }, anchor: "origin", height: model.height, width: null, depth: null, castShadows: true }] };
}

/** Account for grid convergence: model -Z faces inward and +Z faces the street. */
function heading(center: XY, inward: XY, lonLat: GerLayerContext["lonLat"]) {
  const [a, b] = lonLat(center), [c, d] = lonLat([center[0] + inward[0] * 10, center[1] + inward[1] * 10]);
  const rad = Math.PI / 180, phi0 = b * rad, phi1 = d * rad, delta = (c - a) * rad;
  return (Math.atan2(Math.sin(delta) * Math.cos(phi1), Math.cos(phi0) * Math.sin(phi1) - Math.sin(phi0) * Math.cos(phi1) * Math.cos(delta)) / rad + 360) % 360;
}

export function buildGerLayers(ger: GerDistrictDisplay, on3d: boolean, ctx: GerLayerContext) {
  const { layer, poly, line, point } = ctx, { yards } = ger;
  const ground: FeatureLayer[] = [], buildings: FeatureLayer[] = [], trees: FeatureLayer[] = [];
  const plotTip = (id: string, area: number) => tip(`${id} · айлын хашаа`, "#527b35", [["Талбай", `${(area / 10000).toLocaleString("en-US", { maximumFractionDigits: 2 })} га · ${Math.round(area).toLocaleString("en-US")} м²`]]);
  ground.push(layer("polygon", ger.parcels.map(p => ({ g: poly(p.rings), a: { id: p.id, area: p.area }, tip: plotTip(p.id, p.area) })), {
    renderer: { type: "simple", symbol: fill("#527b35", "#e2d6b8", .65) },
    fields: [{ name: "id", type: "string" }, { name: "area", type: "double" }],
  }));
  const surfaces = (items: { yard: Yard; surface: Surface }[], destination: FeatureLayer[], minScale = 0) => {
    if (!items.length) return;
    destination.push(layer("polygon", items.map(({ yard, surface: s }) => ({ g: poly([s.r]), a: { color: s.color }, tip: tip(`${PART[s.k].label} · ${yard.id}`, s.color, []) })), {
      renderer: unique("color", items.map(({ surface }) => surface.color), color => fill(color)), fields: [{ name: "color", type: "string" }], minScale,
    }));
  };
  surfaces(yards.flatMap(yard => yard.parts.map(surface => ({ yard, surface }))), ground);
  if (!on3d) {
    surfaces(yards.flatMap(yard => yard.shadows.map(surface => ({ yard, surface }))), ground, 15000);
    surfaces(yards.flatMap(yard => yard.roofs.map(surface => ({ yard, surface }))), buildings);
    surfaces(yards.flatMap(yard => yard.foliage.map(surface => ({ yard, surface }))), trees, 15000);
  }
  const details = yards.flatMap(yard => yard.details.filter(d => !on3d || !["house", "parking", "greenhouse", "shed", "gazebo", "gate"].includes(d.k)).map(d => ({
    g: line([d.r]), a: { style: `${d.color}:${d.width}` }, tip: tip(`${PART[d.k].label} · ${yard.id}`, d.color, []),
  })));
  if (details.length) ground.push(layer("polyline", details, { fields: [{ name: "style", type: "string" }], minScale: 10000,
    renderer: unique("style", details.map(d => d.a.style), style => { const [color, width] = style.split(":"); return { type: "simple-line", color, width: Number(width) }; }),
  }));

  if (on3d) {
    const models = new Map<string, YardModel>(), rows: GerLayerRow[] = [];
    for (const yard of yards) {
      const { frame } = yard;
      const place = (kind: YardBuildingKind | "car", ring: XY[], wall = 0) => {
        const corners = ring.slice(0, -1), center: XY = [corners.reduce((sum, p) => sum + p[0], 0) / corners.length, corners.reduce((sum, p) => sum + p[1], 0) / corners.length];
        const local = corners.map(p => { const x = p[0] - frame.A[0], y = p[1] - frame.A[1]; return [x * frame.u[0] + y * frame.u[1], x * frame.n[0] + y * frame.n[1]]; });
        const width = round(Math.max(...local.map(p => p[0])) - Math.min(...local.map(p => p[0]))), depth = round(Math.max(...local.map(p => p[1])) - Math.min(...local.map(p => p[1])));
        const roof = kind === "house" ? yard.houseType.roof : kind === "parking" ? (yard.houseType.roof === "flat" ? "flat" : "gable") : "hip";
        const key = [kind, width, depth, wall, roof, ...yard.houseType.colors].join(":");
        if (!models.has(key)) models.set(key, kind === "car" ? yardCarModel() : yardBuildingModel(kind, width, depth, wall, roof, yard.houseType.colors));
        const model = models.get(key)!;
        rows.push({ g: point(center), a: { model: key, heading: heading(center, frame.n, ctx.lonLat) }, tip: tip(`${kind === "car" ? "Машин" : PART[kind].label} · ${yard.id}`, "#657a70", [
          ["Хэмжээ", `${width} × ${depth} м`], ["Нийт өндөр", `${round(model.height)} м`], ...(kind === "house" ? [["Загвар", yard.houseType.label], ["Давхар", String(yard.houseType.floors)]] as [string, string][] : []),
        ]) });
      };
      for (const b of yard.bldgs) if (["house", "parking", "gazebo", "greenhouse", "shed"].includes(b.k)) place(b.k as YardBuildingKind, b.r, round(b.h));
      for (const car of yard.cars) place("car", car);
    }
    if (rows.length) buildings.push(layer("point", rows, {
      fields: [{ name: "model", type: "string" }, { name: "heading", type: "double" }], elevationInfo: { mode: "relative-to-ground", unit: "meters" },
      renderer: { ...unique("model", models.keys(), key => modelSymbol(models.get(key)!)), visualVariables: [{ type: "rotation", field: "heading", rotationType: "geographic" }] },
    }));
    // Match Bayandun's actual fence height and opening at the garage apron.
    const fences: GerLayerRow[] = [];
    for (const yard of yards) for (const d of yard.details.filter(d => d.k === "gate" && (d.r.length > 2 || d.color === "#4f5549"))) {
      for (let i = 1; i < d.r.length; i++) {
        const a = d.r[i - 1], b = d.r[i], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (length < .1) continue;
        const nx = -(b[1] - a[1]) / length * .07, ny = (b[0] - a[0]) / length * .07, gate = d.r.length === 2;
        const r: XY[] = [[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny], [a[0] + nx, a[1] + ny]];
        fences.push({ g: poly([r]), a: { k: gate ? "gate" : "fence", h: gate ? 1.5 : 1.6 }, tip: plotTip(yard.id, ger.parcelAreaM2) });
      }
    }
    if (fences.length) buildings.push(layer("polygon", fences, {
      fields: [{ name: "k", type: "string" }, { name: "h", type: "double" }],
      elevationInfo: { mode: "relative-to-ground", unit: "meters" },
      renderer: { ...unique("k", ["gate", "fence"], k => ({ type: "polygon-3d", symbolLayers: [{ type: "extrude", material: { color: k === "gate" ? "#485651" : "#b7aa91" } }] })), visualVariables: [{ type: "size", field: "h", valueUnit: "meters" }] },
    }));
    const treeRows = urbanTreeRows(yards.flatMap(yard => yard.trees.map((t, i) => ({ x: t.p[0], y: t.p[1], t: i % 4 === 0 ? 0 : 1, h: 4.5 + (i % 3) * .6, r: t.r }))));
    if (treeRows.length) trees.push(layer("point", treeRows.map(r => ({ g: point(r.g), a: r.a })), { minScale: 15000, fields: [{ name: "t", type: "integer" }, { name: "h", type: "double" }, { name: "d", type: "double" }, { name: "heading", type: "double" }], renderer: urbanTreeRenderer() }));
  }
  ground.push(layer("point", yards.map(yard => ({ g: point(yard.label), a: { id: yard.id } })), {
    minScale: 6000, fields: [{ name: "id", type: "string" }], renderer: { type: "simple", symbol: { type: "simple-marker", size: 0, color: [0, 0, 0, 0] } },
    labelingInfo: [{ labelPlacement: on3d ? "above-center" : "center-center", labelExpressionInfo: { expression: "$feature.id" }, symbol: { type: "text", color: "#22301d", haloColor: "#fffdf2", haloSize: 1.3, font: { size: 9, weight: "bold" } } }],
  }));
  return { ground, buildings, trees };
}
