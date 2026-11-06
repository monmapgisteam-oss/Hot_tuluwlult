import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import proj4 from "proj4";

// Run the production planner directly; resolve the same modules as the browser bundler.
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
const { planSettlement, PLAN_DEFAULT } = await import("../lib/plan/runSettlement.ts");
const { area, bbox, bufPath, diff, inside, inter, unionAll } = await import("../lib/plan/geom.ts");
const { corridorGraph } = await import("../lib/plan/sharedUtilityGraph.ts");
const { streetComponents } = await import("../lib/plan/urbanStreetConnections.ts");
hook.deregister();

const sites = JSON.parse(readFileSync(new URL("./fixtures/settlement-sites.json", import.meta.url), "utf8"));
const tr = proj4("+proj=utm +zone=48 +datum=WGS84 +units=m +no_defs");
const offset = (ring) => ring.map(([x, y]) => [500000 + x, 5200000 + y]);

function fixture(site) {
  const zone = [offset(site.ring)], bounds = bbox(zone), x = [], y = [];
  for (let yy = Math.floor(bounds.y0 / 30) * 30 + 15; yy < bounds.y1; yy += 30) {
    for (let xx = Math.floor(bounds.x0 / 30) * 30 + 15; xx < bounds.x1; xx += 30) {
      if (inside(xx, yy, zone)) { x.push(xx); y.push(yy); }
    }
  }
  const rings = zone.map((ring) => ring.map((point) => tr.inverse(point)));
  const constant = (v) => new Array(x.length).fill(v);
  const noBuild = (site.noBuild ?? []).map((ring) => [offset(ring)]);
  return {
    zone, rings, noBuild,
    prep: {
      n: x.length, cell: 30, epsg: 32648, utmZone: 48, x, y, areaHa: area(zone) / 1e4,
      centroid: tr.inverse([(bounds.x0 + bounds.x1) / 2, (bounds.y0 + bounds.y1) / 2]),
      boundaryLonLat: rings, zone: constant(0), zones: [{ aimag: "test", soum: "test" }],
      num: { slope: constant(0.5), aspect: constant(270), elev: constant(50), elevM: constant(1400), tpi: constant(0), flow: constant(1), relief: constant(5) },
      cat: { landcover: { dict: ["Өвслөг бэлчээр"], idx: constant(0) } },
      sources: {}, warnings: [], roads: [], rivers: [], anchor: null, noBuild,
    },
  };
}

for (const site of sites) test(`settlement: ${site.name} has residences and a connected, usable street network`, { timeout: 30000 }, async (t) => {
  const input = fixture(site);
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  // Only the remote DEM is substituted; all site selection, zoning, roads and buildings are real.
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "/api/dem");
    const { nx, ny, x0, cell } = JSON.parse(init.body);
    const z = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = 1400 + (x0 + i * cell - 500000) * 0.005;
    return new Response(z.buffer);
  };
  const plan = await planSettlement({ rings: input.rings, prep: input.prep, inputs: { ...PLAN_DEFAULT }, onStep: () => {} });
  const residences = plan.bldgs.filter((building) => building.pop > 0);
  assert.ok(residences.length >= site.minResidentialBuildings, `${site.name}: expected at least ${site.minResidentialBuildings} residential buildings, received ${residences.length}`);
  assert.ok(Number.isFinite(plan.t.pop) && plan.t.pop > 0, "a successful settlement must house people");
  assert.ok(plan.lots.some((lot) => lot.use === "res"), "parks must not consume all residential lots");
  assert.ok(Object.values(plan.land).reduce((sum, value) => sum + value, 0) <= plan.siteArea + 0.1, "land uses and road corridors must not count the same area twice");
  assert.ok(Math.abs(plan.land.res - plan.lots.filter((lot) => lot.zone === "res").reduce((sum, lot) => sum + lot.area, 0)) < 0.1, "reported residential land must match the final lots");

  const streets = plan.streets.filter((street) => !street.ext);
  assert.ok(streets.length > 0);
  assert.equal(streetComponents(corridorGraph(streets.map((street) => street.path))).count, 1, "streets must connect into one network");
  const corridor = unionAll(streets.map((street) => bufPath([street.path], street.w / 2)));
  assert.ok(area(diff(corridor, input.zone)) < 0.1, "the full road width must stay within the drawn polygon");
  for (const prohibited of input.noBuild) assert.ok(area(inter(corridor, prohibited)) < 0.1, "streets must route around prohibited areas with their full width");
  for (const building of plan.bldgs) {
    assert.ok(area(diff(building.rings, plan.site)) < 0.1, `building ${building.id} crosses the site boundary`);
    assert.ok(area(inter(building.rings, corridor)) < 0.1, `building ${building.id} overlaps a street corridor`);
    for (const prohibited of input.noBuild) assert.ok(area(inter(building.rings, prohibited)) < 0.1, `building ${building.id} overlaps a prohibited area`);
  }
});
