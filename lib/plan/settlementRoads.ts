import type { PlanView } from "../savedPlan";
import { bufPath, clipPath, diff, inter, setPlanWkid, unionAll, type Path, type Rings, type XY } from "./geom";
import type { Street } from "./layout";
import { pathLength, samplePath, stationOf, type Road } from "./roadGeometry";
import { section, type Attrs, type GroundF } from "./rules";
import { settlementRoadPaint, type RoadPaintRow } from "./settlementRoadPaint";
import { streetAccessView, type StreetAccess } from "./streetAccess";
import { streetModelFor, type StreetView } from "./streetModel";
import { urbanStreetSection } from "./streetSection";
import type { CourtyardAccess } from "./urbanCourtyardAccess";
import { DEFAULT } from "./urban";

export type SettlementStreetInputs = Pick<Attrs, "walkW" | "bikeW" | "laneW" | "artLanes" | "colLanes" | "serviceW">;
/** The worker needs only the saved street geometry and its original cross-section. */
export type SettlementRoadPlan = Pick<PlanView, "wkid" | "site" | "streets"> & {
  scene: Pick<PlanView["scene"], "streets"> & { accesses?: CourtyardAccess[] };
  streetInputs?: SettlementStreetInputs;
  inp?: SettlementStreetInputs;
};
export type SettlementRoadDisplay = { view: StreetView; ground: GroundF[]; paint: RoadPaintRow[] };
type RoadData = { roads: Road[]; boundary: Rings; accesses: StreetAccess[] };
const dataCache = new WeakMap<SettlementRoadPlan, RoadData>();
const displayCache = new WeakMap<SettlementRoadPlan, SettlementRoadDisplay>();

type Interval = [number, number];
function intervalDifference(a: Interval[], b: Interval[]) {
  const ends = [...new Set([...a, ...b].flat())].sort((x, y) => x - y);
  let error = 0;
  for (let i = 1; i < ends.length; i++) {
    const mid = (ends[i - 1] + ends[i]) / 2;
    if (a.some(([lo, hi]) => mid > lo && mid < hi) !== b.some(([lo, hi]) => mid > lo && mid < hi)) error += ends[i] - ends[i - 1];
  }
  return error;
}
function asphaltIntervals(cross: ReturnType<typeof section>): Interval[] {
  const intervals: Interval[] = [[-cross.road, -cross.median / 2], [cross.median / 2, cross.road]];
  if (cross.service) intervals.push([-cross.carriage, -cross.road - cross.sep], [cross.road + cross.sep, cross.carriage]);
  return intervals;
}

/** Older saves omitted input widths. Their asphalt still records the actual
 * lane count: sample clear street arms rather than rescaling from site area.
 * If no clean cross-section survives, retain the historical input defaults. */
function legacyInputs(street: Street, streets: Street[], asphalt: Rings): Attrs {
  if (street.cls !== "arterial" || !asphalt.length) return DEFAULT;
  const candidates = [DEFAULT, ...[1, 2, 3].flatMap(artLanes => [0, DEFAULT.serviceW].map(serviceW => ({ ...DEFAULT, artLanes, serviceW })))];
  const length = pathLength(street.path);
  let best = DEFAULT, bestError = .25;
  for (const fraction of [.5, .3, .7, .15, .85]) {
    const station = length * fraction;
    if (Math.min(station, length - station) < street.w) continue;
    const { point, dir } = samplePath(street.path, station);
    // Junction asphalt is deliberately wider than an individual arm.
    if (streets.some(other => {
      if (other === street || other.path.length < 2) return false;
      const nearest = samplePath(other.path, stationOf(other.path, point)).point;
      return Math.hypot(nearest[0] - point[0], nearest[1] - point[1]) < (street.w + other.w) / 2 + 2;
    })) continue;
    const normal: XY = [-dir[1], dir[0]], half = street.w / 2;
    const across: Path = [[point[0] - normal[0] * half, point[1] - normal[1] * half], [point[0] + normal[0] * half, point[1] + normal[1] * half]];
    const observed: Interval[] = clipPath([across], asphalt).map(path => {
      const offsets = path.map(p => (p[0] - point[0]) * normal[0] + (p[1] - point[1]) * normal[1]);
      return [Math.min(...offsets), Math.max(...offsets)];
    });
    if (!observed.length) continue;
    for (const input of candidates) {
      const error = intervalDifference(observed, asphaltIntervals(section(street.cls, street.w, input)));
      if (error < bestError - 1e-6) { best = input; bestError = error; }
    }
    if (bestError < .001) break;
  }
  return best;
}

