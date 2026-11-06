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
const { suitableArea } = await import("../lib/plan/runSettlement.ts");
const { area, bufPoly, diff, inside, inter, unionAll } = await import("../lib/plan/geom.ts");
hook.deregister();

const rect = (x0, y0, x1, y1) => [[[x0, y0], [x0, y1], [x1, y1], [x1, y0], [x0, y0]]];
const zone = rect(0, 0, 300, 300);
const constant = (v) => new Array(100).fill(v);
const prepared = (noBuild) => ({
  n: 100, cell: 30, epsg: 32648, utmZone: 48,
  x: Array.from({ length: 100 }, (_, i) => (i % 10 + 0.5) * 30),
  y: Array.from({ length: 100 }, (_, i) => (Math.floor(i / 10) + 0.5) * 30),
  areaHa: 9, centroid: [105, 47], zone: constant(-1), zones: [],
  num: { slope: constant(0.5), aspect: constant(180), elev: constant(50), tpi: constant(0), flow: constant(1), relief: constant(0) },
  cat: { landcover: { dict: ["Өвслөг бэлчээр"], idx: constant(0) } },
  sources: {}, warnings: [], rivers: [], noBuild,
});

test("sub-cell exclusions survive smoothing even when no sampled center sees them", () => {
  const noBuild = [rect(152, 152, 156, 156), rect(212, 52, 216, 112)];
  const p = prepared(noBuild), prohibited = unionAll(noBuild);
  assert.ok(p.x.every((x, i) => !inside(x, p.y[i], prohibited)));
  // Demonstrate that this fixture exercises the failure: closing alone fills these narrow holes.
  const closed = inter(bufPoly(bufPoly(diff(zone, prohibited), p.cell * 0.3), -p.cell * 0.3), zone);
  assert.ok(area(inter(closed, prohibited)) > 200);
  const usable = suitableArea(p, zone, 0);
  assert.ok(area(usable) > 85000);
  assert.ok(area(inter(usable, prohibited)) < 0.001);
  assert.ok(area(diff(usable, zone)) < 0.001);
});

test("an exclusion with an interior hole preserves its allowed island", () => {
  const noBuild = [[...rect(100, 100, 170, 170), ...rect(125, 125, 145, 145).map((ring) => [...ring].reverse())]];
  const usable = suitableArea(prepared(noBuild), zone, 0);
  assert.ok(area(inter(usable, noBuild[0])) < 0.001);
  assert.equal(inside(135, 135, usable), true);
  assert.equal(inside(110, 110, usable), false);
});

test("suitable area without exact exclusions remains the full suitable polygon", () => {
  assert.ok(Math.abs(area(suitableArea(prepared([]), zone, 0)) - area(zone)) < 0.001);
});
