// Bayandun's full-size household parcels and estate yards, adapted to the
// settlement planner's terrain checks, connected roads and common quantities.
import { GER_DEFAULT_PARAMS, GER_PARCEL_AREA, runPlan as parcelPlan, type Multi, type Plan as ParcelPlan } from "./gerParcels";
import { HOUSE_FLOOR_HEIGHT, HOUSE_TYPES, yardOf, type Yard } from "./gerYards";
import { area, bufMany, bufPath, bufPoly, clipPath, diff, inter, labelPt, obb, parts, pathLength, unionAll, type Rings, type XY } from "./geom";
import type { Dem } from "./dem";
import type { Lot, Street, ZonePiece } from "./layout";
import { buildGraph, type Graph } from "./network";
import { evaluatePlanningFootprint, type PlanningSuitability } from "./planningSuitability";
import { generateAsync, type BldgF, type Scene } from "./rules";
import { connectUrbanStreets } from "./urbanStreetConnections";
import type { Inputs } from "./urban";

export type GerDistrictView = {
  parcelAreaM2: number;
  parcels: { id: string; rings: Rings; area: number }[];
  yards: Yard[];
};
export type GerDistrict = { streets: Street[]; lots: Lot[]; zones: ZonePiece[]; graph: Graph; scene: Scene; ger: GerDistrictView };

