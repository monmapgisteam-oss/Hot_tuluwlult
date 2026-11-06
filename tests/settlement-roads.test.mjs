import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context); }
    catch (error) {
      if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
      if (specifier.startsWith("@arcgis/core/") && !specifier.endsWith(".js")) return nextResolve(`${specifier}.js`, context);
      if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
      throw error;
    }
  },
});
const { settlementRoads, settlementRoadData, settlementRoadDisplay } = await import("../lib/plan/settlementRoads.ts");
const { area, bufPath, diff, inter, unionAll } = await import("../lib/plan/geom.ts");
const { sectionLayout } = await import("../lib/plan/streetSection.ts");
const { strokeRoadMarking } = await import("../lib/plan/settlementRoadPaint.ts");
hook.deregister();

const box = (x0, y0, x1, y1) => [[[x0, y0], [x0, y1], [x1, y1], [x1, y0], [x0, y0]]];
const street = (id, path, cls = "arterial", w = 24) => ({ id, path, cls, w });
const inputs = { walkW: 3, bikeW: 2, laneW: 3.5, artLanes: 3, colLanes: 1, serviceW: 6 };
const plan = (streets, streetInputs = inputs, ground = []) => ({
  wkid: 32648, site: box(-100, -100, 700, 500), streets, streetInputs, scene: { streets: ground },
});

test("B01 adaptation uses exact saved pavement and service lanes, leaving source paths unchanged", () => {
  const source = plan([street(1, [[0, 0], [500, 0]], "arterial", 60)]);
  const before = structuredClone(source);
  const [road] = settlementRoads(source);
  assert.equal(road.width, 43);
  assert.equal(road.lanes, 3);
  assert.equal(road.median, 4);
  assert.equal(sectionLayout(road.section).width, road.width);
  assert.equal(road.section.lanes.filter(lane => lane.kind === "parking").length, 2);
  assert.deepEqual(road.path, source.streets[0].path);
  assert.deepEqual(source, before);
});

test("compact saved settings and live inputs retain a seven metre two-way pavement", () => {
  const compact = { ...inputs, artLanes: 1, serviceW: 0 };
  const source = plan([street(1, [[0, 0], [500, 0]])], compact);
  assert.equal(settlementRoads(source)[0].width, 7);
  const live = { ...source, streetInputs: undefined, inp: compact };
  assert.equal(settlementRoads(live)[0].width, 7);
  assert.equal(settlementRoads(source)[0].section.lanes.filter(lane => lane.kind === "car").length, 2);
});

test("legacy compact saves recover the existing asphalt width instead of adding lanes", () => {
  const source = plan([street(1, [[0, 0], [500, 0]])], undefined, [{ k: "road", lot: 0, rings: box(-3.5, -3.5, 503.5, 3.5) }]);
  delete source.streetInputs;
  const [road] = settlementRoads(source);
  assert.equal(road.width, 7);
  assert.equal(road.lanes, 1);
  assert.equal(road.median, 0);
});

test("legacy broad boulevards keep both service roads and their three lane approaches", () => {
  const pavement = unionAll([box(0, -21.5, 500, -15.5), box(0, -12.5, 500, -2), box(0, 2, 500, 12.5), box(0, 15.5, 500, 21.5)]);
  const source = plan([street(1, [[0, 0], [500, 0]], "arterial", 60)], undefined, [{ k: "road", lot: 0, rings: pavement }]);
  delete source.streetInputs;
  const [road] = settlementRoads(source);
  assert.equal(road.width, 43);
  assert.equal(road.lanes, 3);
  assert.equal(road.median, 4);
});

