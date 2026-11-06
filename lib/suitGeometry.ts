// Display geometry only: scoring and cell indices stay unchanged.
import Polygon from "@arcgis/core/geometry/Polygon.js";
import * as intersection from "@arcgis/core/geometry/operators/intersectionOperator.js";
import * as simplify from "@arcgis/core/geometry/operators/simplifyOperator.js";
import proj4 from "proj4";
import type { Prepared } from "./suit.ts";

const spatialReference = { wkid: 102100 };
const mercator = (lon: number, lat: number): [number, number] => {
  const r = 6378137;
  return [r * lon * Math.PI / 180, r * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))];
};

/** Clip in the map's projection so straight edges match the drawn polygon exactly. */
export function resultGeometry(p: Pick<Prepared, "n" | "cell" | "utmZone" | "epsg" | "x" | "y" | "boundaryLonLat">) {
  const inputBoundary = p.boundaryLonLat?.length ? new Polygon({
    rings: p.boundaryLonLat.map((ring) => ring.map(([lon, lat]) => mercator(lon, lat))),
    spatialReference,
  }) : null;
  // Normalize ring winding, including GeoJSON administrative boundaries and holes.
  const normalized = inputBoundary ? simplify.execute(inputBoundary) : null;
  const boundary = normalized?.type === "polygon" ? normalized as Polygon : null;
  if (boundary) intersection.accelerateGeometry(boundary);
  const tr = proj4(`+proj=utm +zone=${p.utmZone}${p.epsg >= 32700 ? " +south" : ""} +datum=WGS84 +units=m +no_defs`);
  const h = p.cell / 2;
  const toMap = (x: number, y: number) => {
    const [lon, lat] = tr.inverse([x, y]);
    return mercator(lon, lat);
  };
  const cells = Array.from({ length: p.n }, (_, i): Polygon | null => {
    if (inputBoundary && !boundary) return null;
    const x = p.x[i], y = p.y[i];
    const cell = new Polygon({
      rings: [[toMap(x - h, y - h), toMap(x - h, y + h), toMap(x + h, y + h), toMap(x + h, y - h), toMap(x - h, y - h)]],
      spatialReference,
    });
    if (!boundary) return cell; // Older prepared data did not include a boundary.
    const clipped = intersection.execute(cell, boundary);
    // Keep null entries: each surviving feature must retain its original score/tooltip index.
    return clipped?.type === "polygon" && (clipped as Polygon).rings.length ? clipped as Polygon : null;
  });
  return { boundary, cells };
}
