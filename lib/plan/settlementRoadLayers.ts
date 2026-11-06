// Feature layers for the B01 street model. All boolean geometry runs in the plan worker.
import Graphic from "@arcgis/core/Graphic";
import Polygon from "@arcgis/core/geometry/Polygon";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import proj4 from "proj4";
import type { Rings, XY } from "./geom";
import type { RoadPaintRow } from "./settlementRoadPaint";
import { CGA, SURFACES } from "./streetSection";
import { STREET_MODEL_VERSION, type StreetView } from "./streetModel";

export const SETTLEMENT_ROAD_COLORS = { asphalt: "#58636b", white: "#f2f3ec", yellow: "#e8b923", curb: "#d8d4ca" } as const;
type Row = { rings: Rings; attributes?: Record<string, string | number> };
type Field = { name: string; type: "string" | "integer" };

/** Convert prepared, metric street geometry to the same map CRS as planLayers. */
export function buildSettlementRoadLayers(view: StreetView, wkid: number, dim: "2d" | "3d", paint: RoadPaintRow[]): FeatureLayer[] {
  const sr = { wkid: 102100 }, radius = 6378137;
  const tr = proj4(`+proj=utm +zone=${wkid % 100}${wkid >= 32700 ? " +south" : ""} +datum=WGS84 +units=m +no_defs`);
  const mapPoint = (p: XY): XY => {
    const [lon, lat] = tr.inverse(p);
    return [radius * lon * Math.PI / 180, radius * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))];
  };
  const fill = (color: string) => ({ type: "simple-fill", color, outline: { width: 0 } });
  const extrude = (color: string, size: number) => ({ type: "polygon-3d", symbolLayers: [{ type: "extrude", size, material: { color } }] });
  const layer = (name: string, rows: Row[], renderer: unknown, fields: Field[] = [], minScale = 0) => new FeatureLayer({
    id: `plan-street-${name}`, geometryType: "polygon", spatialReference: sr, objectIdField: "oid",
    fields: [{ name: "oid", type: "oid" }, ...fields],
    source: rows.filter(row => row.rings.length).map((row, i) => new Graphic({
      geometry: new Polygon({ rings: row.rings.map(ring => ring.map(mapPoint)), spatialReference: sr }),
      attributes: { oid: i + 1, ...row.attributes },
    })),
    outFields: ["*"], popupEnabled: false, minScale, renderer: renderer as never,
  });
  const layers: FeatureLayer[] = [];
  if (view.surface.length) layers.push(layer("surface", [{ rings: view.surface }], { type: "simple", symbol: fill(SETTLEMENT_ROAD_COLORS.asphalt) }));
  const overlays: Row[] = view.overlays.map(o => ({ rings: o.rings, attributes: { material: o.surface } }));
  if (view.corners.length) overlays.push({ rings: view.corners, attributes: { material: "dark_asphalt" } });
  if (overlays.length) layers.push(layer("lanes", overlays, {
    type: "unique-value", field: "material", defaultSymbol: fill(SETTLEMENT_ROAD_COLORS.asphalt),
    uniqueValueInfos: Object.entries(SURFACES).map(([value, material]) => ({ value, symbol: fill(material.color) })),
  }, [{ name: "material", type: "string" }], 50000));
  if (view.ground.length) layers.push(layer("ground", view.ground.map(g => ({ rings: g.rings, attributes: { style: `${g.surface}:${g.raised ? 1 : 0}` } })), {
    type: "unique-value", field: "style", defaultSymbol: fill("#c9c4b8"),
    uniqueValueInfos: Object.entries(SURFACES).flatMap(([value, material]) => [0, 1].map(raised => ({
      value: `${value}:${raised}`, symbol: dim === "3d" && raised && value !== "gravel" ? extrude(material.color, CGA.curbHeight) : fill(material.color),
    }))),
  }, [{ name: "style", type: "string" }], 50000));
  if (view.curbs.length || view.boxes.length) layers.push(layer("curbs", [
    { rings: view.curbs }, ...view.boxes.map(box => ({ rings: box.rings })),
  ], { type: "simple", symbol: dim === "3d" ? extrude(SETTLEMENT_ROAD_COLORS.curb, CGA.curbHeight + .02) : fill("#e6e2d8") }, [], 12000));
  if (paint.length) layers.push(layer("markings", paint.map(row => ({ rings: row.rings, attributes: { color: row.color, street_v: STREET_MODEL_VERSION } })), {
    type: "unique-value", field: "color", defaultSymbol: fill(SETTLEMENT_ROAD_COLORS.white),
    uniqueValueInfos: [{ value: "yellow", symbol: fill(SETTLEMENT_ROAD_COLORS.yellow) }],
  }, [{ name: "color", type: "string" }, { name: "street_v", type: "integer" }], 18000));
  return layers;
}
