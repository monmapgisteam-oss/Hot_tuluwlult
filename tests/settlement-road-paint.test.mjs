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
const { area, bbox, diff, inter, unionAll, setPlanWkid } = await import("../lib/plan/geom.ts");
const { pathLength } = await import("../lib/plan/roadGeometry.ts");
const { streetModel, streetModelFor } = await import("../lib/plan/streetModel.ts");
const { urbanStreetSection } = await import("../lib/plan/streetSection.ts");
const { strokeRoadMarking, settlementRoadPaint } = await import("../lib/plan/settlementRoadPaint.ts");
hook.deregister();

const box = (x0, y0, x1, y1) => [[[x0, y0], [x0, y1], [x1, y1], [x1, y0], [x0, y0]]];
const road = (id, path, cls = "arterial") => ({
  id, path, width: cls === "arterial" ? 17 : 7, lanes: cls === "arterial" ? 2 : 1,
  median: cls === "arterial" ? 3 : 0, speed: cls === "arterial" ? 40 : 20, use: "residential",
  section: urbanStreetSection(cls, { walk: 2, bike: 0, verge: 2, median: cls === "arterial" ? 3 : 0, lanes: cls === "arterial" ? 2 : 1 }, 3.5),
});

test("road paint is 0.15 metres wide for horizontal and diagonal markings", () => {
  setPlanWkid(32648);
  for (const path of [[[0, 0], [10, 0]], [[500000, 5300000], [500006, 5300008]]]) {
    const strip = strokeRoadMarking(path);
    assert.ok(Math.abs(area(strip) - 1.5) < 1e-5, "ten metres of paint should cover 1.5 m²");
    const [a, b] = path, length = pathLength(path);
    for (const [x, y] of strip.flat()) {
      const perpendicular = Math.abs((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])) / length;
      assert.ok(Math.abs(perpendicular - .075) < 1e-6);
    }
  }
});

test("closed road marking has the same seam geometry regardless of its first corner", () => {
  const path = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  const rotated = [[10, 0], [10, 10], [0, 10], [0, 0], [10, 0]];
  const a = strokeRoadMarking(path), b = strokeRoadMarking(rotated);
  assert.ok(Math.abs(area(a) - 6) < 1e-6);
  assert.ok(area(diff(a, b)) + area(diff(b, a)) < 1e-6);
  assert.ok(area(inter(a, box(-.05, -.05, .05, .05))) > .005, "paint must cover the starting corner");
});

test("B01 geometry uses the requested UTM zone instead of a fixed zone 48 tester", () => {
  const make = () => [road("main", [[500000, 5300000], [500400, 5300000]]), road("local", [[500200, 5299850], [500200, 5300150]], "local")];
  setPlanWkid(32647);
  const west = streetModelFor(make());
  const westArea = area(west.surface);
  assert.ok(west.fixtures.length > 0);
  setPlanWkid(32650);
  const east = streetModelFor(make());
  assert.ok(Math.abs(area(east.surface) - westArea) < 1e-5);
  assert.equal(east.fixtures.length, west.fixtures.length);
  assert.equal(east.lines.length, west.lines.length);
  setPlanWkid(32648);
});

test("physical paint stays within clipped asphalt and out of the raised median", () => {
  const roads = [road("main", [[0, 0], [400, 0]]), road("local", [[200, -150], [200, 150]], "local")];
  const boundary = box(40, -100, 340, 100);
  const view = streetModelFor(roads, { boundary });
  const paint = settlementRoadPaint(view), asphalt = unionAll([view.surface, view.corners]);
  assert.ok(paint.length > 50);
  const median = box(80, -1.2, 150, 1.2);
  for (const mark of paint) {
    assert.ok(area(diff(mark.rings, asphalt)) < 1e-6);
    assert.ok(area(diff(mark.rings, boundary)) < 1e-6);
    assert.ok(area(inter(mark.rings, median)) < 1e-6);
  }
});

test("residential arterial junctions own their zebra crossings without regenerating all street ground", () => {
  const roads = [road("main", [[0, 0], [400, 0]]), road("local", [[200, -150], [200, 150]], "local")];
  const model = streetModel(roads), view = streetModelFor(roads);
  assert.equal(model.perRoad.main.crosswalks, 2, "each arterial approach must have a crossing");
  assert.equal(model.perRoad.local.crosswalks, 2);
  assert.equal(view.quantities.crosswalks, 4);
  assert.ok(area(view.areas) > 100, "crossing stripes must be emitted as filled paint");
  const median = box(60, -1.2, 160, 1.2);
  const paint = settlementRoadPaint(view);
  assert.ok(paint.every(mark => area(inter(mark.rings, median)) < 1e-6));
});

test("citywide zebra paint becomes local SceneView features without losing final paint coverage", () => {
  const streets = [0, 300, 600, 900].flatMap((at, i) => [
    road(`east-${i}`, [[-120, at], [1020, at]]),
    road(`north-${i}`, [[at, -120], [at, 1020]]),
  ]);
  const view = streetModelFor(streets), paint = settlementRoadPaint(view);
  const expected = inter(view.areas, unionAll([view.surface, view.corners]));
  assert.ok(view.quantities.crosswalks >= 40);
  assert.ok(area(expected) > 1000);
  assert.ok(area(diff(expected, unionAll(paint.map(mark => mark.rings)))) < 1e-5, "all zebra stripe coverage must reach the final render rows");
  for (const mark of paint) {
    const bounds = bbox(mark.rings);
    assert.ok(Math.max(bounds.x1 - bounds.x0, bounds.y1 - bounds.y0) < 350,
      "separate crossings must not be packed into one citywide draped feature");
  }
});

test("the actual B01 lane model leaves three-metre gaps between lane dashes", () => {
  const view = streetModelFor([road("main", [[0, 0], [200, 0]])]);
  const dashes = view.markingLines.filter(line => !line.edge && line.path.every(p => Math.abs(p[1] - 5) < 1e-6))
    .filter(line => Math.abs(pathLength(line.path) - 3) < 1e-6)
    .map(line => [Math.min(...line.path.map(p => p[0])), Math.max(...line.path.map(p => p[0]))])
    .sort((a, b) => a[0] - b[0]);
  assert.ok(dashes.length > 20, "the internal divider should contain many distinct dashes");
  for (let i = 1; i < dashes.length; i++) assert.ok(Math.abs(dashes[i][0] - dashes[i - 1][1] - 3) < 1e-6);
});
