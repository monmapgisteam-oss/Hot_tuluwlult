// B01 road paint is measured in metres, so zooming out does not widen lane markings.
import type Polygon from "@arcgis/core/geometry/Polygon";
import * as intersectionOperator from "@arcgis/core/geometry/operators/intersectionOperator";
import { P, parts, unionAll, type Rings, type XY } from "./geom";
import { offsetPath } from "./roadGeometry";
import { CGA, type MarkingColor } from "./streetSection";
import type { StreetView } from "./streetModel";

export type RoadPaintRow = { rings: Rings; color: MarkingColor };

/** Closed paths need their neighbouring segments at the seam, just as in B01. */
export function strokeRoadMarking(path: XY[], width: number = CGA.lineWidth): Rings {
  if (path.length < 2 || !(width > 0) || !Number.isFinite(width)) return [];
  const closed = path.length > 3 && Math.hypot(path[0][0] - path.at(-1)![0], path[0][1] - path.at(-1)![1]) < 1e-6;
  const base = closed ? [path.at(-2)!, ...path, path[1]] : path;
  const edge = (offset: number) => {
    const points = offsetPath(base, offset);
    return closed ? points.slice(1, -1) : points;
  };
  const left = edge(-width / 2), right = edge(width / 2).reverse();
  return [[...left, ...right, left[0]]];
}

/** Worker-side geometry. Clip the physical paint as well as its centreline. */
export function settlementRoadPaint(view: StreetView): RoadPaintRow[] {
  const surface = unionAll([view.surface, view.corners]);
  if (!surface.length) return [];
  const boundary = P(surface);
  intersectionOperator.accelerateGeometry(boundary);
  const grouped = new Map<MarkingColor, Rings[]>();
  const add = (rings: Rings, color: MarkingColor) => {
    if (!rings.length) return;
    const rows = grouped.get(color) ?? [];
    rows.push(rings);
    grouped.set(color, rows);
  };
  if (view.markingLines) {
    for (const line of view.markingLines) add(strokeRoadMarking(line.path, line.width), line.color ?? "white");
  } else {
    for (const path of view.lines) add(strokeRoadMarking(path), "white");
  }
  // SceneView may discard thin, widely separated rings in a citywide draped
  // feature. Each crossing stripe is a local polygon; keep holes with its shell.
  for (const rings of parts(view.areas)) add(rings, "white");
  const rows: RoadPaintRow[] = [];
  for (const [color, rings] of grouped) {
    const clipped = intersectionOperator.executeMany(rings.map(P), boundary);
    for (const polygon of clipped) {
      const result = (polygon as Polygon).rings as Rings;
      if (result?.length) rows.push({ rings: result, color });
    }
  }
  return rows;
}
