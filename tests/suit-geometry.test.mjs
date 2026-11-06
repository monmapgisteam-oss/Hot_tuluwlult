import assert from "node:assert/strict";
import { test } from "node:test";
import Polygon from "@arcgis/core/geometry/Polygon.js";
import * as area from "@arcgis/core/geometry/operators/areaOperator.js";
import * as difference from "@arcgis/core/geometry/operators/differenceOperator.js";
import proj4 from "proj4";
import { resultGeometry } from "../lib/suitGeometry.ts";

const utm = proj4("+proj=utm +zone=48 +datum=WGS84 +units=m +no_defs");
const center = proj4("EPSG:4326", "EPSG:3857", utm.inverse([500000, 5200000]));
const prepared = (over = {}) => ({
  n: 1, cell: 100, utmZone: 48, epsg: 32648, x: [500000], y: [5200000], ...over,
});
const mapPoint = ([x, y]) => [center[0] + x, center[1] + y];
const boundary = (rings) => rings.map((ring) => ring.map((p) => proj4("EPSG:3857", "EPSG:4326", mapPoint(p))));
const polygon = (rings) => new Polygon({ rings: rings.map((r) => r.map(mapPoint)), spatialReference: { wkid: 102100 } });
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
const squareMeters = (geometry) => geometry ? Math.abs(area.execute(geometry)) : 0;
const near = (actual, expected, tolerance = 0.001) => assert.ok(
  Math.abs(actual - expected) <= tolerance, `${actual} should be within ${tolerance} of ${expected}`,
);
function inside(geometry, offset) {
  const [x, y] = mapPoint(offset);
  let hit = false;
  for (const ring of geometry.rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
    }
  }
  return hit;
}

test("diagonal boundary clips the square exactly without exterior area", () => {
  const rings = [[[-200, -200], [-200, 200], [200, 200], [-200, -200]]];
  const whole = resultGeometry(prepared()).cells[0];
  const result = resultGeometry(prepared({ boundaryLonLat: boundary(rings) }));
  assert.ok(result.boundary);
  assert.ok(result.cells[0]);
  const clipped = result.cells[0];
  assert.ok(squareMeters(clipped) / squareMeters(whole) > 0.49);
  assert.ok(squareMeters(clipped) / squareMeters(whole) < 0.51);
  near(squareMeters(difference.execute(clipped, polygon(rings))), 0);
  for (const [x, y] of clipped.rings.flat()) assert.ok(y - center[1] >= x - center[0] - 0.00001);
  assert.equal(inside(clipped, [-20, 20]), true);
  assert.equal(inside(clipped, [20, -20]), false);
});

test("concave boundary keeps its indentation instead of clipping to its bounding box", () => {
  const rings = [[[-50, -50], [50, -50], [50, -10], [-10, -10], [-10, 50], [-50, 50], [-50, -50]]];
  const clipped = resultGeometry(prepared({ boundaryLonLat: boundary(rings) })).cells[0];
  assert.ok(clipped);
  near(squareMeters(clipped), 6400);
  assert.equal(inside(clipped, [-30, 30]), true);
  assert.equal(inside(clipped, [30, -30]), true);
  assert.equal(inside(clipped, [20, 20]), false);
});

test("multipart boundary preserves disconnected islands and an interior hole", () => {
  const rings = [rect(-60, -50, -5, 50), rect(-45, -15, -20, 15).reverse(), rect(15, -25, 60, 25)];
  const clipped = resultGeometry(prepared({ boundaryLonLat: boundary(rings) })).cells[0];
  assert.ok(clipped);
  near(squareMeters(clipped), 7000);
  assert.equal(clipped.rings.length, 3);
  assert.equal(inside(clipped, [-50, 0]), true);
  assert.equal(inside(clipped, [-30, 0]), false);
  assert.equal(inside(clipped, [0, 0]), false);
  assert.equal(inside(clipped, [30, 0]), true);
});

test("reversing ring winding keeps the same clipped geometry and does not mutate the input", () => {
  const rings = [rect(-60, -50, -5, 50), rect(-45, -15, -20, 15).reverse(), rect(15, -25, 60, 25)];
  const boundaryLonLat = boundary(rings);
  const original = structuredClone(boundaryLonLat);
  const forward = resultGeometry(prepared({ boundaryLonLat })).cells[0];
  const reversed = resultGeometry(prepared({ boundaryLonLat: boundaryLonLat.map((r) => [...r].reverse()) })).cells[0];
  assert.ok(forward);
  assert.ok(reversed);
  near(squareMeters(forward), 7000);
  near(squareMeters(reversed), squareMeters(forward));
  near(squareMeters(difference.execute(forward, reversed)), 0);
  near(squareMeters(difference.execute(reversed, forward)), 0);
  assert.deepEqual(boundaryLonLat, original);
});

test("empty intersections retain null slots so geometry still matches original cell indices", () => {
  const result = resultGeometry(prepared({
    n: 3, x: [499500, 500000, 500500], y: [5200000, 5200000, 5200000],
    boundaryLonLat: boundary([rect(-40, -40, 40, 40)]),
  }));
  assert.equal(result.cells.length, 3);
  assert.equal(result.cells[0], null);
  assert.ok(result.cells[1]);
  assert.equal(result.cells[2], null);
  near(squareMeters(result.cells[1]), 6400);
});

test("prepared data without a boundary retains complete square cells", () => {
  const input = prepared({ n: 2, x: [500000, 500100], y: [5200000, 5200000] });
  const result = resultGeometry(input);
  assert.equal(result.boundary, null);
  assert.equal(result.cells.length, 2);
  for (const cell of result.cells) {
    assert.ok(cell);
    assert.equal(cell.rings.length, 1);
    assert.equal(cell.rings[0].length, 5);
    assert.deepEqual(cell.rings[0][0], cell.rings[0][4]);
    assert.ok(squareMeters(cell) > 10000);
  }
  const emptyBoundary = resultGeometry({ ...input, boundaryLonLat: [] });
  assert.equal(emptyBoundary.boundary, null);
  assert.deepEqual(emptyBoundary.cells.map((c) => c.rings), result.cells.map((c) => c.rings));
});