test("detailed T junction and paint stay inside the reserved corridors and are worker cloneable", () => {
  const streets = [street(1, [[0, 100], [500, 100]]), street(2, [[250, 100], [250, 400]], "local", 14)];
  const full = unionAll(streets.map(s => bufPath([s.path], s.w / 2)));
  const source = plan(streets, { ...inputs, artLanes: 1, serviceW: 0 }, [{ k: "verge", lot: 0, rings: full }]);
  const { view, ground, paint } = settlementRoadDisplay(source);
  const { boundary } = settlementRoadData(source);
  assert.ok(area(view.surface) > 1000);
  assert.ok(view.markingLines.some(line => line.path.length > 1), "B01 must create lane markings");
  assert.ok(view.markingLines.some(line => line.path.reduce((length, p, i, path) => length + (i ? Math.hypot(p[0] - path[i - 1][0], p[1] - path[i - 1][1]) : 0), 0) <= 3.01), "lane dividers must include physical dashed segments");
  const pavement = unionAll([view.surface, view.corners]);
  assert.ok(area(diff(pavement, boundary)) < .01);
  assert.ok(paint.length > 0);
  for (const row of paint) assert.ok(area(diff(row.rings, pavement)) < .001, "physical-width paint cannot bleed off the pavement");
  for (const row of ground) {
    assert.notEqual(row.k, "road", "native asphalt must not cover the detailed median");
    assert.ok(area(diff(row.rings, boundary)) < .01);
    if (row.k === "verge") assert.ok(area(inter(row.rings, pavement)) < .01, "green ground must not cover the junction pavement");
  }
  assert.deepEqual(structuredClone({ view, ground, paint }), { view, ground, paint });
});

test("road marking width is fifteen centimetres in map coordinates, including a closed-path seam", () => {
  const straight = strokeRoadMarking([[0, 0], [100, 0]]);
  assert.ok(Math.abs(area(straight) - 15) < .001);
  const loop = strokeRoadMarking([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]);
  assert.ok(Math.abs(area(loop) - 6) < .001);
  assert.ok(loop.flat().every(point => point.every(Number.isFinite)));
});

test("courtyard entrances open the new curb and verge while preserving foot and cycle crossings", () => {
  const streets = [street(1, [[0, 100], [500, 100]])];
  const compact = { ...inputs, artLanes: 1, serviceW: 0 };
  const corridor = bufPath([streets[0].path], 12);
  const bare = plan(streets, compact, [{ k: "verge", lot: 0, rings: corridor }]);
  const access = {
    street: 1, lot: 4, width: 6, path: [[250, 140], [250, 100]], rings: box(247, 100, 253, 140),
    crossings: [{ k: "bike", rings: box(247, 107, 253, 109) }, { k: "sidewalk", rings: box(247, 109, 253, 112) }],
  };
  const before = settlementRoadDisplay(bare);
  assert.ok(area(inter(before.view.curbs, access.rings)) > .1, "fixture must cross a previously closed street curb");
  const source = { ...bare, scene: { ...bare.scene, accesses: [access] } };
  const original = structuredClone(source);
  const result = settlementRoadDisplay(source);
  assert.ok(area(diff(access.rings, result.view.surface)) < .001);
  assert.ok(area(inter(result.view.curbs, access.rings)) < .001, "no upright curb may block vehicle access");
  for (const row of result.ground.filter(row => row.k === "verge")) assert.ok(area(inter(row.rings, access.rings)) < .001);
  for (const kind of ["sidewalk", "bike"]) assert.ok(result.view.ground.some(row => row.k === kind && !row.raised && area(inter(row.rings, access.rings)) > 1));
  assert.deepEqual(source, original);
});

test("explicit external access corridors remain visible outside the site", () => {
  const internal = street(1, [[0, 100], [500, 100]]);
  const external = { ...street(2, [[0, 100], [-250, 100]], "collector", 18), ext: true };
  const source = plan([internal, external]);
  const { boundary } = settlementRoadData(source);
  assert.ok(area(inter(boundary, box(-240, 95, -150, 105))) > 800);
  assert.ok(area(diff(boundary, unionAll(source.streets.map(s => bufPath([s.path], s.w / 2))))) < .01);
});

test("a street outside the selected site does not turn an empty clip into an unbounded display", () => {
  const source = { ...plan([street(1, [[0, 0], [500, 0]])]), site: box(0, 200, 500, 400) };
  const result = settlementRoadDisplay(source);
  assert.equal(result.view.surface.length, 0);
  assert.equal(result.view.corners.length, 0);
  assert.equal(result.paint.length, 0);
});