const signed = (ring: XY[]) => ring.reduce((sum, p, i) => { const q = ring[(i + 1) % ring.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0);
/** ArcGIS uses clockwise shells and counter-clockwise holes. */
const fromMulti = (multi: Multi): Rings => multi.flatMap((polygon) => polygon.map((ring, i) => {
  const clockwise = signed(ring) < 0;
  return clockwise === (i === 0) ? ring : [...ring].reverse();
}));
const toMulti = (rings: Rings): Multi => parts(rings);

function candidate(site: Rings, dem: Dem, inp: Inputs, suitability: PlanningSuitability, angle: number) {
  const source = parcelPlan(toMulti(site), { ...GER_DEFAULT_PARAMS, angle });
  const main = fromMulti(source.main), widths = new Map<number, Rings>();
  let id = 0;
  const input: Street[] = source.centerlines.flatMap((path) => {
    const strip = bufPath([path], 0.1);
    const isMain = area(inter(strip, main)) > area(strip) * 0.8;
    const w = isMain ? source.params.mainW : source.params.localW;
    if (!widths.has(w)) widths.set(w, bufPoly(site, -w / 2 - 0.02));
    return clipPath([path], widths.get(w)!).filter((p) => pathLength(p) > 10).map((p): Street => ({ id: ++id, cls: isMain ? "arterial" : "local", path: p, w }));
  });
  const streets = connectUrbanStreets(input, site, dem, source.params.localW, { suitability, maxGrade: inp.maxGrade });
  const corridor = bufMany(streets.map((street) => ({ paths: [street.path], d: street.w / 2 })));
  const corridorMulti = toMulti(corridor);
  const accepted: { parcel: ParcelPlan["lots"][number]; rings: Rings; yard: Yard }[] = [];
  for (const parcel of source.lots) {
    const rings = fromMulti(parcel.poly);
    // Keep the requested cadastral area. Edge fragments remain public green;
    // they must never quietly become a smaller household parcel.
    if (parcel.use !== "res" || parcel.trimmed || Math.abs(area(rings) - GER_PARCEL_AREA) > 0.1 || area(diff(rings, site)) > 0.01 || area(inter(rings, corridor)) > 0.01) continue;
    if (!evaluatePlanningFootprint(suitability, rings, { maxSlope: inp.maxSlope }).allowed) continue;
    const yard = yardOf(parcel.id, parcel.poly, corridorMulti, HOUSE_TYPES[accepted.length % HOUSE_TYPES.length], source.params.lotW);
    if (!yard || yard.bldgs.some((b) => !evaluatePlanningFootprint(suitability, fromMulti([[b.r]]), { maxSlope: inp.maxSlope }).allowed)) continue;
    accepted.push({ parcel, rings, yard });
  }
  return { streets, corridor, accepted };
}

export async function buildGerDistrict(site: Rings, dem: Dem, inp: Inputs, suitability: PlanningSuitability): Promise<GerDistrict> {
  const axis = obb(site).u, angle = Math.atan2(axis[1], axis[0]) * 180 / Math.PI;
  const context = { ...suitability, boundary: site };
  let best = candidate(site, dem, inp, context, angle);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const alternate = candidate(site, dem, inp, context, angle + 90);
  if (alternate.accepted.length > best.accepted.length) best = alternate;
  if (!best.accepted.length) throw new Error("Энэ талбайд замтай холбогдсон 0.7 га бүтэн хашаа багтсангүй. Талбайн хэлбэр эсвэл хэмжээг өөрчилнө үү.");
  const { streets, corridor, accepted } = best;
  const graph = buildGraph(streets, dem, context);
  if (!graph.edges.length) throw new Error("Гэр хороололд хил, хориг, налуугийн шалгалт хангасан холбогдсон зам олдсонгүй.");
  const scene = await generateAsync([], streets, graph, site, {
    ...inp, artLanes: 1, colLanes: 1, serviceW: 0, walkW: 1.5, bikeW: 0,
    acceptFootprint: (rings) => evaluatePlanningFootprint(context, rings, { maxSlope: inp.maxSlope }).allowed,
  }, []);
  const lots: Lot[] = accepted.map(({ rings }, i) => ({ id: i + 1, zone: "res", use: "res", rings, area: area(rings), c: labelPt(rings), edge: "local" }));
  const green = diff(site, unionAll([corridor, ...lots.map((lot) => lot.rings)]));
  for (const rings of parts(green)) {
    const a = area(rings);
    if (a <= 0.01) continue;
    lots.push({ id: lots.length + 1, zone: "park", use: "park", rings, area: a, c: labelPt(rings), edge: "local" });
  }
  scene.base.push({ rings: green, k: "grass", lot: 0 });
  scene.rep["g.grass"] = (scene.rep["g.grass"] ?? 0) + area(green);

  for (let i = 0; i < accepted.length; i++) {
    const { yard, rings: parcel } = accepted[i], lot = i + 1;
    const rings = unionAll(yard.bldgs.filter((b) => b.k === "house").map((b) => fromMulti([[b.r]])));
    const foot = area(rings), floors = yard.houseType.floors, id = scene.bldgs.length + 1;
    const bldg: BldgF = { id, lot, use: "res", kind: "res", floors, fh: HOUSE_FLOOR_HEIGHT, h: floors * HOUSE_FLOOR_HEIGHT, podium: 0,
      foot, gfa: foot * floors, gfaRes: foot * floors, gfaCom: 0, roof: "roof", rings, c: labelPt(rings), households: 1 };
    scene.bldgs.push(bldg);
    scene.masses.push({ rings, z0: 0, h: bldg.h, k: "res", bid: id, fl: 1 });
    scene.lotBcr.set(lot, foot / GER_PARCEL_AREA);
    scene.rep.foot = (scene.rep.foot ?? 0) + foot;
    scene.rep.trees = (scene.rep.trees ?? 0) + yard.trees.length;
    // Surface quantities are disjoint: house/ancillary roofs, then parking,
    // then hard paving, with the remaining yard counted as planted ground.
    const built = unionAll(yard.bldgs.map((b) => fromMulti([[b.r]])));
    const parking = diff(unionAll(yard.parts.filter((p) => p.k === "parking" && !p.role).map((p) => fromMulti([[p.r]]))), built);
    const paved = diff(unionAll(yard.parts.filter((p) => p.k === "paved").map((p) => fromMulti([[p.r]]))), unionAll([built, parking]));
    const grass = diff(parcel, unionAll([built, parking, paved]));
    for (const [key, surface] of [["parking", parking], ["plaza", paved], ["grass", grass]] as const) scene.rep[`g.${key}`] = (scene.rep[`g.${key}`] ?? 0) + area(surface);
  }
  const ger: GerDistrictView = { parcelAreaM2: GER_PARCEL_AREA, parcels: accepted.map(({ parcel, rings }) => ({ id: parcel.id, rings, area: area(rings) })), yards: accepted.map(({ yard }) => yard) };
  const zones: ZonePiece[] = lots.map((lot) => ({ id: lot.id, cls: lot.zone, rings: lot.rings, area: lot.area }));
  return { streets, lots, zones, graph, scene, ger };
}
