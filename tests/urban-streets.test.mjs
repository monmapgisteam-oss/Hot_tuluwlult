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
const { connectUrbanStreets, snapDeadEnds, streetComponents, urbanStreetAllowed } = await import("../lib/plan/urbanStreetConnections.ts");
const { corridorGraph } = await import("../lib/plan/sharedUtilityGraph.ts");
const { buildPlanningSuitability } = await import("../lib/plan/planningSuitability.ts");
hook.deregister();

const box = (x0, y0, x1, y1) => [[[x0, y0], [x0, y1], [x1, y1], [x1, y0], [x0, y0]]];
const boundary = box(0, 0, 300, 300);
const road = (id, path, cls = "local", w = 12, ext = false) => ({ id, path, cls, w, ext });
const components = streets => streetComponents(corridorGraph(streets.filter(s => !s.ext).map(s => s.path))).count;
const dem = (height = () => 1400) => ({
  x0: 0, y0: 0, nx: 101, ny: 101, cell: 3,
  z: Float64Array.from({ length: 10201 }, (_, i) => height(i % 101 * 3, Math.floor(i / 101) * 3)),
});

test("short offset street fragments join through reserved corridors without mutating source roads", () => {
  const input = [road(1, [[30, 100], [145, 100]], "arterial", 24), road(2, [[155, 104], [260, 104]], "collector", 18)];
  const original = structuredClone(input);
  const result = connectUrbanStreets(input, boundary, null, 12);
  assert.equal(components(result), 1);
  assert.ok(result.some(s => s.id === 1));
  assert.ok(result.some(s => s.id === 2));
  assert.ok(result.every(s => urbanStreetAllowed(s, boundary, null)));
  assert.deepEqual(input, original);
});

test("isolated local loops are removed while the connected arterial and explicit external link remain", () => {
  const input = [
    road(1, [[30, 60], [270, 60]], "arterial", 24),
    road(2, [[150, 60], [150, 140]]),
    road(3, [[60, 220], [100, 220], [100, 260], [60, 260], [60, 220]]),
    road(4, [[30, 60], [-100, 60]], "arterial", 24, true),
  ];
  const result = connectUrbanStreets(input, boundary, null, 12);
  assert.equal(components(result), 1);
  assert.deepEqual(result.map(s => s.id), [1, 2, 4]);
});

test("a valid T junction extends to the main centerline instead of stopping at its verge", () => {
  const input = [road(1, [[30, 100], [270, 100]], "arterial", 30), road(2, [[150, 115], [150, 250]])];
  const result = connectUrbanStreets(input, boundary, null, 12);
  assert.equal(components(result), 1);
  const g = corridorGraph(result.map(s => s.path));
  assert.ok(g.nodes.some((p, i) => Math.abs(p[0] - 150) < .001 && Math.abs(p[1] - 100) < .001 && g.adj[i].length >= 3));
});

test("snapping cannot bypass the grade check to join a road on a higher terrace", () => {
  const terrain = dem((x, y) => y >= 117 ? 1420 : 1400);
  const input = [road(1, [[30, 100], [270, 100]], "arterial", 40), road(2, [[150, 121], [150, 250]])];
  const options = { maxGrade: { arterial: 6, collector: 7, local: 8 } };
  assert.ok(input.every(s => urbanStreetAllowed(s, boundary, terrain, options)));
  const result = connectUrbanStreets(input, boundary, terrain, 12, options);
  assert.equal(components(result), 1);
  assert.deepEqual(result.map(s => s.id), [1]);
  assert.ok(result.every(s => urbanStreetAllowed(s, boundary, terrain, options)));
});

test("roads crossing a hard restriction or the boundary do not survive the connected network", () => {
  const terrain = dem();
  const suitability = buildPlanningSuitability({ dem: terrain, boundary, restrictions: [{ id: "protected", label: "Protected", rings: box(140, 130, 160, 150), profiles: ["road"] }] });
  const input = [
    road(1, [[30, 60], [270, 60]], "arterial", 24),
    road(2, [[150, 60], [150, 220]]),
    road(3, [[30, 60], [30, 297]], "collector", 20),
  ];
  const result = connectUrbanStreets(input, boundary, terrain, 12, { suitability });
  assert.deepEqual(result.map(s => s.id), [1]);
  assert.equal(components(result), 1);
});

test("dead-end snapping checks the proposed entire path before committing the extension", () => {
  const input = [road(1, [[30, 100], [270, 100]], "arterial", 30), road(2, [[150, 115], [150, 250]])];
  const original = structuredClone(input);
  let proposals = 0;
  snapDeadEnds(input, candidate => { proposals++; assert.ok(candidate.path.length >= 3); return false; });
  assert.ok(proposals > 0);
  assert.deepEqual(input, original);
});