export function settlementRoadData(plan: SettlementRoadPlan): RoadData {
  const cached = dataCache.get(plan);
  if (cached) return cached;
  setPlanWkid(plan.wkid ?? 32648);
  const inputs = plan.streetInputs ?? plan.inp;
  const asphalt = inputs ? [] : unionAll(plan.scene.streets.filter(row => row.k === "road").map(row => row.rings));
  const streets = plan.streets.filter(street => street.path.length > 1 && Number.isFinite(street.w) && street.w > 0);
  const roads: Road[] = streets.map(street => {
    const input = inputs ? { ...DEFAULT, ...inputs } : legacyInputs(street, streets, asphalt);
    const cross = section(street.cls, street.w, input);
    return {
      id: `street-${street.id}`, path: street.path, width: cross.carriage * 2, lanes: cross.lanes, median: cross.median,
      section: urbanStreetSection(street.cls, cross, input.laneW),
      speed: street.cls === "arterial" ? 40 : street.cls === "collector" ? 30 : 20, use: "residential",
    };
  });
  // The detailed B01 junctions may use the reserved road corridor, never an
  // adjacent building lot. Explicit external links retain their own corridor.
  const internal = unionAll(streets.filter(street => !street.ext).map(street => bufPath([street.path], street.w / 2)));
  const external = streets.filter(street => street.ext).map(street => bufPath([street.path], street.w / 2));
  const roadIds = new Set(roads.map(road => road.id));
  const accesses: StreetAccess[] = (plan.scene.accesses ?? []).map(access => ({
    ...access, road: `street-${access.street}`, rings: inter(access.rings, plan.site),
  })).filter(access => access.rings.length > 0 && roadIds.has(access.road));
  const boundary = unionAll([inter(internal, plan.site), ...external, ...accesses.map(access => access.rings)]);
  const data = { roads, boundary, accesses };
  dataCache.set(plan, data);
  return data;
}

/** Same adapter as B01 plannedRoads: width is pavement, not the red-line width. */
export const settlementRoads = (plan: SettlementRoadPlan): Road[] => settlementRoadData(plan).roads;

export function settlementRoadDisplay(plan: SettlementRoadPlan): SettlementRoadDisplay {
  const cached = displayCache.get(plan);
  if (cached) return cached;
  setPlanWkid(plan.wkid ?? 32648);
  const { roads, boundary, accesses } = settlementRoadData(plan);
  const source = streetAccessView(streetModelFor(boundary.length ? roads : [], { boundary }), accesses);
  const surface = unionAll([source.surface, source.corners]);
  // The renderer uses the physical paint polygons below. Clip them once in a
  // batch; rebuilding the whole city's polygon for every dash takes minutes.
  const view: StreetView = {
    ...source, curbs: inter(source.curbs, boundary),
  };
  const ground: GroundF[] = plan.scene.streets.filter(row => row.k !== "road").map(row => ({
    ...row, rings: inter(row.k === "verge" ? diff(row.rings, surface) : row.rings, boundary),
  })).filter(row => row.rings.length > 0);
  // Replace the native pavement and fill the detailed model's median gaps.
  const outer = inter(unionAll(roads.map(road => bufPath([road.path], road.width / 2))), boundary);
  const median = diff(outer, surface);
  if (median.length) ground.push({ rings: median, k: "verge", lot: 0 });
  const display = { view, ground, paint: settlementRoadPaint(view) };
  displayCache.set(plan, display);
  return display;
}

export const settlementStreetView = (plan: SettlementRoadPlan): StreetView => settlementRoadDisplay(plan).view;
