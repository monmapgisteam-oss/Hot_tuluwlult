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
const { generate, section } = await import("../lib/plan/rules.ts");
const { area, bbox, bufPoly, diff, inter, labelPt, obb, unionAll } = await import("../lib/plan/geom.ts");
hook.deregister();

const rect = (x0, y0, x1, y1) => [[[x0, y0], [x0, y1], [x1, y1], [x1, y0], [x0, y0]]];
const attrs = {
  setback: 6, depth: 14, maxLen: 60, gapEnd: 12, floorsRes: 5, floorH: 3, sunK: 2,
  bcrRes: 30, bcrMaxRes: 40, bcrMinRes: 25, farMaxRes: 1.2, openSouth: true, comGround: false,
  floorsCom: 6, bcrCom: 45, comPodium: 2, floorsSchool: 3, floorsKinder: 2, floorsClinic: 3,
  walkW: 3, bikeW: 2, laneW: 3.5, treeSp: 10, parkBays: 1, pvShare: 0.3, greenRoof: 0.1,
  stopSp: 400, artLanes: 3, colLanes: 1, serviceW: 6, floorGrad: 0,
};
const lot = (rings, id = 1) => ({ id, zone: "res", use: "res", rings, area: area(rings), c: labelPt(rings), edge: "local" });
const scene = (lots, overrides = {}) => generate(lots, [], { nodes: [], edges: [], adj: [] }, unionAll(lots.map((l) => l.rings)), { ...attrs, ...overrides }, []);

test("narrow residential lot fits a regular building with setbacks, daylight space and density caps", () => {
  const L = lot(rect(0, 0, 90, 35));
  const result = scene([L]);
  assert.equal(result.bldgs.length, 1);
  assert.equal(result.rep["bldg.compact"], 1);
  const b = result.bldgs[0], dimensions = obb(b.rings), box = bbox(b.rings);
  assert.ok(dimensions.len >= 18 - 0.001 && dimensions.wid >= 10 - 0.001);
  assert.ok(area(diff(b.rings, bufPoly(L.rings, -attrs.setback))) < 0.002);
  assert.ok(b.foot <= L.area * attrs.bcrRes / 100 + 0.001);
  assert.ok(b.gfa <= L.area * attrs.farMaxRes + 0.001);
  const daylightMargin = b.h * attrs.sunK / 2;
  assert.ok(box.y0 >= daylightMargin - 0.001);
  assert.ok(35 - box.y1 >= daylightMargin - 0.001);
});

test("compact placement respects lower FAR and BCR instead of overfilling the plot", () => {
  const L = lot(rect(0, 0, 90, 35));
  const result = scene([L], { farMaxRes: 0.25, bcrRes: 15 });
  assert.equal(result.bldgs.length, 1);
  assert.ok(result.bldgs[0].gfa <= L.area * 0.25 + 0.001);
  assert.ok(result.bldgs[0].foot <= L.area * 0.15 + 0.001);
});

test("irregular residential plot receives a contained regular bar rather than a triangular building", () => {
  const L = lot([[[0, 0], [0, 60], [100, 0], [0, 0]]]);
  const result = scene([L]);
  assert.equal(result.bldgs.length, 1);
  const b = result.bldgs[0], dimensions = obb(b.rings);
  assert.ok(Math.abs(b.foot - dimensions.len * dimensions.wid) < 0.01);
  assert.ok(dimensions.len >= 18 - 0.001 && dimensions.wid >= 10 - 0.001);
  assert.ok(area(diff(b.rings, bufPoly(L.rings, -attrs.setback))) < 0.002);
});

test("truly narrow or prohibited lots remain unbuilt", () => {
  assert.equal(scene([lot(rect(0, 0, 90, 18))]).bldgs.length, 0);
  assert.equal(scene([lot(rect(0, 0, 90, 35))], { acceptFootprint: () => false }).bldgs.length, 0);
});

test("neighboring compact plots keep building separation", () => {
  const result = scene([lot(rect(0, 0, 90, 35)), lot(rect(0, 35, 90, 70), 2)]);
  assert.equal(result.bldgs.length, 2);
  const [first, second] = result.bldgs;
  const gap = Math.max(attrs.gapEnd, attrs.sunK * Math.max(first.h, second.h));
  assert.ok(area(inter(bufPoly(first.rings, gap - 0.01), second.rings)) < 0.002);
});

test("compact arterial cross-sections leave room for walking without an oversized median", () => {
  for (const width of [18, 20, 24]) {
    const s = section("arterial", width, { ...attrs, artLanes: 1, serviceW: 0 });
    assert.equal(s.median, 0);
    assert.equal(s.lanes, 1);
    assert.ok(s.walk >= 2);
    assert.ok(2 * (s.carriage + s.walk + s.bike + s.verge) <= width + 0.001);
  }
  assert.equal(section("arterial", 60, attrs).median, 4);
  assert.equal(section("arterial", 18, attrs).median, 0);
});

test("compact two-way arterial keeps a centerline and a divided arterial keeps its median clear", () => {
  const draw = (width, overrides) => generate([], [{ id: 1, cls: "arterial", path: [[40, 100], [260, 100]], w: width }],
    { nodes: [], edges: [], adj: [] }, rect(0, 0, 300, 200), { ...attrs, ...overrides }, []);
  const compact = draw(24, { artLanes: 1, serviceW: 0 });
  const centerlines = compact.lanes.filter(lane => lane.k === "center");
  assert.equal(centerlines.length, 1);
  assert.deepEqual(centerlines[0].path, [[40, 100], [260, 100]]);
  assert.equal(draw(60, {}).lanes.filter(lane => lane.k === "center").length, 0);
});
